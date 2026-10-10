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

// ---- Arrival check ----------------------------------------------------------
// "Mark arrived" used to be an unchecked tap: a nurse could press it from
// anywhere. It is now checked against the booking's own location, softly: a
// nurse who is not there can still proceed, but must say why, and the distance
// and reason are written to the audit log. A hard block would strand a nurse on
// a bad GPS fix or a wrong pin, and the visit would then need an admin.

/** Within this distance of the booking location counts as arrived. */
export const ARRIVAL_RADIUS_M = 200;

export const ARRIVAL_OVERRIDE_REASONS = ['WRONG_PIN', 'GATE_OR_ACCESS', 'GPS_INACCURATE', 'OTHER'] as const;
export type ArrivalOverrideReason = (typeof ARRIVAL_OVERRIDE_REASONS)[number];

export interface LatLng { lat: number; lng: number }

const isLatLng = (v: unknown): v is LatLng => {
  const p = v as Partial<LatLng> | null | undefined;
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
};

/** Great-circle (straight-line) distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => d * (Math.PI / 180);
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ArrivalDecision =
  | { allowed: true; verified: boolean; distanceMeters: number | null; overrideReason?: ArrivalOverrideReason; note?: 'NO_BOOKING_LOCATION' }
  | { allowed: false; code: 'ARRIVAL_TOO_FAR' | 'ARRIVAL_POSITION_UNKNOWN'; distanceMeters: number | null; message: string };

/**
 * Decide whether a nurse may be marked arrived.
 *  - no booking location on file: allowed, unverified (there is nothing to check against)
 *  - within ARRIVAL_RADIUS_M: allowed, verified
 *  - further away, or no usable position from the nurse: allowed only with a valid reason
 */
export function evaluateArrival(input: { target: unknown; nurse: unknown; reason?: unknown; radiusM?: number }): ArrivalDecision {
  const radius = input.radiusM ?? ARRIVAL_RADIUS_M;
  if (!isLatLng(input.target)) return { allowed: true, verified: false, distanceMeters: null, note: 'NO_BOOKING_LOCATION' };

  const reason = (ARRIVAL_OVERRIDE_REASONS as readonly unknown[]).includes(input.reason)
    ? (input.reason as ArrivalOverrideReason)
    : undefined;

  if (!isLatLng(input.nurse)) {
    return reason
      ? { allowed: true, verified: false, distanceMeters: null, overrideReason: reason }
      : { allowed: false, code: 'ARRIVAL_POSITION_UNKNOWN', distanceMeters: null, message: 'Your location could not be read. Choose a reason to continue.' };
  }

  const d = Math.round(distanceMeters(input.nurse, input.target));
  if (d <= radius) return { allowed: true, verified: true, distanceMeters: d };
  return reason
    ? { allowed: true, verified: false, distanceMeters: d, overrideReason: reason }
    : { allowed: false, code: 'ARRIVAL_TOO_FAR', distanceMeters: d, message: `You are about ${d} m from the visit location. Choose a reason to continue.` };
}
