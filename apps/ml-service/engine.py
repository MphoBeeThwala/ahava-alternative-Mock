"""
EarlyWarningEngine — refactored to use TimescaleDB persistence (db.py).

Key changes vs original:
- DATA_STORE / CONTEXT_STORE removed; all reads/writes go through db.py
- Progressive baseline: Day-1 value using SA demographic seeds, blended
  progressively as personal data accumulates (4-stage: PROVISIONAL →
  CALIBRATING → PERSONALISING → PERSONAL)
- ensure_schema() called at import so the hypertable is always ready
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
import hashlib
import os
import who_2019_chart_lookup
from models import (
    BiometricData, AlertLevel, ContextualProfile,
    CvdRiskAssessment, BpRiskAssessment, FusionOutput, EarlyWarningSummary,
    UncertaintyProfile, ClinicalProvenance,
)
import db

# Call once at module load — creates hypertable if it doesn't exist yet
try:
    db.ensure_schema()
except Exception as _schema_err:
    import logging
    logging.getLogger(__name__).warning(
        "[engine] Could not ensure DB schema on startup: %s", _schema_err
    )

# ---------------------------------------------------------------------------
# SA Demographic seed baselines (WHO / SA NDoH sub-Saharan African cohort norms)
# ---------------------------------------------------------------------------
_SA_SEEDS = {
    "18-29": (68, 9,  48, 16, 98.0, 1.0, 14, 2),
    "30-39": (70, 10, 44, 15, 97.8, 1.1, 15, 2),
    "40-49": (72, 10, 40, 14, 97.5, 1.2, 15, 3),
    "50-59": (74, 11, 35, 13, 97.2, 1.2, 16, 3),
    "60-69": (76, 11, 29, 12, 96.8, 1.3, 16, 3),
    "70+":   (78, 12, 22, 11, 96.5, 1.4, 17, 4),
}

_STAGE_LABELS = {
    "PROVISIONAL":   "Population baseline (personalising…)",
    "CALIBRATING":   "Calibrating to your data",
    "PERSONALISING": "Personalising your baseline",
    "PERSONAL":      "Your personal baseline",
}


def _age_band(age: int) -> str:
    if age < 30: return "18-29"
    if age < 40: return "30-39"
    if age < 50: return "40-49"
    if age < 60: return "50-59"
    if age < 70: return "60-69"
    return "70+"


def _get_demographic_seed(age: int = 45, gender: str = "unknown") -> Dict[str, Dict[str, float]]:
    hr_m, hr_s, hrv_m, hrv_s, spo2_m, spo2_s, rr_m, rr_s = _SA_SEEDS[_age_band(age)]
    if gender and gender.lower() in ("female", "f"):
        hr_m += 3
        hrv_m -= 4
    return {
        "heart_rate_resting": {"mean": hr_m,    "std": max(hr_s,   1.0)},
        "hrv_rmssd":          {"mean": hrv_m,   "std": max(hrv_s,  1.0)},
        "spo2":               {"mean": spo2_m,  "std": max(spo2_s, 0.5)},
        "respiratory_rate":   {"mean": rr_m,    "std": max(rr_s,   0.5)},
        "step_count":         {"mean": 7000.0,  "std": 3000.0},
        "active_calories":    {"mean": 400.0,   "std": 200.0},
        "sleep_duration_hours": {"mean": 7.0,   "std": 1.2},
    }


def _blend_seed(personal: Dict[str, float], demo_mean: float, demo_std: float,
                weight: float) -> Tuple[float, float]:
    blended_mean = personal["mean"] * weight + demo_mean * (1.0 - weight)
    blended_std  = personal["std"]  * weight + demo_std  * (1.0 - weight)
    return blended_mean, max(blended_std, 0.1)


def _dict_to_biometric(row: dict) -> BiometricData:
    return BiometricData(
        timestamp=row.get("timestamp", datetime.utcnow()),
        heart_rate_resting=float(row.get("heart_rate_resting") or 70),
        hrv_rmssd=float(row.get("hrv_rmssd") or 40),
        spo2=float(row.get("spo2") or 97),
        skin_temp_offset=float(row.get("skin_temp_offset") or 0),
        respiratory_rate=float(row.get("respiratory_rate") or 15),
        step_count=int(row.get("step_count") or 0),
        active_calories=float(row.get("active_calories") or 0),
        sleep_duration_hours=float(row.get("sleep_duration_hours") or 0),
        ecg_rhythm=row.get("ecg_rhythm") or "unknown",
        temperature_trend=row.get("temperature_trend") or "normal",
    )

# Numeric columns used for baseline/trend
BASELINE_METRICS = [
    "heart_rate_resting", "hrv_rmssd", "spo2", "respiratory_rate",
    "step_count", "active_calories", "sleep_duration_hours",
]


class EarlyWarningEngine:
    def __init__(self):
        self.MODEL_VERSION = "early-warning-v2.1.0"
        self.MIN_BASELINE_DAYS = 14
        self.ROLLING_WINDOW_DAYS = 7
        self.SIGMA_YELLOW = 1.5
        self.SIGMA_RED = 2.5
        self.HIGH_ACTIVITY_STEPS_PERCENTILE = 90

        # AH-43/AH-44 gap report: absolute, baseline-independent vital-sign
        # floor, adapted from the SATS-aligned thresholds already used for
        # deterministic symptom triage (apps/backend/src/services/triageSafety.ts).
        # Runs unconditionally, including with no history — "no baseline yet"
        # is not a reason to call a catastrophic first reading GREEN — and a
        # RED-level breach is never suppressed by exercise context either,
        # since desaturation or a critical rate during exertion is itself
        # dangerous. Adult thresholds only: this engine has no patient-age
        # input, so it inherits the same paediatric gap as AH-47 in the TS
        # engine until that's fixed with real clinician-defined paediatric
        # ranges — do not treat these numbers as safe for children.
        #
        # AH-50 §50.4: SpO2 boundaries updated to NEWS2 Scale 1 exactly
        # (>=96 normal, 94-95 caution, 92-93 low, <=91 critical) — never
        # z-scored against a personal baseline (see _evaluate: spo2 is
        # excluded from the baseline-relative metrics loop entirely), and
        # never corrected by race: a systematic review found pulse
        # oximeters consistently overestimate saturation in darker skin
        # tones, worst at low readings, but self-reported race is not a
        # valid proxy for skin colour — this builds in margin (the
        # indeterminate band below) instead of a race-based correction.
        self.SPO2_RED = 91          # <= this is critical (NEWS2 score 3)
        self.SPO2_LOW = 93          # <= this (and > SPO2_RED) is low (NEWS2 score 2)
        self.SPO2_INDETERMINATE = 96  # <= this (and > SPO2_LOW) is indeterminate, not reassuring (NEWS2 score 0-1)
        self.RR_RED_HIGH = 30
        self.RR_RED_LOW = 8
        self.RR_YELLOW_HIGH = 24
        self.RR_YELLOW_LOW = 10
        self.HR_RED_HIGH = 130
        self.HR_RED_LOW = 40
        self.HR_YELLOW_HIGH = 120
        self.HR_YELLOW_LOW = 45
        self._LEVEL_RANK = {AlertLevel.GREEN: 0, AlertLevel.YELLOW: 1, AlertLevel.RED: 2}

        # AH-50 gap report: a shared 0.1-unit floor on every metric's
        # baseline SD (e.g. a tenth of a beat for heart rate) let ordinary
        # day-to-day variation in a very consistent wearer read as
        # multi-sigma noise — M09 flagged a 4 bpm HR move as 1.6σ. Per-metric
        # floors below are sourced (see docs/ENGINEERING_PLAN.md §11
        # follow-up); HRV is handled separately in
        # _hrv_deviation_from_baseline (log-transformed, not a flat floor).
        self.HR_SIGMA_FLOOR = 3.0          # bpm — within-person day-to-day SD, Quer et al. 2020
        self.RR_SIGMA_FLOOR = 1.0          # br/min — Natarajan et al. 2021
        self.RR_SIGMA_FLOOR_OVER_60 = 1.5  # br/min — wider in older adults, same source

        # §50.2: HRV's smallest-worthwhile-change is 0.5x the patient's own
        # coefficient of variation on the log scale, not a sigma multiple.
        self.HRV_SWC_MULTIPLIER = 0.5
        # A real day-to-day CV floor, not just a floating-point-noise guard:
        # the spec's own cited literature gives ~2.7-3.1% as the lower bound
        # even for a genuinely stable individual. Without this, a patient
        # whose recorded history happens to be near-constant (device
        # rounding, a short window) gets a CV of ~0 and therefore a
        # smallest-worthwhile-change of ~0 — making HRV monitoring maximally
        # *insensitive* for exactly the most consistent wearers, the
        # opposite of AH-50's purpose.
        self.HRV_MIN_CV = 0.027

        # §50.3: a single anomalous reading on a non-emergency metric isn't
        # enough — require the deviation on >=2 of the last 3 readings
        # (current included) before it counts toward alert level. The
        # absolute floor (_absolute_floor, AH-43/44) is exempt by design:
        # those fire on the first reading, every time.
        self.PERSISTENCE_REQUIRED = 2
        self.PERSISTENCE_WINDOW = 3

        # §50.5: the personal SD is unreliable from very few points —
        # widen the effective floor while the baseline is still immature.
        self.IMMATURE_BASELINE_MULT_UNDER_7D = 1.5
        self.IMMATURE_BASELINE_MULT_7_TO_14D = 1.25

    def _absolute_floor(self, data: BiometricData) -> Tuple[AlertLevel, List[str]]:
        """Baseline-independent SATS-aligned floor — see __init__ comment."""
        anomalies: List[str] = []
        level = AlertLevel.GREEN

        rr = data.respiratory_rate
        rr_deviated = rr >= self.RR_YELLOW_HIGH or rr <= self.RR_YELLOW_LOW

        # §50.4: SpO2 is absolute-only (never compared to a personal
        # baseline) and a 92-96% reading from a consumer device is treated
        # as indeterminate, not reassuring — it escalates only alongside a
        # respiratory-rate deviation already present, rather than clearing
        # a patient with breathing symptoms on the strength of SpO2 alone.
        spo2 = data.spo2
        if spo2 <= self.SPO2_RED:
            anomalies.append(f"spo2 ({spo2:.1f}) at or below critical floor (<={self.SPO2_RED}) — NEWS2 SpO2 critical")
            level = AlertLevel.RED
        elif spo2 <= self.SPO2_LOW:
            anomalies.append(f"spo2 ({spo2:.1f}) at or below floor (<={self.SPO2_LOW}) — NEWS2 SpO2 low")
            if self._LEVEL_RANK[level] < self._LEVEL_RANK[AlertLevel.YELLOW]:
                level = AlertLevel.YELLOW
        elif spo2 <= self.SPO2_INDETERMINATE:
            anomalies.append(f"spo2 ({spo2:.1f}) is indeterminate (<={self.SPO2_INDETERMINATE}) from a consumer device — not reassuring")
            if rr_deviated and self._LEVEL_RANK[level] < self._LEVEL_RANK[AlertLevel.YELLOW]:
                level = AlertLevel.YELLOW

        if rr >= self.RR_RED_HIGH or rr <= self.RR_RED_LOW:
            anomalies.append(f"respiratory_rate ({rr:.1f}) at critical floor — CRITICAL_RESPIRATORY_RATE")
            level = AlertLevel.RED
        elif rr >= self.RR_YELLOW_HIGH or rr <= self.RR_YELLOW_LOW:
            anomalies.append(f"respiratory_rate ({rr:.1f}) at floor — ABNORMAL_RESPIRATORY_RATE")
            if self._LEVEL_RANK[level] < self._LEVEL_RANK[AlertLevel.YELLOW]:
                level = AlertLevel.YELLOW

        hr = data.heart_rate_resting
        if hr >= self.HR_RED_HIGH or hr <= self.HR_RED_LOW:
            anomalies.append(f"heart_rate_resting ({hr:.1f}) at critical floor — CRITICAL_HEART_RATE")
            level = AlertLevel.RED
        elif hr >= self.HR_YELLOW_HIGH or hr <= self.HR_YELLOW_LOW:
            anomalies.append(f"heart_rate_resting ({hr:.1f}) at floor — ABNORMAL_HEART_RATE")
            if self._LEVEL_RANK[level] < self._LEVEL_RANK[AlertLevel.YELLOW]:
                level = AlertLevel.YELLOW

        return level, anomalies

    def _estimate_uncertainty(
        self,
        history: List[dict],
        profile: Optional[ContextualProfile],
        data: BiometricData,
        alert_level: AlertLevel,
    ) -> UncertaintyProfile:
        reasons: List[str] = []
        score = 0.0

        data_points = len(history)
        if data_points < 7:
            score += 0.35
            reasons.append("SPARSE_HISTORY")
        elif data_points < 14:
            score += 0.18
            reasons.append("BASELINE_STILL_CALIBRATING")

        if profile is None:
            score += 0.12
            reasons.append("MISSING_RISK_CONTEXT")

        if data.hrv_rmssd <= 0:
            score += 0.10
            reasons.append("MISSING_HRV_SIGNAL")
        if data.sleep_duration_hours <= 0:
            score += 0.08
            reasons.append("MISSING_SLEEP_SIGNAL")

        if alert_level == AlertLevel.RED:
            score += 0.08
            reasons.append("HIGH_ACUITY_STATE")

        score = max(0.0, min(1.0, round(score, 3)))
        return UncertaintyProfile(score=score, reasons=reasons)

    def _build_provenance(
        self,
        user_id: str,
        data: BiometricData,
        alert_level: AlertLevel,
    ) -> ClinicalProvenance:
        trace_seed = (
            f"{user_id}|{data.timestamp.isoformat()}|{data.heart_rate_resting}|"
            f"{data.hrv_rmssd}|{data.spo2}|{alert_level.value}|{self.MODEL_VERSION}"
        )
        trace_id = hashlib.sha256(trace_seed.encode("utf-8")).hexdigest()[:24]

        return ClinicalProvenance(
            evidence_sources=[
                "Local biometric_time_series (patient-specific physiological data)",
                "User risk profile context (explicitly provided clinical risk factors)",
                "SA demographic seed baselines (for baseline warm-start only)",
            ],
            clinical_basis=[
                "SATS-aligned deterministic physiological threshold checks",
                "Population-to-personal baseline blending",
                "Trend analysis over rolling historical window",
                "Conservative fusion escalation rules",
            ],
            model_version=self.MODEL_VERSION,
            decision_trace_id=trace_id,
        )

    # ------------------------------------------------------------------
    # Ingest — persist then evaluate
    # ------------------------------------------------------------------
    def ingest(self, user_id: str, data: BiometricData) -> Tuple[AlertLevel, List[str]]:
        """Store a new data point, then evaluate. Returns (AlertLevel, anomalies)."""
        alert_level, anomalies = self._evaluate(user_id, data)
        db.save_biometric(user_id, data, alert_level.value, anomalies)
        return alert_level, anomalies

    # ------------------------------------------------------------------
    # Evaluate (read-only)
    # ------------------------------------------------------------------
    def _evaluate(self, user_id: str, data: BiometricData) -> Tuple[AlertLevel, List[str]]:
        floor_level, floor_anomalies = self._absolute_floor(data)

        history = db.load_biometrics(
            user_id, days=self.MIN_BASELINE_DAYS + self.ROLLING_WINDOW_DAYS + 1
        )
        if not history:
            if floor_level != AlertLevel.GREEN:
                return floor_level, floor_anomalies + ["No history yet — absolute floor triggered independent of any baseline"]
            return AlertLevel.GREEN, ["No history yet — using population baseline"]

        if self._is_exercise_context(history, data):
            # A YELLOW-level floor breach (e.g. a borderline-elevated HR) can be a
            # genuine, harmless product of exertion, which is exactly what this
            # suppression exists to filter — only a RED-level breach (SATS-critical,
            # not just borderline) survives, since desaturation or a critical rate
            # during exercise is dangerous regardless of context.
            if floor_level == AlertLevel.RED:
                return floor_level, floor_anomalies + ["Exercise context detected but a critical vital floor was not suppressed"]
            return AlertLevel.GREEN, ["Suppressed: High physical activity detected"]

        ctx = db.load_context(user_id)
        age = ctx.age if ctx else 45

        anomalies: List[str] = []
        significant_deviations = 0

        # AH-50 \u00a750.3: heart rate and respiratory rate now require the
        # deviation on >=2 of the last 3 readings (current included) before
        # counting \u2014 a single bad night's reading no longer moves the alert
        # level on its own. SpO2 is excluded here entirely per \u00a750.4 (never
        # baseline-relative; handled only in _absolute_floor above). HRV is
        # excluded here too \u2014 it gets its own log-transform + rolling-mean
        # treatment in _hrv_deviation, not a persistence-gated single-value
        # z-score, since a rolling mean already can't swing on one bad night.
        metrics = {
            "heart_rate_resting": (data.heart_rate_resting, "high"),
            "respiratory_rate":   (data.respiratory_rate,   "high"),
        }

        for metric_name, (value, bad_direction) in metrics.items():
            mean, std = self._calculate_blended_baseline(history, metric_name, age)
            if std == 0:
                continue
            recent_values = self._recent_metric_values(history, value, metric_name)
            persisted, z_score = self._persistent_anomaly(recent_values, mean, std, bad_direction)
            if persisted:
                anomalies.append(
                    f"{metric_name} ({value:.1f}) is {z_score:.1f}\u03c3 from baseline ({mean:.1f}), "
                    f"persistent across {self.PERSISTENCE_REQUIRED}+ of last {min(len(recent_values), self.PERSISTENCE_WINDOW)} readings"
                )
                significant_deviations += 2 if abs(z_score) > self.SIGMA_RED else 1

        hrv_anomaly, hrv_description = self._hrv_deviation(history, data)
        if hrv_anomaly:
            anomalies.append(hrv_description)
            significant_deviations += 1

        if significant_deviations >= 3:
            relative_level = AlertLevel.RED
        elif significant_deviations >= 1:
            relative_level = AlertLevel.YELLOW
        else:
            relative_level = AlertLevel.GREEN

        if self._LEVEL_RANK[floor_level] > self._LEVEL_RANK[relative_level]:
            return floor_level, floor_anomalies + anomalies
        return relative_level, anomalies

    def _recent_metric_values(self, history: List[dict], current_value: float, metric: str) -> List[float]:
        """Current reading plus up to PERSISTENCE_WINDOW-1 most recent prior
        values for `metric` from history (ascending by time \u2014 see db.py's
        ORDER BY time ASC)."""
        prior = [r.get(metric) for r in history[-(self.PERSISTENCE_WINDOW - 1):] if r.get(metric) is not None]
        return [current_value] + prior

    def _persistent_anomaly(
        self, recent_values: List[float], mean: float, std: float, bad_direction: str
    ) -> Tuple[bool, float]:
        """\u00a750.3: True only if the CURRENT reading is itself abnormal AND the
        deviation recurs on >=PERSISTENCE_REQUIRED of the supplied readings.

        Red-team finding, 2026-09-14: the first version counted a breach
        anywhere in the 3-reading window, so two READINGS AGO being abnormal
        plus one MORE reading ago being abnormal could flag even when the
        patient's current reading was back at their exact baseline (z=0) \u2014
        "persistent" was being read as "occurred recently", not "ongoing
        right now", which is a materially different (and wrong) clinical
        claim. Requiring the current reading to breach first, before even
        counting toward the persistence total, is what actually implements
        "the deviation is still present and has been sustained."
        """
        current_z = (recent_values[0] - mean) / std
        current_breached = (
            (bad_direction == "high" and current_z > self.SIGMA_YELLOW) or
            (bad_direction == "low" and current_z < -self.SIGMA_YELLOW)
        )
        if not current_breached:
            return False, current_z

        count = 0
        for v in recent_values:
            z = (v - mean) / std
            breached = (
                (bad_direction == "high" and z > self.SIGMA_YELLOW) or
                (bad_direction == "low" and z < -self.SIGMA_YELLOW)
            )
            if breached:
                count += 1
        return count >= self.PERSISTENCE_REQUIRED, current_z

    def _hrv_deviation(self, history: List[dict], data: BiometricData) -> Tuple[bool, Optional[str]]:
        """\u00a750.2: RMSSD is right-skewed, so a raw z-score isn't a valid
        statistic. Compares a 7-day rolling mean of ln(RMSSD) against the
        baseline established during the patient's first stable week (also
        on the log scale), flagging only when the shift exceeds
        HRV_SWC_MULTIPLIER x the patient's own coefficient of variation \u2014
        the smallest-worthwhile-change convention, not a sigma multiple.
        A single night's reading can't move a 7-day mean on its own, so
        this needs no separate persistence gate."""
        if data.hrv_rmssd is None or data.hrv_rmssd <= 0:
            return False, None

        df = pd.DataFrame(history)
        if "hrv_rmssd" not in df.columns or "timestamp" not in df.columns:
            return False, None
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.set_index("timestamp").sort_index()
        hrv = df["hrv_rmssd"].dropna()
        hrv = hrv[hrv > 0]
        if len(hrv) < 3:
            return False, None

        ln_hrv = np.log(hrv)

        first_week_cutoff = ln_hrv.index.min() + timedelta(days=7)
        baseline_window = ln_hrv[ln_hrv.index < first_week_cutoff]
        if len(baseline_window) < 3:
            baseline_window = ln_hrv  # not enough history for a dedicated first week yet
        epsilon = 1e-9
        baseline_mean = float(baseline_window.mean())
        if abs(baseline_mean) < epsilon:
            return False, None
        baseline_std = float(baseline_window.std()) if len(baseline_window) > 1 else 0.0
        # Floored at HRV_MIN_CV, not just an epsilon-for-floating-point-noise
        # guard: constant/near-constant historical data (device rounding, a
        # short window, or literally identical readings) produces a std()
        # nowhere near zero's real-world meaning — treating that as "no
        # variability, never flag" would make HRV monitoring least sensitive
        # for exactly the most consistent wearers. See HRV_MIN_CV's comment.
        baseline_cv = max(baseline_std / abs(baseline_mean), self.HRV_MIN_CV)
        swc = self.HRV_SWC_MULTIPLIER * baseline_cv

        current_ln = float(np.log(data.hrv_rmssd))
        window_start = ln_hrv.index.max() - timedelta(days=self.ROLLING_WINDOW_DAYS)
        recent = ln_hrv[ln_hrv.index >= window_start]
        rolling_mean = float(pd.concat([recent, pd.Series([current_ln])]).mean())

        deviation = abs(rolling_mean - baseline_mean)
        if deviation <= swc:
            return False, None

        direction = "below" if rolling_mean < baseline_mean else "above"
        approx_ms = float(np.exp(rolling_mean) - np.exp(baseline_mean))
        return True, (
            f"hrv_rmssd 7-day rolling mean is {direction} baseline by {deviation:.3f} "
            f"(ln-scale), exceeding the smallest-worthwhile-change of {swc:.3f} "
            f"(~{approx_ms:+.1f} ms)"
        )

    # AH-50 §50.1: per-metric σ floor, replacing the old flat 0.1 (a tenth
    # of a beat for heart rate). HRV keeps the old flat floor here — its
    # anomaly detection is handled separately on the log scale in
    # _hrv_deviation (§50.2); this function's HRV output is display-only
    # (e.g. "your baseline HRV"), not used for flagging.
    def _sigma_floor_for(self, metric: str, age: Optional[int]) -> float:
        if metric == "heart_rate_resting":
            return self.HR_SIGMA_FLOOR
        if metric == "respiratory_rate":
            return self.RR_SIGMA_FLOOR_OVER_60 if (age is not None and age >= 60) else self.RR_SIGMA_FLOOR
        return 0.1

    # ------------------------------------------------------------------
    # Progressive blended baseline
    # ------------------------------------------------------------------
    def _calculate_blended_baseline(
        self,
        history: List[dict],
        metric: str,
        age: int = 45,
        gender: str = "unknown",
    ) -> Tuple[float, float]:
        demo = _get_demographic_seed(age, gender)
        demo_mean = demo[metric]["mean"] if metric in demo else 70.0
        demo_std  = demo[metric]["std"]  if metric in demo else 5.0
        floor = self._sigma_floor_for(metric, age)

        if not history:
            return demo_mean, max(demo_std, floor)

        df = pd.DataFrame(history)
        if metric not in df.columns:
            return demo_mean, max(demo_std, floor)

        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.set_index("timestamp").sort_index()
        series = df[metric].dropna()
        if series.empty:
            return demo_mean, max(demo_std, floor)

        last_date    = df.index.max()
        window_start = last_date - timedelta(days=self.ROLLING_WINDOW_DAYS)
        recent = series[series.index >= window_start]
        if recent.empty:
            recent = series

        p_mean = float(recent.mean())
        p_std  = float(recent.std()) if len(recent) > 1 and recent.std() > 0 else demo_std

        date_span_days = (
            (df.index.max() - df.index.min()).total_seconds() / 86400
        )
        personal_weight = min(1.0, date_span_days / float(self.MIN_BASELINE_DAYS))

        blended_mean, blended_std = _blend_seed(
            {"mean": p_mean, "std": p_std}, demo_mean, demo_std, personal_weight
        )

        # §50.5: the personal SD above is estimated from very few points
        # early on and is unreliable in both directions — widen the floor
        # while the baseline is still immature, on top of whatever the
        # personal/demographic blend produced.
        if date_span_days < 7:
            floor *= self.IMMATURE_BASELINE_MULT_UNDER_7D
        elif date_span_days < self.MIN_BASELINE_DAYS:
            floor *= self.IMMATURE_BASELINE_MULT_7_TO_14D

        return blended_mean, max(blended_std, floor)

    def _calculate_baseline(self, user_id: str, metric: str) -> Tuple[float, float]:
        """Convenience wrapper: load history from DB then delegate to blended baseline."""
        history = db.load_biometrics(
            user_id, days=self.MIN_BASELINE_DAYS + self.ROLLING_WINDOW_DAYS + 1
        )
        ctx = db.load_context(user_id)
        age = ctx.age if ctx else 45
        return self._calculate_blended_baseline(history, metric, age)

    # ------------------------------------------------------------------
    # Baseline confidence / stage
    # ------------------------------------------------------------------
    def get_baseline_info(self, user_id: str) -> Dict:
        history = db.load_biometrics(user_id, days=30)
        if not history:
            return {
                "stage": "PROVISIONAL", "confidence": 0, "data_points": 0,
                "days_established": 0, "days_required": self.MIN_BASELINE_DAYS,
                "label": _STAGE_LABELS["PROVISIONAL"],
            }
        df = pd.DataFrame(history)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        date_span = (df["timestamp"].max() - df["timestamp"].min()).total_seconds() / 86400
        confidence = int(min(100, (date_span / self.MIN_BASELINE_DAYS) * 100))
        if   confidence < 30:  stage = "PROVISIONAL"
        elif confidence < 60:  stage = "CALIBRATING"
        elif confidence < 100: stage = "PERSONALISING"
        else:                  stage = "PERSONAL"
        return {
            "stage": stage, "confidence": confidence,
            "data_points": len(history), "days_established": round(date_span, 1),
            "days_required": self.MIN_BASELINE_DAYS, "label": _STAGE_LABELS[stage],
        }

    # ------------------------------------------------------------------
    # Readiness score
    # ------------------------------------------------------------------
    def get_readiness_score(self, user_id: str) -> Tuple[int, str, str]:
        latest = db.load_latest_biometric(user_id)
        if not latest:
            return 75, "PROVISIONAL", "STABLE"
        _, anomalies = self._evaluate(user_id, _dict_to_biometric(latest))
        score = 100 - min(100, len(anomalies) * 15)
        history = db.load_biometrics(user_id, days=14)
        trend = self._calculate_trend(history)
        info  = self.get_baseline_info(user_id)
        return max(0, score), info["stage"], trend

    def _calculate_trend(self, history: List[dict]) -> str:
        if len(history) < 7:
            return "STABLE"
        df = pd.DataFrame(history)
        col = "heart_rate_resting" if "heart_rate_resting" in df.columns else None
        if not col:
            return "STABLE"
        series = df[col].dropna()
        if len(series) < 5:
            return "STABLE"
        slope = np.polyfit(np.arange(len(series)), series.values, 1)[0]
        if slope > 0.3:  return "DECLINING"
        if slope < -0.3: return "IMPROVING"
        return "STABLE"

    # ------------------------------------------------------------------
    # Exercise context suppression
    # ------------------------------------------------------------------
    def _is_exercise_context(self, history: List[dict], current_data: BiometricData) -> bool:
        if len(history) < 10:
            return False
        steps = [r.get("step_count") or 0 for r in history if r.get("step_count") is not None]
        if not steps:
            return False
        threshold = np.percentile(steps, self.HIGH_ACTIVITY_STEPS_PERCENTILE)
        return (current_data.step_count or 0) > threshold

    # ------------------------------------------------------------------
    # Context (CVD risk profile)
    # ------------------------------------------------------------------
    def set_context(self, user_id: str, profile: ContextualProfile) -> None:
        db.save_context(user_id, profile)

    def get_context(self, user_id: str) -> Optional[ContextualProfile]:
        return db.load_context(user_id)

    # ------------------------------------------------------------------
    # Feature extraction
    # ------------------------------------------------------------------
    def _extract_features(
        self, history: List[dict], data: BiometricData, user_id: str
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Returns (hr_trend_2w, hrv_vs_baseline, sleep_pattern)."""
        if len(history) < 7:
            return None, None, None

        df = pd.DataFrame(history)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.set_index("timestamp").sort_index().tail(14)

        hr_trend_2w = None
        if "heart_rate_resting" in df.columns:
            hr = df["heart_rate_resting"].dropna()
            if len(hr) >= 5:
                slope = np.polyfit(np.arange(len(hr)), hr.values, 1)[0]
                hr_trend_2w = "rising" if slope > 0.5 else ("declining" if slope < -0.5 else "stable")

        ctx = db.load_context(user_id)
        age = ctx.age if ctx else 45
        hrv_mean, hrv_std = self._calculate_blended_baseline(history, "hrv_rmssd", age)

        hrv_vs_baseline = None
        if hrv_std and hrv_std > 0:
            if   data.hrv_rmssd < hrv_mean - 0.5 * hrv_std: hrv_vs_baseline = "below"
            elif data.hrv_rmssd > hrv_mean + 0.5 * hrv_std: hrv_vs_baseline = "above"
            else:                                             hrv_vs_baseline = "at"

        sleep_pattern = None
        if data.sleep_duration_hours and data.sleep_duration_hours > 0:
            if   data.sleep_duration_hours < 5.5: sleep_pattern = "disrupted"
            elif data.sleep_duration_hours >= 7:  sleep_pattern = "good"
            else:                                 sleep_pattern = "adequate"

        return hr_trend_2w, hrv_vs_baseline, sleep_pattern

    # ------------------------------------------------------------------
    # CVD risk — WHO 2019 non-laboratory chart (Southern sub-Saharan Africa)
    # ------------------------------------------------------------------
    # AH-45 gap report: _framingham_adapted took age/resting-HR/hypertension/
    # smoker — resting HR is not a Framingham variable, and real Framingham
    # needs cholesterol, HDL, and BP-treatment status this never collected.
    # _qrisk3_adapted called _framingham_adapted and added a fixed increment,
    # so the two scores could never actually disagree — there was no second
    # opinion to weigh. Both are replaced by a single categorical result
    # from the WHO 2019 non-lab chart, the instrument the spec identifies as
    # regionally validated (vs. global tools shown mutually uncorrelated in
    # African cohorts). §45.4: refuses to score outside the chart's
    # validated 40-74 age range, and refuses on any missing required input
    # rather than imputing a default.
    # Verified 2026-09-14 directly against the primary source: SA NDoH
    # Appendix VII's own BMI-based risk chart rows run 40-44 through 70-74
    # in 5-year bands, confirming this range against a real government
    # document rather than the original (unverified) specification alone.
    WHO_2019_MIN_AGE = 40
    WHO_2019_MAX_AGE = 74

    def _who_2019_chart_signed_off(self) -> bool:
        # Same pattern as _bp_check_prompt_signed_off (AH-45.5a) and
        # triageSafety.ts's PAEDIATRIC_TEWS_SIGNED_OFF — unset/false by
        # default, fails safe. See CLINICAL_SIGNOFF_CHECKLIST.md row 7.
        return os.environ.get("WHO_2019_CHART_SIGNED_OFF", "").strip().lower() == "true"

    def _who2019_non_lab_risk_category(
        self, profile: ContextualProfile, systolic_bp: Optional[float]
    ) -> CvdRiskAssessment:
        reasons: List[str] = []
        if profile.age < self.WHO_2019_MIN_AGE or profile.age > self.WHO_2019_MAX_AGE:
            reasons.append("OUT_OF_VALIDATED_AGE_RANGE")
        if profile.sex is None:
            reasons.append("MISSING_SEX")
        if profile.smoker is None:
            reasons.append("MISSING_SMOKING_STATUS")
        if systolic_bp is None:
            reasons.append("MISSING_SYSTOLIC_BP")
        if profile.bmi is None:
            reasons.append("MISSING_BMI")

        if reasons:
            return CvdRiskAssessment(computable=False, reasons_not_computable=reasons)

        # The WHO 2019 non-laboratory CVD risk chart for Southern
        # sub-Saharan Africa (WHO CVD Risk Chart Working Group, Lancet Glob
        # Health 2019), as adopted by SA NDoH Appendix VII (verified
        # directly against health.gov.za, 2026-09-14 — the actual mandated
        # chart), is a published COLOUR GRID of age x SBP x BMI x sex x
        # smoking-status cells, each mapping to one of four risk categories
        # (<5% / 5-10% / 10-20% / >20% — SA's own four-band collapse of
        # WHO's five-band default). It is an image, not a data table — an
        # earlier automated extraction attempt (docs/ENGINEERING_PLAN.md
        # §12/§13) and a first manual transcription attempt (§27) both
        # produced non-monotonic/self-inconsistent values and were
        # abandoned rather than shipped. §28 re-did this by rendering the
        # source at 400 DPI and colour-classifying every cell against the
        # chart's own self-calibrated palette (not the page-1 legend, which
        # uses a slightly different but consistent palette) — 700/700 cells
        # matched with zero ambiguity (only 4 distinct exact RGB values
        # across the whole grid) and zero monotonicity violations across
        # age, SBP and BMI. See who_2019_chart_data.py for the full method
        # note and docs/references/ for the source images.
        #
        # That resolves the *transcription-accuracy* gap this comment used
        # to describe — it does not resolve the separate, still-open
        # clinician sign-off gap (CLINICAL_SIGNOFF_CHECKLIST.md row 7).
        # Gated the same way as AH-45.5a (§25/§26) and paediatric TEWS
        # (§12): unset/false by default, fails safe to the same
        # not-computable response as before, just with a reason code that
        # accurately reflects which gap remains.
        if not self._who_2019_chart_signed_off():
            reasons.append("WHO_2019_CHART_AWAITING_CLINICIAN_SIGNOFF")
            return CvdRiskAssessment(computable=False, reasons_not_computable=reasons)

        color = who_2019_chart_lookup.lookup(
            profile.sex, profile.smoker, profile.age, systolic_bp, profile.bmi
        )
        if color is None:
            # age passed the WHO_2019_MIN_AGE/MAX_AGE check above but fell
            # outside the chart's own 5-year band edges somehow — should be
            # unreachable given those bounds are 40/74 matching the chart,
            # kept as a defensive non-crash rather than assumed impossible.
            reasons.append("OUT_OF_VALIDATED_AGE_RANGE")
            return CvdRiskAssessment(computable=False, reasons_not_computable=reasons)

        category_map = {"GREEN": "<5%", "YELLOW": "5-10%", "ORANGE": "10-20%", "RED": ">20%"}
        return CvdRiskAssessment(computable=True, risk_category=category_map[color])

    def _physiological_trend_flags(
        self, hr_trend: Optional[str], hrv_vs_baseline: Optional[str], sleep_pattern: Optional[str]
    ) -> List[str]:
        # AH-45 §45.5: resting HR trend, HRV-vs-baseline and sleep pattern
        # are risk *markers* in cohort studies, not inputs to any validated
        # CVD risk equation — previously folded straight into a risk
        # percentage by _custom_ml_risk/_qrisk3_adapted, which silently
        # invalidated both instruments. Surfaced here instead, explicitly
        # separate from risk_category, and never used to compute it.
        flags: List[str] = []
        if hr_trend == "rising":
            flags.append("RESTING_HR_RISING_OVER_ROLLING_WINDOW")
        if hrv_vs_baseline == "below":
            flags.append("HRV_BELOW_PERSONAL_BASELINE")
        if sleep_pattern == "disrupted":
            flags.append("SLEEP_DISRUPTED")
        return flags

    def _bp_check_prompt_signed_off(self) -> bool:
        # AH-45.5a, 2026-09-23: mirrors triageSafety.ts's
        # PAEDIATRIC_TEWS_SIGNED_OFF gate (docs/ENGINEERING_PLAN.md §12) —
        # unset/false by default, fails safe. Gates only the actionable
        # prompt_bp_check claim (sign-off condition #1); the underlying
        # deviation signals stay computed regardless — see BpRiskAssessment
        # docstring and CLINICAL_SIGNOFF_CHECKLIST.md row 10.
        return os.environ.get("BP_CHECK_PROMPT_SIGNED_OFF", "").strip().lower() == "true"

    def _bp_risk_trend(
        self, history: List[dict], data: BiometricData, age: Optional[int]
    ) -> BpRiskAssessment:
        # AH-45.5a, 2026-09-22: reuses the same AH-50-hardened deviation
        # primitives _evaluate() uses for HR/HRV, rather than the weaker,
        # ungated hr_trend_2w/hrv_vs_baseline from _extract_features (raw
        # 14-day slope; raw z-score on right-skewed RMSSD — exactly what
        # AH-50 replaced HRV's general handling with _hrv_deviation over).
        # Independent of _evaluate()'s own call to these same functions —
        # see BpRiskAssessment docstring for why this must never feed
        # cvd_risk.risk_category or override an AH-43/44 floor escalation.
        signals: List[str] = []

        hr_deviation = False
        mean, std = self._calculate_blended_baseline(history, "heart_rate_resting", age)
        if std > 0:
            recent = self._recent_metric_values(history, data.heart_rate_resting, "heart_rate_resting")
            hr_deviation, _ = self._persistent_anomaly(recent, mean, std, "high")
            if hr_deviation:
                signals.append("RESTING_HR_PERSISTENTLY_ABOVE_OWN_BASELINE")

        hrv_deviation, _ = self._hrv_deviation(history, data)
        if hrv_deviation:
            signals.append("HRV_SHIFTED_FROM_OWN_BASELINE")

        short_sleep = bool(data.sleep_duration_hours and 0 < data.sleep_duration_hours < 5.5)
        if short_sleep:
            signals.append("SHORT_SLEEP_DURATION")  # Itani et al. 2016, 10.1016/j.sleep.2016.08.006

        signed_off = self._bp_check_prompt_signed_off()
        return BpRiskAssessment(
            prompt_bp_check=bool(signals) and signed_off,
            hr_deviation=hr_deviation,
            hrv_deviation=hrv_deviation,
            short_sleep=short_sleep,
            signed_off=signed_off,
            contributing_signals=signals,
        )

    def _epidemiological_flags(self, profile: ContextualProfile) -> List[str]:
        # AH-45 §45.6: no major CVD calculator (including WHO 2019) accounts
        # for HIV or active TB, both common in this population — surfaced
        # as an explicit flag next to the risk category, never as a hidden
        # multiplier invented for this codebase.
        flags: List[str] = []
        if profile.hiv_positive:
            flags.append("HIV_POSITIVE_INSTRUMENT_LIKELY_UNDERESTIMATES_RISK")
        if profile.active_tb:
            flags.append("ACTIVE_TB_INSTRUMENT_LIKELY_UNDERESTIMATES_RISK")
        return flags

    def _fusion_from_cvd_risk(self, cvd_risk: CvdRiskAssessment) -> FusionOutput:
        # AH-45 §45.1: no more arithmetic trajectory projection — alert is
        # driven only by the categorical result (or a future discordance
        # flag), never a blended/averaged number.
        # Verified 2026-09-14 against SA NDoH Appendix VII (health.gov.za):
        # the mandated chart's top band is ">20%", not WHO's default
        # 20-<30%/>=30% split — see CvdRiskCategory in models.py.
        high_risk = cvd_risk.computable and cvd_risk.risk_category == ">20%"
        alert_triggered = high_risk or cvd_risk.discordance_flag
        message = None
        if high_risk:
            message = f"WHO 2019 non-lab CVD risk category: {cvd_risk.risk_category}. Recommend clinical follow-up."
        elif cvd_risk.discordance_flag:
            message = "CVD risk instruments disagree — recommend clinician review."
        return FusionOutput(alert_triggered=alert_triggered, alert_message=message)

    # ------------------------------------------------------------------
    # Full analysis
    # ------------------------------------------------------------------
    def full_analysis(
        self, user_id: str, data: BiometricData,
        context: Optional[ContextualProfile] = None,
    ) -> EarlyWarningSummary:
        """Run full pipeline: anomaly detection + CVD risk + fusion."""
        profile = context or db.load_context(user_id)
        profile_was_missing = profile is None
        if profile is None:
            # AH-45 §45.4: no imputed default — smoker/sex/systolic_bp/bmi
            # stay None (unknown), not assumed. age=50 is only ever used as
            # a demographic-seed lookup for the baseline blend below, never
            # fed into the WHO 2019 chart itself without a real profile.
            profile = ContextualProfile(age=50)
        if context:
            db.save_context(user_id, context)

        history = db.load_biometrics(
            user_id, days=self.MIN_BASELINE_DAYS + self.ROLLING_WINDOW_DAYS + 1
        )
        alert_level, anomalies = self._evaluate(user_id, data)

        age = profile.age
        hr_baseline,  _ = self._calculate_blended_baseline(history, "heart_rate_resting", age)
        hrv_baseline, _ = self._calculate_blended_baseline(history, "hrv_rmssd",          age)
        hr_trend, hrv_vs_baseline, sleep_pattern = self._extract_features(history, data, user_id)

        cvd_risk = self._who2019_non_lab_risk_category(profile, profile.systolic_bp)
        cvd_risk.physiological_trend_flags = self._physiological_trend_flags(
            hr_trend, hrv_vs_baseline, sleep_pattern
        )
        cvd_risk.epidemiological_flags = self._epidemiological_flags(profile)
        bp_risk = self._bp_risk_trend(history, data, age)
        fusion = self._fusion_from_cvd_risk(cvd_risk)

        clinical_flags: List[str] = []
        if getattr(data, "ecg_rhythm", None) == "irregular":
            clinical_flags.append("Atrial fibrillation suspected")
        if hrv_vs_baseline == "below" and hrv_baseline:
            clinical_flags.append("HRV below threshold")
        if data.heart_rate_resting > hr_baseline + 10:
            clinical_flags.append("Resting HR above personal baseline")

        recommendations: List[str] = []
        if fusion.alert_triggered and fusion.alert_message:
            recommendations.append(fusion.alert_message)
        if data.sleep_duration_hours and data.sleep_duration_hours < 6:
            recommendations.append("Increase sleep duration to improve recovery.")
        if hrv_vs_baseline == "below":
            recommendations.append("Low HRV may indicate stress. Try guided breathing.")
        if getattr(data, "ecg_rhythm", None) == "irregular":
            recommendations.append("Your heart rhythm shows irregularities. Please consult a doctor.")

        uncertainty = self._estimate_uncertainty(history, None if profile_was_missing else profile, data, alert_level)
        provenance = self._build_provenance(user_id, data, alert_level)
        requires_clinician_review = (
            alert_level != AlertLevel.GREEN
            or uncertainty.score >= 0.45
            or getattr(data, "ecg_rhythm", "unknown") == "irregular"
        )

        if uncertainty.score >= 0.45:
            recommendations.append(
                "Signal quality/context is limited for autonomous interpretation; clinician review is recommended before acting on this result."
            )

        return EarlyWarningSummary(
            user_id=user_id,
            processed_at=datetime.utcnow(),
            heart_rate_resting=data.heart_rate_resting,
            hrv_rmssd=data.hrv_rmssd,
            spo2=data.spo2,
            sleep_duration_hours=getattr(data, "sleep_duration_hours", 0) or 0,
            step_count=data.step_count or 0,
            ecg_rhythm=getattr(data, "ecg_rhythm", "unknown") or "unknown",
            temperature_trend=getattr(data, "temperature_trend", "normal") or "normal",
            hr_baseline=hr_baseline or None,
            hrv_baseline=hrv_baseline or None,
            hr_trend_2w=hr_trend,
            hrv_vs_baseline=hrv_vs_baseline,
            sleep_pattern=sleep_pattern,
            cvd_risk=cvd_risk,
            bp_risk=bp_risk,
            fusion=fusion,
            clinical_flags=clinical_flags,
            alert_level=alert_level,
            anomalies=anomalies,
            recommendations=recommendations,
            uncertainty=uncertainty,
            provenance=provenance,
            requires_clinician_review=requires_clinician_review,
        )
