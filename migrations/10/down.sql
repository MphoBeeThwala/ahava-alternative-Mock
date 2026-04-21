
-- Rollback Better Auth tables

DROP INDEX IF EXISTS idx_verification_identifier;
DROP INDEX IF EXISTS idx_account_userId;
DROP INDEX IF EXISTS idx_session_userId;
DROP INDEX IF EXISTS idx_session_token;
DROP INDEX IF EXISTS idx_user_email;

DROP TABLE IF EXISTS verification;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS user;

