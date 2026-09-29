-- AlterTable: encrypted patient coordinates ({lat, lng} JSON, AES-256-GCM via
-- utils/encryption.ts) for re-offering unaccepted bookings to nurses
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "encryptedPatientLocation" TEXT;

-- CreateIndex: open-booking lookup (nurseId IS NULL, upcoming scheduledDate)
CREATE INDEX IF NOT EXISTS "bookings_nurseId_scheduledDate_idx" ON "bookings"("nurseId", "scheduledDate");
