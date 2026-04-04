-- Migration: add Terra API, SANC, user_baselines, patient_consents, doctor_sessions, triage SLA
-- These were added to schema.prisma but never had a corresponding migration file.
-- Uses IF NOT EXISTS throughout so it is safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER users — Terra API + SANC verification columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terraUserId"            TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "connectedDevices"       TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sancId"                 TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sancVerificationStatus" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sancVerificationDate"   TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sancCategory"           TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_terraUserId_key" ON "users"("terraUserId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALTER triage_cases — SLA tracking + doctor compensation columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "slaDeadline"       TIMESTAMP(3);
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "escalatedAt"       TIMESTAMP(3);
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "escalationLevel"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "reviewedWithinSla" BOOLEAN;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "doctorFeeCents"    INTEGER;
ALTER TABLE "triage_cases" ADD COLUMN IF NOT EXISTS "feePaid"           BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "triage_cases_slaDeadline_idx" ON "triage_cases"("slaDeadline");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CREATE TABLE user_baselines
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_baselines" (
    "id"              TEXT             NOT NULL,
    "userId"          TEXT             NOT NULL,
    "hrMean"          DOUBLE PRECISION,
    "hrStd"           DOUBLE PRECISION,
    "hrvMean"         DOUBLE PRECISION,
    "hrvStd"          DOUBLE PRECISION,
    "spo2Mean"        DOUBLE PRECISION,
    "spo2Std"         DOUBLE PRECISION,
    "rrMean"          DOUBLE PRECISION,
    "rrStd"           DOUBLE PRECISION,
    "demographicSeed" JSONB,
    "dataPointCount"  INTEGER          NOT NULL DEFAULT 0,
    "confidencePct"   INTEGER          NOT NULL DEFAULT 0,
    "stage"           TEXT             NOT NULL DEFAULT 'PROVISIONAL',
    "lastCalculated"  TIMESTAMP(3),
    CONSTRAINT "user_baselines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_baselines_userId_key" ON "user_baselines"("userId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_baselines_userId_fkey'
  ) THEN
    ALTER TABLE "user_baselines"
      ADD CONSTRAINT "user_baselines_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CREATE TABLE sanc_register
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sanc_register" (
    "id"                 TEXT         NOT NULL,
    "registrationNumber" TEXT         NOT NULL,
    "firstName"          TEXT         NOT NULL,
    "lastName"           TEXT         NOT NULL,
    "category"           TEXT         NOT NULL,
    "status"             TEXT         NOT NULL,
    "expiryDate"         TIMESTAMP(3),
    "importedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sanc_register_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sanc_register_registrationNumber_key" ON "sanc_register"("registrationNumber");
CREATE INDEX        IF NOT EXISTS "sanc_register_registrationNumber_idx"  ON "sanc_register"("registrationNumber");
CREATE INDEX        IF NOT EXISTS "sanc_register_status_idx"              ON "sanc_register"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CREATE TABLE patient_consents
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "patient_consents" (
    "id"          TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "consentType" TEXT         NOT NULL,
    "version"     TEXT         NOT NULL DEFAULT '1.0',
    "givenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"   TEXT,
    "userAgent"   TEXT,
    "withdrawn"   BOOLEAN      NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "patient_consents_userId_consentType_version_key"
  ON "patient_consents"("userId", "consentType", "version");
CREATE INDEX IF NOT EXISTS "patient_consents_userId_consentType_idx"
  ON "patient_consents"("userId", "consentType");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_consents_userId_fkey'
  ) THEN
    ALTER TABLE "patient_consents"
      ADD CONSTRAINT "patient_consents_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CREATE TABLE doctor_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "doctor_sessions" (
    "id"            TEXT         NOT NULL,
    "doctorId"      TEXT         NOT NULL,
    "startsAt"      TIMESTAMP(3) NOT NULL,
    "endsAt"        TIMESTAMP(3) NOT NULL,
    "maxCases"      INTEGER      NOT NULL DEFAULT 20,
    "isActive"      BOOLEAN      NOT NULL DEFAULT true,
    "casesReviewed" INTEGER      NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "doctor_sessions_doctorId_isActive_idx" ON "doctor_sessions"("doctorId", "isActive");
CREATE INDEX IF NOT EXISTS "doctor_sessions_startsAt_endsAt_idx"   ON "doctor_sessions"("startsAt",  "endsAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_sessions_doctorId_fkey'
  ) THEN
    ALTER TABLE "doctor_sessions"
      ADD CONSTRAINT "doctor_sessions_doctorId_fkey"
      FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
