import { TriageCaseStatus } from "@prisma/client";

/**
 * Statuses after which a case is finished: the doctor has released the result,
 * issued a prescription, referred, or escalated to emergency. Review, follow-up
 * requests and legacy PATCH review must not run on these, otherwise a doctor
 * could reopen a closed case, push their access to the patient's record out
 * again (extendSourceGrants), or silently rewrite the diagnosis behind an
 * already-issued prescription.
 */
export const CLOSED_TRIAGE_STATUSES: TriageCaseStatus[] = [
  TriageCaseStatus.RELEASED,
  TriageCaseStatus.EMERGENCY_REFERRAL,
  TriageCaseStatus.PRESCRIPTION_ISSUED,
  TriageCaseStatus.APPROVED,
  TriageCaseStatus.DOCTOR_OVERRIDE,
  TriageCaseStatus.REFERRED,
];

export const isClosedTriageStatus = (status: TriageCaseStatus): boolean =>
  CLOSED_TRIAGE_STATUSES.includes(status);

export const CASE_CLOSED_ERROR = {
  error: "This case is closed and can no longer be changed.",
  code: "TRIAGE_CASE_CLOSED",
} as const;
