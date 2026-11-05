-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpLastUsedStep" INTEGER;
