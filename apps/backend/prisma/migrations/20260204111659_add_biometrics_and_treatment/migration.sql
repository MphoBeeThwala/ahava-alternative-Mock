-- AlterTable
ALTER TABLE "public"."visits" ADD COLUMN     "biometrics" JSONB,
ADD COLUMN     "treatment" JSONB;
