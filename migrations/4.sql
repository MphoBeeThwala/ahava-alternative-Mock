
CREATE TABLE diagnostic_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  doctor_id TEXT,
  report_type TEXT NOT NULL,
  ai_analysis TEXT,
  ai_confidence REAL,
  symptoms TEXT,
  doctor_notes TEXT,
  diagnosis TEXT,
  recommendations TEXT,
  is_released INTEGER DEFAULT 0,
  released_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_diagnostic_reports_patient_id ON diagnostic_reports(patient_id);
CREATE INDEX idx_diagnostic_reports_doctor_id ON diagnostic_reports(doctor_id);
CREATE INDEX idx_diagnostic_reports_is_released ON diagnostic_reports(is_released);
