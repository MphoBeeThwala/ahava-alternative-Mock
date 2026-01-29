
CREATE TABLE biometrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('HR', 'HRV', 'SPO2', 'RESPIRATORY_RATE', 'SKIN_TEMP', 'STEPS', 'BLOOD_PRESSURE')),
  value REAL NOT NULL,
  unit TEXT,
  recorded_at DATETIME NOT NULL,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_biometrics_user_id ON biometrics(user_id);
CREATE INDEX idx_biometrics_type ON biometrics(type);
CREATE INDEX idx_biometrics_recorded_at ON biometrics(recorded_at);
