-- AlterTable
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "framinghamRiskPct" DOUBLE PRECISION;
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "framinghamRiskBound" TEXT;
