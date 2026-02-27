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
    """Contextual inputs for CVD risk (Framingham/QRISK3). POPIA: store minimally."""
    age: int = Field(..., ge=18, le=120, description="Patient age (years)")
    smoker: bool = False
    hypertension: bool = False
    cholesterol_known: bool = False
    cholesterol_mmol_per_L: Optional[float] = Field(None, ge=2.0, le=15.0)

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
class RiskScores(BaseModel):
    framingham_10y_pct: float = Field(..., ge=0, le=100, description="Adapted Framingham 10-year CVD risk %")
    qrisk3_10y_pct: float = Field(..., ge=0, le=100, description="Adapted QRISK3 10-year CVD risk %")
    ml_cvd_risk_pct: float = Field(..., ge=0, le=100, description="Custom ML predicted CVD risk %")
    ml_confidence: float = Field(..., ge=0, le=1, description="ML model confidence 0-1")

class FusionOutput(BaseModel):
    trajectory_risk_2y_pct: Optional[float] = Field(None, ge=0, le=100, description="Projected risk in 2 years if trends persist")
    alert_triggered: bool = False
    alert_message: Optional[str] = None

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
    risk_scores: RiskScores
    fusion: FusionOutput
    # Clinical flags
    clinical_flags: List[str] = []
    alert_level: AlertLevel
    anomalies: List[str] = []
    recommendations: List[str] = []
