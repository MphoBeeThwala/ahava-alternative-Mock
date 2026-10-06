-- Optional coded diagnosis on prescriptions and referrals (format-checked ICD-10).
-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "icd10" TEXT;

-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "icd10" TEXT;
