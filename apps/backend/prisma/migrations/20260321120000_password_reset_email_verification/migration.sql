-- AlterTable: add password reset and email verification fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetExpiry" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_passwordResetToken_key" ON "users"("passwordResetToken");
CREATE UNIQUE INDEX IF NOT EXISTS "users_emailVerificationToken_key" ON "users"("emailVerificationToken");
