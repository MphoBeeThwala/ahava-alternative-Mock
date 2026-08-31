ALTER TYPE "TriageCaseStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PATIENT_RESPONSE';

ALTER TABLE "triage_cases"
ADD COLUMN "followUpRequestType" TEXT,
ADD COLUMN "followUpRequestMessage" TEXT,
ADD COLUMN "followUpQuestions" JSONB,
ADD COLUMN "requestedInvestigations" JSONB,
ADD COLUMN "followUpRequestedAt" TIMESTAMP(3),
ADD COLUMN "patientFollowUpResponse" TEXT,
ADD COLUMN "patientRespondedAt" TIMESTAMP(3);
