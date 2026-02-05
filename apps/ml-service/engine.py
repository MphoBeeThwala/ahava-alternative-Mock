import numpy as np
import pandas as pd
from typing import List, Dict, Tuple
from datetime import datetime, timedelta
from models import BiometricData, AlertLevel

# Mock database (In-memory for MVP, replace with InfluxDB/TimescaleDB)
# Structure: { user_id: [BiometricData] }
DATA_STORE: Dict[str, List[BiometricData]] = {}

class EarlyWarningEngine:
    def __init__(self):
        self.MIN_BASELINE_DAYS = 14
        self.ROLLING_WINDOW_DAYS = 7
        
        # Thresholds
        self.SIGMA_YELLOW = 1.5
        self.SIGMA_RED = 2.5
        
        # False Positive Thresholds (Context)
        self.HIGH_ACTIVITY_STEPS_PERCENTILE = 90

    def ingest(self, user_id: str, data: BiometricData) -> Tuple[AlertLevel, List[str]]:
        """
        Process new data point.
        Returns (AlertLevel, List of detected anomalies)
        """
        # Store data
        if user_id not in DATA_STORE:
            DATA_STORE[user_id] = []
        DATA_STORE[user_id].append(data)
        
        # 1. Check Baseline Sufficiency
        history = DATA_STORE[user_id]
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
        df = pd.DataFrame([h.dict() for h in history])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.set_index('timestamp').sort_index()
        
        # Logic: "Ignore first 14 days of data"
        # We need to find the start date of the user's data
        start_date = df.index.min()
        valid_start_date = start_date + timedelta(days=14)
        
        # Filter for data AFTER the 14-day calibration period
        valid_data = df[df.index >= valid_start_date]
        
        if valid_data.empty:
            # Fallback if in calibration (should be caught by _has_sufficient_history, but just in case)
            # Use all data if we don't have enough post-calibration
            valid_data = df 
            
        # Use last 7 days of VALID data for the rolling window
        last_date = df.index.max()
        window_start = last_date - timedelta(days=self.ROLLING_WINDOW_DAYS)
        recent_data = valid_data[valid_data.index >= window_start]
        
        if recent_data.empty:
            return 0.0, 1.0 # Default
            
        return recent_data[metric].mean(), recent_data[metric].std()

    def _is_exercise_context(self, user_id: str, current_data: BiometricData) -> bool:
        """
        Check if steps are > 90th percentile of user's history
        """
        history = DATA_STORE[user_id]
        if len(history) < 10: return False
        
        steps = [h.step_count for h in history]
        threshold = np.percentile(steps, self.HIGH_ACTIVITY_STEPS_PERCENTILE)
        
        return current_data.step_count > threshold
