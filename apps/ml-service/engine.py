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
from models import (
    BiometricData, AlertLevel, ContextualProfile,
    RiskScores, FusionOutput, EarlyWarningSummary,
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
        self.MIN_BASELINE_DAYS = 14
        self.ROLLING_WINDOW_DAYS = 7
        self.SIGMA_YELLOW = 1.5
        self.SIGMA_RED = 2.5
        self.HIGH_ACTIVITY_STEPS_PERCENTILE = 90

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
        history = db.load_biometrics(
            user_id, days=self.MIN_BASELINE_DAYS + self.ROLLING_WINDOW_DAYS + 1
        )
        if not history:
            return AlertLevel.GREEN, ["No history yet — using population baseline"]

        if self._is_exercise_context(history, data):
            return AlertLevel.GREEN, ["Suppressed: High physical activity detected"]

        ctx = db.load_context(user_id)
        age = ctx.age if ctx else 45

        anomalies: List[str] = []
        significant_deviations = 0

        metrics = {
            "heart_rate_resting": (data.heart_rate_resting, "high"),
            "hrv_rmssd":          (data.hrv_rmssd,          "low"),
            "spo2":               (data.spo2,               "low"),
            "respiratory_rate":   (data.respiratory_rate,   "high"),
        }

        for metric_name, (value, bad_direction) in metrics.items():
            mean, std = self._calculate_blended_baseline(history, metric_name, age)
            if std == 0:
                continue
            z_score = (value - mean) / std
            is_anomaly = (
                (bad_direction == "high" and z_score > self.SIGMA_YELLOW) or
                (bad_direction == "low"  and z_score < -self.SIGMA_YELLOW)
            )
            if is_anomaly:
                anomalies.append(
                    f"{metric_name} ({value:.1f}) is {z_score:.1f}\u03c3 from baseline ({mean:.1f})"
                )
                significant_deviations += 2 if abs(z_score) > self.SIGMA_RED else 1

        if significant_deviations >= 3:
            alert_level = AlertLevel.RED
        elif significant_deviations >= 1:
            alert_level = AlertLevel.YELLOW
        else:
            alert_level = AlertLevel.GREEN

        return alert_level, anomalies

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

        if not history:
            return demo_mean, demo_std

        df = pd.DataFrame(history)
        if metric not in df.columns:
            return demo_mean, demo_std

        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.set_index("timestamp").sort_index()
        series = df[metric].dropna()
        if series.empty:
            return demo_mean, demo_std

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
        return blended_mean, max(blended_std, 0.1)

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
    # CVD risk algorithms
    # ------------------------------------------------------------------
    def _framingham_adapted(self, profile: ContextualProfile, heart_rate_resting: float) -> float:
        age_pts   = min(4, max(0, (profile.age - 30) // 10)) if profile.age >= 30 else 0
        hr_pts    = 2 if heart_rate_resting >= 90 else (1 if heart_rate_resting >= 80 else 0)
        ht_pts    = 2 if profile.hypertension else 0
        smoke_pts = 1 if profile.smoker else 0
        return min(100.0, round(5.0 + (age_pts + hr_pts + ht_pts + smoke_pts) * 2.2, 1))

    def _qrisk3_adapted(
        self, profile: ContextualProfile,
        heart_rate_resting: float, hrv_rmssd: float,
        sleep_hours: float, step_count: int,
    ) -> float:
        fram   = self._framingham_adapted(profile, heart_rate_resting)
        uplift = 0.0
        if 0 < hrv_rmssd < 25:    uplift += 2.0
        if 0 < sleep_hours < 6:   uplift += 1.5
        if 0 < step_count < 5000: uplift += 1.5
        return min(100.0, round(fram + uplift, 1))

    def _custom_ml_risk(
        self, heart_rate_resting: float, hrv_rmssd: float,
        sleep_hours: float, ecg_rhythm: str, step_count: int,
    ) -> Tuple[float, float]:
        risk = 12.0
        if heart_rate_resting >= 80:  risk += (heart_rate_resting - 80) * 0.15
        if 0 < hrv_rmssd < 30:        risk += (30 - hrv_rmssd) * 0.2
        if 0 < sleep_hours < 6:       risk += 3.0
        if ecg_rhythm == "irregular": risk += 6.0
        if 0 < step_count < 4000:     risk += 2.0
        risk = min(100.0, round(risk, 1))
        conf = min(1.0, round(0.75 + (heart_rate_resting + hrv_rmssd) / 1000.0, 2))
        return risk, conf

    def _fusion_trajectory(
        self, risk_scores: RiskScores,
        hr_trend: Optional[str], hrv_vs_baseline: Optional[str], ecg_rhythm: str,
    ) -> FusionOutput:
        current = risk_scores.ml_cvd_risk_pct
        trajectory_2y = current
        if hr_trend == "rising" and (hrv_vs_baseline == "below" or ecg_rhythm == "irregular"):
            trajectory_2y = min(100.0, round(current + 6.0, 1))
        alert_triggered = current >= 20 or (trajectory_2y >= 28 and current >= 18)
        message = "High cardiovascular risk detected. Recommend clinical follow-up." if alert_triggered else None
        return FusionOutput(
            trajectory_risk_2y_pct=trajectory_2y,
            alert_triggered=alert_triggered,
            alert_message=message,
        )

    # ------------------------------------------------------------------
    # Full analysis
    # ------------------------------------------------------------------
    def full_analysis(
        self, user_id: str, data: BiometricData,
        context: Optional[ContextualProfile] = None,
    ) -> EarlyWarningSummary:
        """Run full pipeline: anomaly detection + CVD risk + fusion."""
        profile = context or db.load_context(user_id)
        if profile is None:
            profile = ContextualProfile(age=50, smoker=False, hypertension=False)
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

        fram  = self._framingham_adapted(profile, data.heart_rate_resting)
        qrisk = self._qrisk3_adapted(
            profile, data.heart_rate_resting, data.hrv_rmssd,
            data.sleep_duration_hours or 0, data.step_count or 0,
        )
        ml_risk, ml_conf = self._custom_ml_risk(
            data.heart_rate_resting, data.hrv_rmssd,
            data.sleep_duration_hours or 0,
            getattr(data, "ecg_rhythm", "unknown") or "unknown",
            data.step_count or 0,
        )
        risk_scores = RiskScores(
            framingham_10y_pct=fram, qrisk3_10y_pct=qrisk,
            ml_cvd_risk_pct=ml_risk, ml_confidence=ml_conf,
        )
        fusion = self._fusion_trajectory(
            risk_scores, hr_trend, hrv_vs_baseline,
            getattr(data, "ecg_rhythm", "unknown") or "unknown",
        )

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
            risk_scores=risk_scores,
            fusion=fusion,
            clinical_flags=clinical_flags,
            alert_level=alert_level,
            anomalies=anomalies,
            recommendations=recommendations,
        )
