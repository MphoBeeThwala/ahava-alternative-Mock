-- Clinician-only structured clinical plan produced by the AI triage pipeline
-- (tiered investigations/management, decisions on existing treatment, the
-- deterministic checks, completeness-lint results and reviewer flags).
-- Nullable: existing cases have none. Encrypted at the application layer.
-- AlterTable
ALTER TABLE "triage_cases" ADD COLUMN     "aiStructuredPlan" JSONB;
