-- AlterTable
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "bpPromptCheck" BOOLEAN;
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "bpContributingSignals" JSONB;
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "cvdRiskCategory" TEXT;
