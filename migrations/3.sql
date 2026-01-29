
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  nurse_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) DEFAULT 'REQUESTED',
  service_type TEXT NOT NULL,
  patient_latitude REAL,
  patient_longitude REAL,
  patient_address TEXT,
  scheduled_at DATETIME,
  completed_at DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_nurse_id ON appointments(nurse_id);
CREATE INDEX idx_appointments_status ON appointments(status);
