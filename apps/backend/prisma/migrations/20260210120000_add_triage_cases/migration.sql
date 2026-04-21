-- CreateEnum
CREATE TYPE "TriageCaseStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DOCTOR_OVERRIDE', 'REFERRED');

-- CreateTable
CREATE TABLE "public"."triage_cases" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "symptoms" TEXT NOT NULL,
    "imageStorageRef" TEXT,
    "aiTriageLevel" INTEGER NOT NULL,
    "aiRecommendedAction" TEXT NOT NULL,
    "aiPossibleConditions" JSONB NOT NULL,
    "aiReasoning" TEXT NOT NULL,
    "status" "TriageCaseStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "doctorNotes" TEXT,
    "finalDiagnosis" TEXT,
    "referredTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triage_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triage_cases_status_idx" ON "public"."triage_cases"("status");

-- CreateIndex
CREATE INDEX "triage_cases_patientId_idx" ON "public"."triage_cases"("patientId");

-- CreateIndex
CREATE INDEX "triage_cases_doctorId_idx" ON "public"."triage_cases"("doctorId");

-- AddForeignKey
ALTER TABLE "public"."triage_cases" ADD CONSTRAINT "triage_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."triage_cases" ADD CONSTRAINT "triage_cases_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
