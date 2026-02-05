
CREATE TABLE patient_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  hr_baseline_mean REAL,
  hr_baseline_stddev REAL,
  hrv_baseline_mean REAL,
  hrv_baseline_stddev REAL,
  spo2_baseline_mean REAL,
  spo2_baseline_stddev REAL,
  respiratory_rate_baseline_mean REAL,
  respiratory_rate_baseline_stddev REAL,
  skin_temp_baseline_mean REAL,
  skin_temp_baseline_stddev REAL,
  baseline_period_start DATETIME,
  baseline_period_end DATETIME,
  is_complete INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_patient_baselines_user_id ON patient_baselines(user_id);
