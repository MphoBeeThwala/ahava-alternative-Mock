
-- Add image support and specialty routing to diagnostic reports
ALTER TABLE diagnostic_reports ADD COLUMN image_urls TEXT; -- JSON array of image URLs
ALTER TABLE diagnostic_reports ADD COLUMN image_analysis TEXT; -- AI analysis of uploaded images
ALTER TABLE diagnostic_reports ADD COLUMN assigned_specialty TEXT; -- DERMATOLOGY, DENTISTRY, GENERAL, NURSING, etc.
ALTER TABLE diagnostic_reports ADD COLUMN assigned_to TEXT; -- Healthcare worker user_id
ALTER TABLE diagnostic_reports ADD COLUMN priority TEXT CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')) DEFAULT 'MEDIUM';
ALTER TABLE diagnostic_reports ADD COLUMN estimated_cost REAL; -- Cost for current level of care
ALTER TABLE diagnostic_reports ADD COLUMN escalation_requested INTEGER DEFAULT 0; -- Patient requested escalation to specialist
ALTER TABLE diagnostic_reports ADD COLUMN escalation_approved INTEGER DEFAULT 0; -- First practitioner approved escalation
ALTER TABLE diagnostic_reports ADD COLUMN escalated_to TEXT; -- Specialist user_id if escalated
ALTER TABLE diagnostic_reports ADD COLUMN escalated_cost REAL; -- Cost after escalation

-- Add specialty to profiles
ALTER TABLE profiles ADD COLUMN specialty TEXT; -- DERMATOLOGY, DENTISTRY, GENERAL_PRACTICE, NURSING, CARDIOLOGY, etc.

-- Create indexes for efficient querying
CREATE INDEX idx_diagnostic_reports_assigned_specialty ON diagnostic_reports(assigned_specialty);
CREATE INDEX idx_diagnostic_reports_assigned_to ON diagnostic_reports(assigned_to);
CREATE INDEX idx_diagnostic_reports_priority ON diagnostic_reports(priority);
CREATE INDEX idx_profiles_specialty ON profiles(specialty);

