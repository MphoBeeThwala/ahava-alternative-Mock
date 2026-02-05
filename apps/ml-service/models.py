from pydantic import BaseModel, Field
from typing import List, Optional
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
