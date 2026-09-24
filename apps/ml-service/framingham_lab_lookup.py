"""Point-computation and lookup helpers for framingham_lab_data.

Not clinically signed off — see CLINICAL_SIGNOFF_CHECKLIST.md row 11 and
ENGINEERING_PLAN.md #32. Gated behind FRAMINGHAM_LAB_CHART_SIGNED_OFF in
engine.py; do not call this from anywhere that bypasses that gate.
"""
from typing import List, Optional, Tuple
import framingham_lab_data as data

AGE_MIN = 30
AGE_MAX = 79


def _age_band_points(sex: str, age: int) -> Optional[int]:
    for (lo, hi), pts in data.AGE_POINTS[sex].items():
        if lo <= age <= hi:
            return pts
    return None


def _range_lookup(ranges: List[Tuple[Optional[float], Optional[float], int]], value: float) -> Optional[int]:
    for lo, hi, pts in ranges:
        if lo is not None and value < lo:
            continue
        if hi is not None and value > hi:
            continue
        return pts
    return None


def compute_points(
    sex: str, age: int, total_cholesterol: float, hdl: float, smoker: bool,
    diabetic: bool, systolic_bp: float, bp_treated: bool,
) -> Optional[int]:
    """Returns total points, or None if age is outside the chart's own
    30-79 range (caller must already have validated other inputs are
    non-None)."""
    age_pts = _age_band_points(sex, age)
    if age_pts is None:
        return None
    chol_pts = _range_lookup(data.TOTAL_CHOL_POINTS[sex], total_cholesterol)
    hdl_pts = _range_lookup(data.HDL_POINTS, hdl)
    sbp_pts = _range_lookup(data.SBP_POINTS[sex]["treated" if bp_treated else "untreated"], systolic_bp)
    if chol_pts is None or hdl_pts is None or sbp_pts is None:
        return None
    smoker_pts = data.SMOKER_POINTS[sex] if smoker else 0
    diabetic_pts = data.DIABETIC_POINTS[sex] if diabetic else 0
    return age_pts + chol_pts + hdl_pts + sbp_pts + smoker_pts + diabetic_pts


def points_to_risk(sex: str, total_points: int) -> Tuple[Optional[float], Optional[str]]:
    """Returns (exact_risk_pct, bound) — exactly one is non-None (unless
    points fall entirely outside the table, where both are None: only
    happens for women above 19 points, since the source prints no
    open-ended top row for women)."""
    if sex == "male":
        if total_points <= data.MEN_MIN_POINTS:
            return None, "<1"
        if total_points >= data.MEN_MAX_POINTS:
            return None, ">30"
        return data.MEN_POINTS_TO_RISK.get(total_points), None
    else:
        if total_points <= data.WOMEN_MIN_POINTS:
            return None, "<1"
        return data.WOMEN_POINTS_TO_RISK.get(total_points), None
