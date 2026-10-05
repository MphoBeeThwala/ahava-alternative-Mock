-- Last successful step-up (fresh 2FA code) for sensitive actions.
ALTER TABLE "users" ADD COLUMN "stepUpVerifiedAt" TIMESTAMP(3);
