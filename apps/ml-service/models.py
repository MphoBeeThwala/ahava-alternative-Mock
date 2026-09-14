from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime
from enum import Enum

class AlertLevel(str, Enum):
    GREEN = "GREEN"     # Normal
    YELLOW = "YELLOW"   # Warning (1.5 sigma)
    RED = "RED"         # Critical (2.5 sigma)

class BiometricData(BaseModel):
    timestamp: datetime = Field(..., description="ISO 8601 timestamp of measurement")
    heart_rate_resting: float = Field(..., ge=30, le=200, description="Resting Heart Rate (bpm)")
    hrv_rmssd: float = Field(..., ge=0, le=300, description="HRV (ms)")
    spo2: float = Field(..., ge=50, le=100, description="Blood Oxygen (%)")
    skin_temp_offset: float = Field(..., ge=-5.0, le=5.0, description="Deviation from baseline temp (standardized)")
    respiratory_rate: float = Field(..., ge=4, le=60, description="Breaths per minute")
    step_count: int = Field(0, ge=0, description="Total steps in last window (Context Filter)")
    active_calories: float = Field(0, ge=0, description="Active calories (Context Filter)")
    # Extended wearable metrics for CVD early warning
    sleep_duration_hours: float = Field(0.0, ge=0, le=24, description="Sleep duration (hours/night)")
    ecg_rhythm: Literal["regular", "irregular", "unknown"] = Field("unknown", description="Single-lead ECG rhythm")
    temperature_trend: Literal["normal", "elevated_single_day", "elevated_over_3_days"] = Field("normal", description="Temperature trend over recent days")

class ContextualProfile(BaseModel):
    """Contextual inputs for CVD risk (WHO 2019 chart). POPIA: store minimally.

    AH-45 gap report: smoker/sex/systolic_bp/bmi are Optional with no
    default — §45.4 explicitly forbids imputing a default ("no assumed
    non-smoker"), so absence must be distinguishable from a real "no".
    hypertension is kept for display/other use but is not a WHO 2019
    non-lab input (systolic_bp is the actual input). cholesterol_known/
    cholesterol_mmol_per_L and diabetes are for the future WHO 2019
    laboratory-chart upgrade path, not used by the non-lab chart.
    """
    age: int = Field(..., ge=18, le=120, description="Patient age (years)")
    sex: Optional[Literal["male", "female"]] = None
    smoker: Optional[bool] = None
    systolic_bp: Optional[float] = Field(None, ge=60, le=300, description="Systolic BP (mmHg) — WHO 2019 input")
    bmi: Optional[float] = Field(None, ge=10, le=80, description="Body mass index — WHO 2019 non-lab input")
    hypertension: bool = False
    cholesterol_known: bool = False
    cholesterol_mmol_per_L: Optional[float] = Field(None, ge=2.0, le=15.0)
    diabetes: Optional[bool] = None
    # AH-45 §45.6: no calculator adjusts for either, and both are common in
    # this population — surfaced as flags, never as a hidden multiplier.
    hiv_positive: Optional[bool] = None
    active_tb: Optional[bool] = None

class IngestResponse(BaseModel):
    user_id: str
    status: str
    processed_at: datetime
    alert_level: AlertLevel
    anomalies: List[str] = []
    message: str

class ReadinessScore(BaseModel):
    user_id: str
    score: int = Field(..., ge=0, le=100)
    baseline_status: str
    trend: str # "STABLE", "DECLINING", "IMPROVING"

# --- Early Warning / CVD risk outputs ---
# AH-45 gap report: _framingham_adapted and _qrisk3_adapted were not the
# named instruments — real Framingham doesn't take resting heart rate, and
# the "QRISK3" score was the Framingham stand-in plus a fixed increment, so
# the two could never disagree. Replaced with a single categorical WHO 2019
# non-laboratory chart result (age/sex/smoking/SBP/BMI, Southern
# sub-Saharan Africa region) — a real number this codebase never had.
CvdRiskCategory = Literal["<5%", "5-<10%", "10-<20%", "20-<30%", ">=30%"]

class CvdRiskAssessment(BaseModel):
    instrument: str = "WHO_2019_NON_LAB_SOUTHERN_SUB_SAHARAN_AFRICA"
    computable: bool = False
    risk_category: Optional[CvdRiskCategory] = Field(
        None, description="WHO 2019 non-lab 10-year fatal/non-fatal CVD risk category; null when not computable"
    )
    reasons_not_computable: List[str] = Field(default_factory=list)
    # §45.2: infrastructure for a second validated instrument to flag
    # disagreement, never to average with this one. Always False today —
    # there is currently no second real instrument implemented to compare
    # against (see reasons_not_computable when this fires in the future).
    discordance_flag: bool = False
    # §45.5: wearable-derived signals (resting HR trend, HRV vs baseline,
    # sleep) are risk *markers* in cohort studies, not inputs to any
    # validated CVD risk equation — kept here, explicitly separate from
    # risk_category, and never used to compute it.
    physiological_trend_flags: List[str] = Field(default_factory=list)
    # §45.6: HIV/TB status the instrument does not account for.
    epidemiological_flags: List[str] = Field(default_factory=list)

class FusionOutput(BaseModel):
    # AH-45 §45.1: no longer computed by any arithmetic projection — a
    # 2-year trajectory from a "+6.0 if rising" heuristic was exactly the
    # kind of unsourced number this fix removes. Kept as an always-None
    # field rather than deleted outright, since routes/patient.ts's
    # ML-service-unavailable fallback already references this shape.
    trajectory_risk_2y_pct: Optional[float] = Field(None, ge=0, le=100, description="Not computed — retained for response-shape compatibility only")
    alert_triggered: bool = False
    alert_message: Optional[str] = None

class UncertaintyProfile(BaseModel):
    score: float = Field(..., ge=0, le=1, description="Overall uncertainty score")
    reasons: List[str] = Field(default_factory=list, description="Machine-readable uncertainty factors")

class ClinicalProvenance(BaseModel):
    evidence_sources: List[str] = Field(default_factory=list, description="Approved evidence sources used by this decision")
    clinical_basis: List[str] = Field(default_factory=list, description="Deterministic/clinical rule families applied")
    model_version: str = Field(..., description="ML engine version string")
    decision_trace_id: str = Field(..., description="Deterministic trace id for auditability")

class EarlyWarningSummary(BaseModel):
    user_id: str
    processed_at: datetime
    # Current metrics (from latest data)
    heart_rate_resting: float
    hrv_rmssd: float
    spo2: float
    sleep_duration_hours: float
    step_count: int
    ecg_rhythm: str
    temperature_trend: str
    # Baselines (personal norms)
    hr_baseline: Optional[float] = None
    hrv_baseline: Optional[float] = None
    # Extracted features
    hr_trend_2w: Optional[str] = None  # "rising", "stable", "declining"
    hrv_vs_baseline: Optional[str] = None  # "below", "at", "above"
    sleep_pattern: Optional[str] = None  # "disrupted", "adequate", "good"
    # Risk scores
    cvd_risk: CvdRiskAssessment
    fusion: FusionOutput
    # Clinical flags
    clinical_flags: List[str] = []
    alert_level: AlertLevel
    anomalies: List[str] = []
    recommendations: List[str] = []
    uncertainty: UncertaintyProfile
    provenance: ClinicalProvenance
    requires_clinician_review: bool = False
