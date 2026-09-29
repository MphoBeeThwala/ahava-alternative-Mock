-- Per-patient, time-bound clinician access (services/careAccess.ts)
-- CreateEnum
CREATE TYPE "AccessGrantReason" AS ENUM ('VISIT_ASSIGNMENT', 'TRIAGE_CASE', 'VISIT_REVIEW', 'MONITORING', 'ADMIN_GRANT', 'BREAK_GLASS');

-- CreateTable
CREATE TABLE "patient_access_grants" (
    "id" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "reason" "AccessGrantReason" NOT NULL,
    "sourceId" TEXT,
    "justification" TEXT,
    "grantedById" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_access_grants_clinicianId_patientId_expiresAt_idx" ON "patient_access_grants"("clinicianId", "patientId", "expiresAt");

-- CreateIndex
CREATE INDEX "patient_access_grants_patientId_createdAt_idx" ON "patient_access_grants"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "patient_access_grants_sourceId_idx" ON "patient_access_grants"("sourceId");

-- CreateIndex
CREATE INDEX "patient_access_grants_reason_reviewedAt_idx" ON "patient_access_grants"("reason", "reviewedAt");

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

