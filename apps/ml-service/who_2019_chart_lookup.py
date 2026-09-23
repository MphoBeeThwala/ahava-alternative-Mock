"""Band-lookup helpers for who_2019_chart_data.CHART.

Not clinically signed off — see CLINICAL_SIGNOFF_CHECKLIST.md row 7 and
ENGINEERING_PLAN.md #27/#28. Gated behind WHO_2019_CHART_SIGNED_OFF in
engine.py's _who2019_non_lab_risk_category; do not call this from anywhere
that bypasses that gate.
"""
from typing import Optional
from who_2019_chart_data import CHART

_AGE_BANDS = ["40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74"]
_SBP_BANDS = ["<120", "120-139", "140-159", "160-179", "≥180"]
_BMI_BANDS = ["<20", "20-24", "25-29", "30-35", "≥35"]


def _age_band(age: int) -> Optional[str]:
    if age < 40 or age > 74:
        return None
    idx = min((age - 40) // 5, 6)
    return _AGE_BANDS[idx]


def _sbp_band(sbp: float) -> str:
    if sbp < 120:
        return "<120"
    if sbp < 140:
        return "120-139"
    if sbp < 160:
        return "140-159"
    if sbp < 180:
        return "160-179"
    return "≥180"


def _bmi_band(bmi: float) -> str:
    if bmi < 20:
        return "<20"
    if bmi < 25:
        return "20-24"
    if bmi < 30:
        return "25-29"
    if bmi < 35:
        return "30-35"
    return "≥35"


def lookup(sex: str, smoker: bool, age: int, systolic_bp: float, bmi: float) -> Optional[str]:
    """Returns 'GREEN'|'YELLOW'|'ORANGE'|'RED', or None if age is out of the
    chart's validated 40-74 range (caller must already have validated the
    other inputs are non-None per _who2019_non_lab_risk_category)."""
    age_band = _age_band(age)
    if age_band is None:
        return None
    key = (sex, smoker, age_band, _sbp_band(systolic_bp), _bmi_band(bmi))
    return CHART[key]
