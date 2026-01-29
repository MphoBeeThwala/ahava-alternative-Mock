
-- Rollback migration 9
DROP INDEX IF EXISTS idx_profiles_specialty;
DROP INDEX IF EXISTS idx_diagnostic_reports_priority;
DROP INDEX IF EXISTS idx_diagnostic_reports_assigned_to;
DROP INDEX IF EXISTS idx_diagnostic_reports_assigned_specialty;

ALTER TABLE profiles DROP COLUMN specialty;

ALTER TABLE diagnostic_reports DROP COLUMN escalated_cost;
ALTER TABLE diagnostic_reports DROP COLUMN escalated_to;
ALTER TABLE diagnostic_reports DROP COLUMN escalation_approved;
ALTER TABLE diagnostic_reports DROP COLUMN escalation_requested;
ALTER TABLE diagnostic_reports DROP COLUMN estimated_cost;
ALTER TABLE diagnostic_reports DROP COLUMN priority;
ALTER TABLE diagnostic_reports DROP COLUMN assigned_to;
ALTER TABLE diagnostic_reports DROP COLUMN assigned_specialty;
ALTER TABLE diagnostic_reports DROP COLUMN image_analysis;
ALTER TABLE diagnostic_reports DROP COLUMN image_urls;

