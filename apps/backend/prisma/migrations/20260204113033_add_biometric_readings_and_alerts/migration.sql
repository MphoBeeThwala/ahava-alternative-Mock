-- CreateTable
CREATE TABLE "public"."biometric_readings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "heartRate" DOUBLE PRECISION,
    "heartRateResting" DOUBLE PRECISION,
    "hrvRmssd" DOUBLE PRECISION,
    "bloodPressureSystolic" DOUBLE PRECISION,
    "bloodPressureDiastolic" DOUBLE PRECISION,
    "oxygenSaturation" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "respiratoryRate" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "glucose" DOUBLE PRECISION,
    "stepCount" INTEGER,
    "activeCalories" DOUBLE PRECISION,
    "skinTempOffset" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "deviceType" TEXT,
    "alertLevel" TEXT,
    "anomalies" JSONB,
    "readinessScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."health_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertLevel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detectedAnomalies" JSONB,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "biometricReadingId" TEXT,
    "visitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "biometric_readings_userId_createdAt_idx" ON "public"."biometric_readings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "health_alerts_userId_createdAt_idx" ON "public"."health_alerts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "health_alerts_userId_acknowledged_resolved_idx" ON "public"."health_alerts"("userId", "acknowledged", "resolved");

-- AddForeignKey
ALTER TABLE "public"."biometric_readings" ADD CONSTRAINT "biometric_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."health_alerts" ADD CONSTRAINT "health_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
