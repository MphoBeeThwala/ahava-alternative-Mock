-- Pseudonymised, consent-gated research capture (docs/RESEARCH_DATA_PIPELINE.md).
-- No foreign key to users on purpose: rows are linked by an HMAC pseudonym and
-- are deleted explicitly when research consent is withdrawn.

-- CreateTable
CREATE TABLE "research_snapshots" (
    "id" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "observedDay" DATE NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "consentVersion" TEXT NOT NULL,
    "ageBand" TEXT NOT NULL,
    "sex" TEXT,
    "smoker" BOOLEAN,
    "diabetes" BOOLEAN,
    "hypertensionKnown" BOOLEAN,
    "hivPositive" BOOLEAN,
    "activeTb" BOOLEAN,
    "bpTreatment" BOOLEAN,
    "totalCholesterolMmol" DOUBLE PRECISION,
    "hdlMmol" DOUBLE PRECISION,
    "hrResting" DOUBLE PRECISION,
    "hrvRmssd" DOUBLE PRECISION,
    "spo2" DOUBLE PRECISION,
    "respRate" DOUBLE PRECISION,
    "skinTempOffset" DOUBLE PRECISION,
    "sbp" DOUBLE PRECISION,
    "dbp" DOUBLE PRECISION,
    "glucose" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "steps" INTEGER,
    "sleepHours" DOUBLE PRECISION,
    "ecgIrregular" BOOLEAN,
    "temperatureTrend" TEXT,
    "source" TEXT NOT NULL,
    "liveAlertLevel" TEXT,
    "liveCvdCategory" TEXT,
    "liveFraminghamPct" DOUBLE PRECISION,
    "liveBpPrompt" BOOLEAN,
    "liveEngineVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_predictions" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "contributions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_outcomes" (
    "id" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "outcomeType" TEXT NOT NULL,
    "outcomeDay" DATE NOT NULL,
    "icd10" TEXT,
    "details" JSONB,
    "source" TEXT NOT NULL,
    "recordedByRole" TEXT,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_cursors" (
    "name" TEXT NOT NULL,
    "value" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_cursors_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_snapshots_subjectKey_sourceRef_key" ON "research_snapshots"("subjectKey", "sourceRef");

-- CreateIndex
CREATE INDEX "research_snapshots_subjectKey_observedDay_idx" ON "research_snapshots"("subjectKey", "observedDay");

-- CreateIndex
CREATE INDEX "research_snapshots_observedDay_idx" ON "research_snapshots"("observedDay");

-- CreateIndex
CREATE UNIQUE INDEX "research_predictions_snapshotId_modelName_modelVersion_key" ON "research_predictions"("snapshotId", "modelName", "modelVersion");

-- CreateIndex
CREATE INDEX "research_predictions_modelName_modelVersion_idx" ON "research_predictions"("modelName", "modelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "research_outcomes_subjectKey_sourceRef_key" ON "research_outcomes"("subjectKey", "sourceRef");

-- CreateIndex
CREATE INDEX "research_outcomes_subjectKey_outcomeDay_idx" ON "research_outcomes"("subjectKey", "outcomeDay");

-- CreateIndex
CREATE INDEX "research_outcomes_outcomeType_outcomeDay_idx" ON "research_outcomes"("outcomeType", "outcomeDay");

-- AddForeignKey
ALTER TABLE "research_predictions" ADD CONSTRAINT "research_predictions_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "research_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
