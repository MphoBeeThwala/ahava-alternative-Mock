-- Add HPCSA fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hcpsaNumber" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hcpsaVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hcpsaVerifiedAt" TIMESTAMP(3);

-- Add new TriageCaseStatus enum values
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'EMERGENCY_REFERRAL';
ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'PRESCRIPTION_ISSUED';

-- Create prescriptions table
CREATE TABLE IF NOT EXISTS "prescriptions" (
    "id"                  TEXT NOT NULL,
    "triageCaseId"        TEXT NOT NULL,
    "patientId"           TEXT NOT NULL,
    "doctorId"            TEXT NOT NULL,
    "medications"         JSONB NOT NULL,
    "diagnosis"           TEXT NOT NULL,
    "doctorNotes"         TEXT,
    "hcpsaNumberSnapshot" TEXT,
    "doctorNameSnapshot"  TEXT NOT NULL,
    "issuedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prescriptions_triageCaseId_key" ON "prescriptions"("triageCaseId");
CREATE INDEX IF NOT EXISTS "prescriptions_patientId_idx" ON "prescriptions"("patientId");
CREATE INDEX IF NOT EXISTS "prescriptions_doctorId_idx"  ON "prescriptions"("doctorId");

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_triageCaseId_fkey"
    FOREIGN KEY ("triageCaseId") REFERENCES "triage_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create referrals table
CREATE TABLE IF NOT EXISTS "referrals" (
    "id"                     TEXT NOT NULL,
    "triageCaseId"           TEXT NOT NULL,
    "patientId"              TEXT NOT NULL,
    "doctorId"               TEXT NOT NULL,
    "referralType"           TEXT NOT NULL,
    "provisionalDiagnosis"   TEXT NOT NULL,
    "clinicalNotes"          TEXT NOT NULL,
    "recommendedFacility"    TEXT NOT NULL,
    "hcpsaNumberSnapshot"    TEXT,
    "doctorNameSnapshot"     TEXT NOT NULL,
    "issuedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "smsStatus"              TEXT NOT NULL DEFAULT 'NO_SMS_PROVIDER',
    "smsSentAt"              TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referrals_triageCaseId_key" ON "referrals"("triageCaseId");
CREATE INDEX IF NOT EXISTS "referrals_patientId_idx" ON "referrals"("patientId");
CREATE INDEX IF NOT EXISTS "referrals_doctorId_idx"  ON "referrals"("doctorId");

ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_triageCaseId_fkey"
    FOREIGN KEY ("triageCaseId") REFERENCES "triage_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
