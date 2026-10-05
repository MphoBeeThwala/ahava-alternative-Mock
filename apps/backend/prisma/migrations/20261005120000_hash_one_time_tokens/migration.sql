-- Password-reset and email-verification tokens are now stored as SHA-256
-- hashes, and email verification links expire (24h, as the email always said).
ALTER TABLE "users" ADD COLUMN "emailVerificationExpiry" TIMESTAMP(3);

-- Any token already in the table was stored in clear and would never match a
-- hash, so it is dead either way. Clear them so no working plaintext link
-- remains at rest. Affected users request a new link ("Forgot password" /
-- "Resend verification").
UPDATE "users"
SET "passwordResetToken" = NULL,
    "passwordResetExpiry" = NULL,
    "emailVerificationToken" = NULL,
    "emailVerificationExpiry" = NULL
WHERE "passwordResetToken" IS NOT NULL OR "emailVerificationToken" IS NOT NULL;
