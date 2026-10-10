-- The patient confirms a visit has ended (and may rate it), once the nurse has
-- finished it. Both nullable: existing visits have neither.
-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "patientConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "patientRating" INTEGER;

-- A rating, when given, is 1 to 5.
ALTER TABLE "visits" ADD CONSTRAINT "visits_patientRating_range" CHECK ("patientRating" IS NULL OR ("patientRating" BETWEEN 1 AND 5));
