-- AlterTable: User - CVD risk context for early warning (POPIA minimal)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "riskProfile" JSONB;

-- AlterTable: BiometricReading - wearable extended metrics
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "sleepDurationHours" DOUBLE PRECISION;
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "ecgRhythm" TEXT;
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "temperatureTrend" TEXT;
