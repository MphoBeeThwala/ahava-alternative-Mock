-- FIX 2.1: Add doctor review fields, AI audit fields, and new status values to triage_cases

-- Add new enum values (Postgres: use ALTER TYPE)
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'REVIEWED';
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'ESCALATED';

-- Doctor review fields
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "doctorDiagnosis"      TEXT;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "doctorRecommendations" TEXT;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "finalTriageLevel"      INTEGER;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "overrideReason"        TEXT;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "reviewedAt"            TIMESTAMP(3);
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "releasedAt"            TIMESTAMP(3);

-- AI audit fields
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "aiModel"          TEXT;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "aiContextUsed"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "statPearlsUsed"   BOOLEAN NOT NULL DEFAULT false;
