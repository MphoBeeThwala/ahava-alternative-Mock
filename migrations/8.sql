
CREATE TABLE panic_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nurse_id TEXT NOT NULL,
  appointment_id INTEGER,
  latitude REAL,
  longitude REAL,
  address TEXT,
  alert_status TEXT NOT NULL CHECK(alert_status IN ('ACTIVE', 'RESOLVED', 'FALSE_ALARM')) DEFAULT 'ACTIVE',
  resolved_at DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_panic_alerts_nurse_id ON panic_alerts(nurse_id);
CREATE INDEX idx_panic_alerts_status ON panic_alerts(alert_status);
