// Shared types and pure helpers for the doctor dashboard, split out of
// page.tsx so the page itself only holds state/effects/composition.
import type { AcuityLevel } from '../../../components/ui/AcuityRow';

/**
 * Maps the SATS 1-5 triage scale to the acuity display scale (Phase 4).
 * 1-2 (Resuscitation/Emergency) -> emergency, 3 (Urgent) -> urgent,
 * 4-5 (Less-Urgent/Non-Urgent) -> routine. The underlying aiTriageLevel/
 * finalTriageLevel values are unchanged — this is a display-only mapping.
 */
export function triageLevelToAcuity(level: number): AcuityLevel {
  if (level <= 2) return 'emergency';
  if (level === 3) return 'urgent';
  return 'routine';
}

/** Precise "Xh Ym" / "Xm" waiting-clock display, from a real createdAt. */
export function formatWaitingClock(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** Age in whole years from a real dateOfBirth — omit display entirely if absent, never guess. */
export function ageFromDateOfBirth(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth).getTime();
  if (Number.isNaN(dob)) return null;
  return Math.floor((Date.now() - dob) / (365.25 * 24 * 60 * 60 * 1000));
}

export type ReviewModalState = {
  caseId: string;
  aiTriageLevel: number;
  doctorNotes: string;
  doctorDiagnosis: string;
  doctorRecommendations: string;
  finalTriageLevel: number;
  overrideReason: string;
};

export type MedRow = { name: string; dosage: string; frequency: string; duration: string; instructions: string };

export const blankMed = (): MedRow => ({ name: '', dosage: '', frequency: '', duration: '', instructions: '' });

export type PrescriptionModalState = {
  caseId: string;
  diagnosis: string;
  medications: MedRow[];
  doctorNotes: string;
};

export type ReferralModalState = {
  caseId: string;
  referralType: string;
  provisionalDiagnosis: string;
  clinicalNotes: string;
  recommendedFacility: string;
};

export type FollowUpModalState = {
  caseId: string;
  requestType: 'MORE_INFO' | 'INVESTIGATION';
  message: string;
  questionsText: string;
  investigationsText: string;
};
