// Shared types and pure helpers for the doctor dashboard, split out of
// page.tsx so the page itself only holds state/effects/composition.

export function getUrgencyLevel(createdAt: string): { level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; color: string; hoursAgo: number; label: string } {
  const created = new Date(createdAt).getTime();
  const now = new Date().getTime();
  const hoursAgo = Math.floor((now - created) / (1000 * 60 * 60));

  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'LOW';
  let color = '#4caf50'; // green
  let label = 'ROUTINE';

  if (hoursAgo >= 24) {
    level = 'URGENT';
    color = '#d32f2f'; // red
    label = '[URGENT]';
  } else if (hoursAgo >= 6) {
    level = 'HIGH';
    color = '#ff6f00'; // orange
    label = '[HIGH]';
  } else if (hoursAgo >= 1) {
    level = 'MEDIUM';
    color = '#fbc02d'; // yellow
    label = '[MEDIUM]';
  } else {
    label = '[NEW]';
  }

  return { level, color, hoursAgo, label };
}

export function formatTimeAgo(hours: number): string {
  if (hours === 0) return 'just now';
  if (hours < 1) return '< 1 hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
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
