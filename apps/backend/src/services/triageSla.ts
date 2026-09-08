/**
 * Pure SLA/fee calculation, shared by jobs/triageEscalation.ts,
 * jobs/aiTriageJob.ts and routes/triage.ts. Kept dependency-free (no
 * prisma, no queue) deliberately: jobs/triageEscalation.ts imports
 * services/queue.ts (for addEmailJob) and services/queue.ts imports
 * jobs/aiTriageJob.ts (to run the AI triage worker) — putting these
 * functions in either of those files would create a cycle between them.
 */

// SLA thresholds in minutes per triage level
const SLA_MINUTES: Record<number, number> = {
  1: 5,
  2: 15,
  3: 60,
  4: 240,
  5: 480,
};

// Doctor compensation in ZAR cents per level
const DOCTOR_FEE_CENTS: Record<number, number> = {
  1: 15000, // R150
  2: 10000, // R100
  3: 7500,  // R75
  4: 5000,  // R50
  5: 3000,  // R30
};

/**
 * Calculate the SLA deadline for a triage case at creation time.
 */
export function calculateSlaDeadline(triageLevel: number, createdAt: Date): Date {
  const minutes = SLA_MINUTES[triageLevel] ?? 60;
  return new Date(createdAt.getTime() + minutes * 60 * 1000);
}

/**
 * Calculate doctor compensation for reviewing a case.
 */
export function getDoctorFee(triageLevel: number): number {
  return DOCTOR_FEE_CENTS[triageLevel] ?? 5000;
}
