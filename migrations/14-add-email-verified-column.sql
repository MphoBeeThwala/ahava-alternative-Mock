-- Add email_verified column to user table
ALTER TABLE user ADD COLUMN email_verified INTEGER DEFAULT 0;
