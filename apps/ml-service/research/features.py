"""
Feature construction: ONE implementation, used for training and for shadow
scoring, so the two cannot drift apart.

Input is a snapshot dict (the wire shape of a ResearchSnapshot row: camelCase
keys, `observedDay` as YYYY-MM-DD) plus that subject's earlier snapshots.

Causality rule: history is strictly earlier *days* than the snapshot. Nothing
recorded on or after the snapshot's day can influence its features.

Missing stays missing (NaN). Imputation happens once, inside the trained
artifact, with medians learned from the training data; there are no hidden
defaults here. Whether a value was measured at all is itself informative in
field data, so the commonly absent ones carry an explicit `*_missing` flag.
"""
import hashlib
import json
import math
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional

SCHEMA_VERSION = 1  # matches RESEARCH_SCHEMA_VERSION in the backend
NaN = float("nan")

# Wire columns a snapshot carries (what the backend sends to shadow scoring).
SNAPSHOT_COLUMNS = (
    "observedDay", "ageBand", "sex", "smoker", "diabetes", "hypertensionKnown", "hivPositive",
    "activeTb", "bpTreatment", "totalCholesterolMmol", "hdlMmol", "hrResting", "hrvRmssd", "spo2",
    "respRate", "skinTempOffset", "sbp", "dbp", "glucose", "bmi", "steps", "sleepHours",
    "ecgIrregular", "temperatureTrend", "source",
)

FEATURES = (
    # who
    "age_mid", "sex_male",
    # known risk factors (NaN = unknown, never "no")
    "smoker", "diabetes", "hypertension_known", "hiv_positive", "active_tb", "bp_treatment",
    "total_chol", "hdl",
    # this reading
    "hr_resting", "hrv_rmssd", "spo2", "resp_rate", "skin_temp_offset", "sbp", "dbp", "glucose",
    "bmi", "steps_k", "sleep_hours", "ecg_irregular", "temp_elevated",
    # was it measured
    "sbp_missing", "glucose_missing", "bmi_missing",
    # change against this person's own recent past (strictly earlier days)
    "n_prior_14d", "hr_delta_14d", "hrv_delta_14d", "spo2_min_14d", "sbp_mean_14d",
    "hr_slope_14d", "sleep_mean_14d", "ecg_irregular_any_14d",
)

FEATURE_SCHEMA_HASH = hashlib.sha256(
    json.dumps({"schema": SCHEMA_VERSION, "features": FEATURES}, sort_keys=True).encode()
).hexdigest()

HISTORY_WINDOW_DAYS = 14   # features use the last 14 days...
HISTORY_FETCH_DAYS = 30    # ...of up to 30 days that callers supply
MIN_PRIOR_FOR_DELTA = 3


def _num(v) -> float:
    if v is None:
        return NaN
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return NaN
    return NaN if math.isnan(f) or math.isinf(f) else f


def parse_day(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def age_mid(age_band) -> float:
    """'40-44' -> 42.0; '18-24' -> 21.0; '85+' -> 87.0; unknown -> NaN."""
    if not age_band:
        return NaN
    s = str(age_band)
    if s.endswith("+"):
        return _num(s[:-1]) + 2.0
    try:
        lo, hi = s.split("-")
        return (float(lo) + float(hi)) / 2.0
    except ValueError:
        return NaN


def _mean(xs: List[float]) -> float:
    xs = [x for x in xs if not math.isnan(x)]
    return sum(xs) / len(xs) if xs else NaN


def _slope(points: List[tuple]) -> float:
    """Least-squares slope (per day) over (day_offset, value) points; NaN if < 3 points or no spread."""
    pts = [(x, y) for x, y in points if not math.isnan(y)]
    if len(pts) < MIN_PRIOR_FOR_DELTA:
        return NaN
    mx = sum(x for x, _ in pts) / len(pts)
    my = sum(y for _, y in pts) / len(pts)
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    if sxx == 0:
        return NaN
    return sum((x - mx) * (y - my) for x, y in pts) / sxx


def build_features(snapshot: Dict, history: Optional[Iterable[Dict]] = None) -> Dict[str, float]:
    """Feature dict (every name in FEATURES, NaN where unknown) for one snapshot."""
    day = parse_day(snapshot["observedDay"])
    since = day - timedelta(days=HISTORY_WINDOW_DAYS)
    prior = []
    for h in history or ():
        hd = parse_day(h["observedDay"])
        if since <= hd < day:  # strictly earlier days only
            prior.append((hd, h))

    def col(key: str) -> List[float]:
        return [_num(h.get(key)) for _, h in prior]

    hr_now, hrv_now = _num(snapshot.get("hrResting")), _num(snapshot.get("hrvRmssd"))
    sbp, glucose, bmi = _num(snapshot.get("sbp")), _num(snapshot.get("glucose")), _num(snapshot.get("bmi"))
    sex = snapshot.get("sex")
    trend = snapshot.get("temperatureTrend")
    steps = _num(snapshot.get("steps"))

    def delta(now: float, past: List[float]) -> float:
        known = [x for x in past if not math.isnan(x)]
        if math.isnan(now) or len(known) < MIN_PRIOR_FOR_DELTA:
            return NaN
        return now - sum(known) / len(known)

    spo2_past = [x for x in col("spo2") if not math.isnan(x)]
    spo2_now = _num(snapshot.get("spo2"))
    spo2_vals = spo2_past + ([] if math.isnan(spo2_now) else [spo2_now])
    ecg_past = [x for x in col("ecgIrregular") if not math.isnan(x)]

    f = {
        "age_mid": age_mid(snapshot.get("ageBand")),
        "sex_male": 1.0 if sex == "male" else 0.0 if sex == "female" else NaN,
        "smoker": _num(snapshot.get("smoker")),
        "diabetes": _num(snapshot.get("diabetes")),
        "hypertension_known": _num(snapshot.get("hypertensionKnown")),
        "hiv_positive": _num(snapshot.get("hivPositive")),
        "active_tb": _num(snapshot.get("activeTb")),
        "bp_treatment": _num(snapshot.get("bpTreatment")),
        "total_chol": _num(snapshot.get("totalCholesterolMmol")),
        "hdl": _num(snapshot.get("hdlMmol")),
        "hr_resting": hr_now,
        "hrv_rmssd": hrv_now,
        "spo2": spo2_now,
        "resp_rate": _num(snapshot.get("respRate")),
        "skin_temp_offset": _num(snapshot.get("skinTempOffset")),
        "sbp": sbp,
        "dbp": _num(snapshot.get("dbp")),
        "glucose": glucose,
        "bmi": bmi,
        "steps_k": steps / 1000.0 if not math.isnan(steps) else NaN,
        "sleep_hours": _num(snapshot.get("sleepHours")),
        "ecg_irregular": _num(snapshot.get("ecgIrregular")),
        "temp_elevated": NaN if trend is None else (0.0 if trend == "normal" else 1.0),
        "sbp_missing": 1.0 if math.isnan(sbp) else 0.0,
        "glucose_missing": 1.0 if math.isnan(glucose) else 0.0,
        "bmi_missing": 1.0 if math.isnan(bmi) else 0.0,
        "n_prior_14d": float(len(prior)),
        "hr_delta_14d": delta(hr_now, col("hrResting")),
        "hrv_delta_14d": delta(hrv_now, col("hrvRmssd")),
        "spo2_min_14d": min(spo2_vals) if spo2_vals else NaN,
        "sbp_mean_14d": _mean(col("sbp")),
        "hr_slope_14d": _slope([((hd - since).days, _num(h.get("hrResting"))) for hd, h in prior]),
        "sleep_mean_14d": _mean(col("sleepHours")),
        "ecg_irregular_any_14d": (1.0 if any(x == 1.0 for x in ecg_past) else 0.0) if ecg_past else NaN,
    }
    assert set(f) == set(FEATURES), "feature dict and FEATURES list are out of step"
    return f
