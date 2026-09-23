-- AlterTable
ALTER TABLE "biometric_readings" ADD COLUMN IF NOT EXISTS "visitId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "biometric_readings_visitId_idx" ON "biometric_readings"("visitId");

-- AddForeignKey
ALTER TABLE "biometric_readings" ADD CONSTRAINT "biometric_readings_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
