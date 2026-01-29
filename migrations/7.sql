
ALTER TABLE profiles ADD COLUMN has_accepted_terms INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN terms_accepted_at DATETIME;
