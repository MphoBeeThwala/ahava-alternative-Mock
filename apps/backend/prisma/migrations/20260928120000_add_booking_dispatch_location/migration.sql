-- AlterTable: patient coordinates for re-offering unaccepted bookings to nurses
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "patientLat" DOUBLE PRECISION;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "patientLng" DOUBLE PRECISION;

-- CreateIndex: open-booking lookup (nurseId IS NULL, upcoming scheduledDate)
CREATE INDEX IF NOT EXISTS "bookings_nurseId_scheduledDate_idx" ON "bookings"("nurseId", "scheduledDate");
