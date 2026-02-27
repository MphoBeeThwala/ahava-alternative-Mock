import numpy as np
import pandas as pd
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
from models import (
    BiometricData, AlertLevel, ContextualProfile,
    RiskScores, FusionOutput, EarlyWarningSummary,
)

# Mock database (In-memory for MVP, replace with InfluxDB/TimescaleDB)
DATA_STORE: Dict[str, List[BiometricData]] = {}
CONTEXT_STORE: Dict[str, ContextualProfile] = {}

# Numeric columns used for baseline/trend (exclude timestamp and categoricals)
BASELINE_METRICS = [
    "heart_rate_resting", "hrv_rmssd", "spo2", "respiratory_rate",
    "step_count", "active_calories", "sleep_duration_hours",
]

class EarlyWarningEngine:
    def __init__(self):
        self.MIN_BASELINE_DAYS = 14
        self.ROLLING_WINDOW_DAYS = 7
        
        # Thresholds
        self.SIGMA_YELLOW = 1.5
        self.SIGMA_RED = 2.5
        
        # False Positive Thresholds (Context)
        self.HIGH_ACTIVITY_STEPS_PERCENTILE = 90

    def _evaluate(self, user_id: str, data: BiometricData, *, append: bool = True) -> Tuple[AlertLevel, List[str]]:
        """
        Evaluate one data point (optionally append to store).
        Returns (AlertLevel, List of detected anomalies).
        """
        if append:
            if user_id not in DATA_STORE:
                DATA_STORE[user_id] = []
            DATA_STORE[user_id].append(data)
        history = DATA_STORE.get(user_id, [])
        if not history:
            return AlertLevel.GREEN, ["No history yet"]

        # 1. Check Baseline Sufficiency
        if not self._has_sufficient_history(history):
            return AlertLevel.GREEN, ["Insufficient baseline data"]

        # 2. Context Filter (Exercise?)
        if self._is_exercise_context(user_id, data):
            return AlertLevel.GREEN, ["Suppressed: High physical activity detected"]

        # 3. Calculate Z-Scores & Anomalies
        anomalies = []
        alert_level = AlertLevel.GREEN
        
        # Metrics to analyze
        metrics = {
            'heart_rate_resting': (data.heart_rate_resting, 'high'), # Alert if high
            'hrv_rmssd': (data.hrv_rmssd, 'low'),                   # Alert if low
            'spo2': (data.spo2, 'low'),                             # Alert if low
            'respiratory_rate': (data.respiratory_rate, 'high')     # Alert if high
        }
        
        significant_deviations = 0
        
        for metric_name, (value, bad_direction) in metrics.items():
            mean, std = self._calculate_baseline(user_id, metric_name)
            
            if std == 0: continue # Avoid div by zero
            
            z_score = (value - mean) / std
            
            # Check directionality
            is_anomaly = False
            if bad_direction == 'high' and z_score > self.SIGMA_YELLOW:
                is_anomaly = True
            elif bad_direction == 'low' and z_score < -self.SIGMA_YELLOW:
                is_anomaly = True
                
            if is_anomaly:
                severity = "RED" if abs(z_score) > self.SIGMA_RED else "YELLOW"
                anomalies.append(f"{metric_name} ({value}) is {z_score:.1f}σ from baseline ({mean:.1f})")
                
                if abs(z_score) > self.SIGMA_RED:
                    significant_deviations += 2 # Weight RED higher
                else:
                    significant_deviations += 1

        # 4. Sensor Fusion Logic
        # Need correlation for a RED alert unless single metric is extreme (>3 sigma could be immediate red, but sticking to specs)
        if significant_deviations >= 3: # Multiple Yellows or One Red + One Yellow
             alert_level = AlertLevel.RED
        elif significant_deviations >= 1:
             alert_level = AlertLevel.YELLOW

        return alert_level, anomalies

    def ingest(self, user_id: str, data: BiometricData) -> Tuple[AlertLevel, List[str]]:
        """Process new data point (store + evaluate). Returns (AlertLevel, anomalies)."""
        return self._evaluate(user_id, data, append=True)

    def _has_sufficient_history(self, history: List[BiometricData]) -> bool:
        if not history: return False
        start = history[0].timestamp
        end = history[-1].timestamp
        return (end - start).days >= self.MIN_BASELINE_DAYS

    def _calculate_baseline(self, user_id: str, metric: str) -> Tuple[float, float]:
        """
        Calculate Mean and StdDev using rolling window.
        Ignore first 14 days of USER history, then use last 7 days.
        """
        history = DATA_STORE[user_id]
        raw = [getattr(h, "model_dump", h.dict)() for h in history]
        df = pd.DataFrame(raw)
        if "timestamp" not in df.columns:
            return 0.0, 1.0
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp").sort_index()
        if metric not in df.columns or not np.issubdtype(df[metric].dtype, np.number):
            return 0.0, 1.0

        start_date = df.index.min()
        valid_start_date = start_date + timedelta(days=14)
        valid_data = df[df.index >= valid_start_date]
        if valid_data.empty:
            valid_data = df
        last_date = df.index.max()
        window_start = last_date - timedelta(days=self.ROLLING_WINDOW_DAYS)
        recent_data = valid_data[valid_data.index >= window_start]
        if recent_data.empty or metric not in recent_data.columns:
            return 0.0, 1.0
        s = recent_data[metric].dropna()
        if s.empty:
            return 0.0, 1.0
        return float(s.mean()), float(s.std()) if s.std() > 0 else 1.0

    def _is_exercise_context(self, user_id: str, current_data: BiometricData) -> bool:
        """
        Check if steps are > 90th percentile of user's history
        """
        history = DATA_STORE[user_id]
        if len(history) < 10: return False
        
        steps = [h.step_count for h in history]
        threshold = np.percentile(steps, self.HIGH_ACTIVITY_STEPS_PERCENTILE)
        
        return current_data.step_count > threshold

    # ---------- Contextual profile (for CVD risk) ----------
    def set_context(self, user_id: str, profile: ContextualProfile) -> None:
        CONTEXT_STORE[user_id] = profile

    def get_context(self, user_id: str) -> Optional[ContextualProfile]:
        return CONTEXT_STORE.get(user_id)

    # ---------- Feature extraction ----------
    def _extract_features(self, user_id: str, data: BiometricData) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Returns (hr_trend_2w, hrv_vs_baseline, sleep_pattern)."""
        history = DATA_STORE.get(user_id, [])
        if len(history) < 7:
            return None, None, None
        raw = [getattr(h, "model_dump", h.dict)() for h in history]
        df = pd.DataFrame(raw)
        if "timestamp" not in df.columns:
            return None, None, None
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp").sort_index().tail(14)
        hr_trend_2w = None
        if "heart_rate_resting" in df.columns:
            hr = df["heart_rate_resting"].dropna()
            if len(hr) >= 5:
                slope = np.polyfit(np.arange(len(hr)), hr.values, 1)[0]
                hr_trend_2w = "rising" if slope > 0.5 else ("declining" if slope < -0.5 else "stable")
        hr_mean, hr_std = self._calculate_baseline(user_id, "heart_rate_resting")
        hrv_mean, hrv_std = self._calculate_baseline(user_id, "hrv_rmssd")
        hrv_vs_baseline = None
        if hrv_std and hrv_std > 0:
            if data.hrv_rmssd < hrv_mean - 0.5 * hrv_std:
                hrv_vs_baseline = "below"
            elif data.hrv_rmssd > hrv_mean + 0.5 * hrv_std:
                hrv_vs_baseline = "above"
            else:
                hrv_vs_baseline = "at"
        sleep_pattern = None
        if data.sleep_duration_hours and data.sleep_duration_hours > 0:
            if data.sleep_duration_hours < 5.5:
                sleep_pattern = "disrupted"
            elif data.sleep_duration_hours >= 7:
                sleep_pattern = "good"
            else:
                sleep_pattern = "adequate"
        return hr_trend_2w, hrv_vs_baseline, sleep_pattern

    # ---------- Framingham Risk (adapted for wearable: age, HR, hypertension, smoking) ----------
    def _framingham_adapted(self, profile: ContextualProfile, heart_rate_resting: float) -> float:
        """Adapted Framingham-style 10-year CVD risk %. Uses age, HR, hypertension, smoking."""
        age_pts = min(4, max(0, (profile.age - 30) // 10)) if profile.age >= 30 else 0
        hr_pts = 0
        if heart_rate_resting >= 90:
            hr_pts = 2
        elif heart_rate_resting >= 80:
            hr_pts = 1
        ht_pts = 2 if profile.hypertension else 0
        smoke_pts = 1 if profile.smoker else 0
        total = age_pts + hr_pts + ht_pts + smoke_pts
        # Map 0–9 scale to roughly 5–35% 10y risk for this simplified model
        base_risk = 5.0 + total * 2.2
        return min(100.0, round(base_risk, 1))

    # ---------- QRISK3 adapted (adds HRV, sleep, activity) ----------
    def _qrisk3_adapted(
        self,
        profile: ContextualProfile,
        heart_rate_resting: float,
        hrv_rmssd: float,
        sleep_hours: float,
        step_count: int,
    ) -> float:
        """QRISK3-style 10y CVD % with wearable inputs."""
        fram = self._framingham_adapted(profile, heart_rate_resting)
        # Increase risk if HRV low (< 20 ms), poor sleep (< 6 h), low activity (< 5000 steps)
        uplift = 0.0
        if hrv_rmssd > 0 and hrv_rmssd < 25:
            uplift += 2.0
        if sleep_hours > 0 and sleep_hours < 6:
            uplift += 1.5
        if step_count < 5000 and step_count > 0:
            uplift += 1.5
        return min(100.0, round(fram + uplift, 1))

    # ---------- Custom ML model (placeholder: South African cohort–trained model) ----------
    def _custom_ml_risk(
        self,
        heart_rate_resting: float,
        hrv_rmssd: float,
        sleep_hours: float,
        ecg_rhythm: str,
        step_count: int,
    ) -> Tuple[float, float]:
        """Returns (10y CVD risk %, confidence 0–1). Placeholder: weighted heuristic until real model."""
        risk = 12.0
        if heart_rate_resting >= 80:
            risk += (heart_rate_resting - 80) * 0.15
        if hrv_rmssd < 30 and hrv_rmssd > 0:
            risk += (30 - hrv_rmssd) * 0.2
        if sleep_hours > 0 and sleep_hours < 6:
            risk += 3.0
        if ecg_rhythm == "irregular":
            risk += 6.0
        if step_count < 4000 and step_count > 0:
            risk += 2.0
        risk = min(100.0, round(risk, 1))
        confidence = 0.75 + min(0.15, (heart_rate_resting + hrv_rmssd) / 1000.0)
        return risk, min(1.0, round(confidence, 2))

    # ---------- Fusion: trajectory + alert ----------
    def _fusion_trajectory(
        self,
        risk_scores: RiskScores,
        hr_trend: Optional[str],
        hrv_vs_baseline: Optional[str],
        ecg_rhythm: str,
    ) -> FusionOutput:
        """Project risk in 2 years and trigger alert if high cardiovascular risk."""
        current = risk_scores.ml_cvd_risk_pct
        trajectory_2y = current
        if hr_trend == "rising" and (hrv_vs_baseline == "below" or ecg_rhythm == "irregular"):
            trajectory_2y = min(100.0, round(current + 6.0, 1))
        alert_triggered = current >= 20 or (trajectory_2y >= 28 and current >= 18)
        message = None
        if alert_triggered:
            message = "High cardiovascular risk detected. Recommend clinical follow-up."
        return FusionOutput(
            trajectory_risk_2y_pct=trajectory_2y,
            alert_triggered=alert_triggered,
            alert_message=message,
        )

    # ---------- Full early-warning analysis (metrics + risk + fusion) ----------
    def full_analysis(
        self,
        user_id: str,
        data: BiometricData,
        context: Optional[ContextualProfile] = None,
    ) -> EarlyWarningSummary:
        """Run data processing, risk scores, and fusion; return summary for Early Warning page."""
        profile = context or self.get_context(user_id)
        if profile is None:
            profile = ContextualProfile(age=50, smoker=False, hypertension=False)
        if user_id not in CONTEXT_STORE:
            CONTEXT_STORE[user_id] = profile
        # Evaluate without appending (caller must have appended via ingest for new data)
        alert_level, anomalies = self._evaluate(user_id, data, append=False)

        hr_baseline, _ = self._calculate_baseline(user_id, "heart_rate_resting")
        hrv_baseline, _ = self._calculate_baseline(user_id, "hrv_rmssd")
        hr_trend, hrv_vs_baseline, sleep_pattern = self._extract_features(user_id, data)

        fram = self._framingham_adapted(profile, data.heart_rate_resting)
        qrisk = self._qrisk3_adapted(
            profile,
            data.heart_rate_resting,
            data.hrv_rmssd,
            data.sleep_duration_hours or 0,
            data.step_count or 0,
        )
        ml_risk, ml_conf = self._custom_ml_risk(
            data.heart_rate_resting,
            data.hrv_rmssd,
            data.sleep_duration_hours or 0,
            getattr(data, "ecg_rhythm", "unknown") or "unknown",
            data.step_count or 0,
        )
        risk_scores = RiskScores(
            framingham_10y_pct=fram,
            qrisk3_10y_pct=qrisk,
            ml_cvd_risk_pct=ml_risk,
            ml_confidence=ml_conf,
        )
        fusion = self._fusion_trajectory(
            risk_scores, hr_trend, hrv_vs_baseline, getattr(data, "ecg_rhythm", "unknown") or "unknown"
        )

        clinical_flags = []
        if getattr(data, "ecg_rhythm", None) == "irregular":
            clinical_flags.append("Atrial fibrillation suspected")
        if hrv_vs_baseline == "below" and hrv_baseline:
            clinical_flags.append("HRV below threshold")
        if data.heart_rate_resting > (hr_baseline or 70) + 10:
            clinical_flags.append("Resting HR above personal baseline")

        recommendations = []
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
            hr_baseline=hr_baseline if hr_baseline else None,
            hrv_baseline=hrv_baseline if hrv_baseline else None,
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
