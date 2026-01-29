
CREATE TABLE health_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('BASELINE_DEVIATION', 'CRITICAL_VALUE', 'TREND_WARNING', 'AI_FLAG')),
  severity TEXT NOT NULL CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message TEXT NOT NULL,
  biometric_data TEXT,
  is_acknowledged INTEGER DEFAULT 0,
  acknowledged_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_alerts_user_id ON health_alerts(user_id);
CREATE INDEX idx_health_alerts_severity ON health_alerts(severity);
CREATE INDEX idx_health_alerts_is_acknowledged ON health_alerts(is_acknowledged);
