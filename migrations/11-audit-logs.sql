-- Migration 11: Audit Logging for Compliance
-- Creates comprehensive audit trail for all PHI access and system actions

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT, -- JSON string with additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Sample audit actions:
-- - VIEW_REPORT: User viewed a diagnostic report
-- - CREATE_REPORT: User created a diagnostic report
-- - UPDATE_PROFILE: User updated their profile
-- - UPLOAD_IMAGE: User uploaded medical image
-- - VIEW_PATIENT_DATA: Healthcare worker accessed patient data
-- - APPROVE_DIAGNOSIS: Doctor approved AI diagnosis
-- - ESCALATE_CASE: System escalated case to doctor

