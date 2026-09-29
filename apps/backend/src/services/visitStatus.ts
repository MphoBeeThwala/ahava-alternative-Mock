import { VisitStatus } from '@prisma/client';

/**
 * The one legal forward step from each visit status, mirroring the nurse
 * dashboard's own VISIT_STATUS_FLOW. Previously both PATCH /visits/:id/status
 * and the WebSocket VISIT_STATUS_UPDATE handler wrote whatever string the
 * client sent — an unknown value surfaced as a Prisma 500, and a nurse could
 * jump a SCHEDULED visit straight to COMPLETED (or reopen a COMPLETED one).
 */
const NEXT_STATUS: Partial<Record<VisitStatus, VisitStatus>> = {
  SCHEDULED: VisitStatus.EN_ROUTE,
  EN_ROUTE: VisitStatus.ARRIVED,
  ARRIVED: VisitStatus.IN_PROGRESS,
  IN_PROGRESS: VisitStatus.COMPLETED,
};

const TERMINAL: VisitStatus[] = [VisitStatus.COMPLETED, VisitStatus.CANCELLED];

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === 'string' && (Object.values(VisitStatus) as string[]).includes(value);
}

/**
 * Returns null when `from -> to` is allowed, otherwise the reason it isn't.
 * Admins may set any valid status on a non-terminal visit (manual correction);
 * everyone else may only advance one step or cancel a visit that hasn't ended.
 */
export function visitTransitionError(from: VisitStatus, to: VisitStatus, isAdmin: boolean): string | null {
  if (TERMINAL.includes(from)) return `Visit is already ${from}`;
  if (from === to) return `Visit is already ${from}`;
  if (isAdmin || to === VisitStatus.CANCELLED) return null;
  if (NEXT_STATUS[from] !== to) {
    return `Cannot move a visit from ${from} to ${to}; next step is ${NEXT_STATUS[from]}`;
  }
  return null;
}

/** Timestamps that go with a status change, so actualStart/actualEnd are actually recorded. */
export function visitTimingFor(to: VisitStatus, now = new Date()): { actualStart?: Date; actualEnd?: Date } {
  if (to === VisitStatus.IN_PROGRESS) return { actualStart: now };
  if (to === VisitStatus.COMPLETED) return { actualEnd: now };
  return {};
}
