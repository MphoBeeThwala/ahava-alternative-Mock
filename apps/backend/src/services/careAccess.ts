/**
 * Clinical access control: who may see which patient's record, and when.
 *
 * Model (docs/ENGINEERING_PLAN.md §38):
 *  1. Only *verified* clinicians touch patient records: a nurse whose SANC
 *     registration is Active, or a doctor with an admin-verified HPCSA
 *     number. Unverified staff accounts get nothing clinical.
 *  2. A verified clinician sees a patient's record only while they hold an
 *     unexpired, unrevoked PatientAccessGrant for that patient. Grants are
 *     created by the act of taking on the patient (accepting a visit,
 *     claiming a triage case / visit review / monitoring alert), by an
 *     admin with a recorded reason, or by audited break-glass. They expire
 *     after the episode plus a short documentation window.
 *  3. Admins administer (verify credentials, grant/revoke, review
 *     break-glass, read the audit trail) but do not read clinical content
 *     themselves — separation of duties.
 *  4. Work queues show only what's needed to pick up work (acuity, age,
 *     sex, wait time) until the clinician claims it.
 */
import { AccessGrantReason, PatientAccessGrant, UserRole, VisitStatus } from '@prisma/client';
import { NextFunction, Response } from 'express';
import prisma from '../lib/prisma';
import type { AuthenticatedRequest } from '../middleware/auth';
import { writeRequestAudit } from './clinicalAudit';

const HOUR = 3600_000;

/** Access windows. Kept together so they're easy to review and change. */
export const ACCESS_WINDOWS = {
  /** Nurse: from accepting until at least this long after the scheduled start. */
  visitFromScheduledStartHours: 48,
  /** After a visit / review ends: time to finish notes and documentation. */
  documentationHours: 24,
  /** Doctor on an open triage case (may wait days on a patient's reply). */
  triageOpenDays: 7,
  /** After a triage case is released / prescribed / referred. */
  triageAfterCloseHours: 72,
  /** Doctor reviewing a completed nurse visit. */
  visitReviewHours: 72,
  /** Doctor who took on a remote-monitoring alert. */
  monitoringDays: 30,
  /** Break-glass emergency access. */
  breakGlassHours: 4,
  /** Upper bound an admin may grant in one go. */
  adminGrantMaxHours: 30 * 24,
} as const;

export const hoursFromNow = (hours: number, now = new Date()) => new Date(now.getTime() + hours * HOUR);

// ===== 1. Verified credentials =====

export type ClinicianCheck =
  | { ok: true; role: 'NURSE' | 'DOCTOR' }
  | { ok: false; status: 403; code: 'CLINICAL_ROLE_REQUIRED' | 'CREDENTIAL_UNVERIFIED'; error: string };

export async function checkVerifiedClinician(userId: string): Promise<ClinicianCheck> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, sancVerificationStatus: true, hcpsaVerified: true, hcpsaNumber: true },
  });
  if (!user || !user.isActive || (user.role !== UserRole.NURSE && user.role !== UserRole.DOCTOR)) {
    return {
      ok: false, status: 403, code: 'CLINICAL_ROLE_REQUIRED',
      error: 'Only registered nurses and doctors can access patient records.',
    };
  }
  if (user.role === UserRole.NURSE && user.sancVerificationStatus !== 'Active') {
    return {
      ok: false, status: 403, code: 'CREDENTIAL_UNVERIFIED',
      error: 'Your SANC registration must be verified before you can access patient records.',
    };
  }
  if (user.role === UserRole.DOCTOR && !(user.hcpsaVerified && user.hcpsaNumber)) {
    return {
      ok: false, status: 403, code: 'CREDENTIAL_UNVERIFIED',
      error: 'Your HPCSA practice number must be verified before you can access patient records.',
    };
  }
  return { ok: true, role: user.role };
}

/**
 * Route guard: a verified nurse and/or doctor. Admins are deliberately not
 * let through — they administer access, they don't use it.
 */
export const requireVerifiedClinician = (roles: Array<'NURSE' | 'DOCTOR'> = ['NURSE', 'DOCTOR']) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!roles.includes(req.user.role as 'NURSE' | 'DOCTOR')) {
        return res.status(403).json({ error: 'Insufficient permissions', code: 'CLINICAL_ROLE_REQUIRED' });
      }
      const check = await checkVerifiedClinician(req.user.id);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      return next();
    } catch (error) { return next(error); }
  };

export const isClinicianRole = (role: string | undefined) => role === UserRole.NURSE || role === UserRole.DOCTOR;

// ===== 2. Grants =====

const activeWhere = (now = new Date()) => ({ revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } });

export async function hasActiveAccess(clinicianId: string, patientId: string): Promise<boolean> {
  const count = await prisma.patientAccessGrant.count({ where: { clinicianId, patientId, ...activeWhere() } });
  return count > 0;
}

/** Of `patientIds`, the ones this clinician can currently see. One query. */
export async function patientsWithActiveAccess(clinicianId: string, patientIds: string[]): Promise<Set<string>> {
  if (patientIds.length === 0) return new Set();
  const rows = await prisma.patientAccessGrant.findMany({
    where: { clinicianId, patientId: { in: Array.from(new Set(patientIds)) }, ...activeWhere() },
    select: { patientId: true },
  });
  return new Set(rows.map((r) => r.patientId));
}

export interface GrantInput {
  clinicianId: string;
  patientId: string;
  reason: AccessGrantReason;
  expiresAt: Date;
  sourceId?: string | null;
  grantedById?: string | null;
  justification?: string | null;
}

/**
 * Create a grant, or extend the matching active one (same clinician,
 * patient, reason and source) rather than piling up duplicates.
 */
export async function grantAccess(input: GrantInput): Promise<PatientAccessGrant> {
  const existing = await prisma.patientAccessGrant.findFirst({
    where: {
      clinicianId: input.clinicianId,
      patientId: input.patientId,
      reason: input.reason,
      sourceId: input.sourceId ?? null,
      ...activeWhere(),
    },
    orderBy: { expiresAt: 'desc' },
  });
  if (existing && input.reason !== AccessGrantReason.BREAK_GLASS && input.reason !== AccessGrantReason.ADMIN_GRANT) {
    if (existing.expiresAt >= input.expiresAt) return existing;
    return prisma.patientAccessGrant.update({ where: { id: existing.id }, data: { expiresAt: input.expiresAt } });
  }
  return prisma.patientAccessGrant.create({
    data: {
      clinicianId: input.clinicianId,
      patientId: input.patientId,
      reason: input.reason,
      expiresAt: input.expiresAt,
      sourceId: input.sourceId ?? null,
      grantedById: input.grantedById ?? null,
      justification: input.justification ?? null,
    },
  });
}

/** Push a clinician's active grants for this source out to at least `until`. */
export async function extendSourceGrants(sourceId: string, clinicianId: string, until: Date) {
  await prisma.patientAccessGrant.updateMany({
    where: { sourceId, clinicianId, revokedAt: null, expiresAt: { gt: new Date(), lt: until } },
    data: { expiresAt: until },
  });
}

/** Bring a clinician's grants for this source in to at most `until` (episode ended). */
export async function closeSourceGrants(sourceId: string, clinicianId: string, until: Date) {
  await prisma.patientAccessGrant.updateMany({
    where: { sourceId, clinicianId, revokedAt: null, expiresAt: { gt: until } },
    data: { expiresAt: until },
  });
}

/** Keep the assigned nurse's access in step with the visit's status. */
export async function syncVisitGrant(visit: { id: string; nurseId: string }, status: VisitStatus) {
  const terminal = status === VisitStatus.COMPLETED || status === VisitStatus.CANCELLED;
  const until = hoursFromNow(ACCESS_WINDOWS.documentationHours);
  if (terminal) await closeSourceGrants(visit.id, visit.nurseId, until);
  else await extendSourceGrants(visit.id, visit.nurseId, until);
}

/**
 * Record a refused clinical access attempt. Denials are as important to
 * the audit trail as successful reads (they're how probing shows up).
 */
export async function auditAccessDenied(req: AuthenticatedRequest, resource: string, resourceId: string, patientId?: string) {
  await writeRequestAudit({
    userId: req.user!.id,
    userRole: req.user!.role,
    action: 'ACCESS_DENIED',
    resource,
    resourceId,
    metadata: { patientId, reason: 'no active care access' },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });
}

export const NO_ACCESS_ERROR = {
  error: 'You do not currently have access to this patient’s record.',
  code: 'NO_CARE_ACCESS',
} as const;

// ===== 3. Minimum-necessary projections =====

export function ageFrom(dateOfBirth: Date | string | null | undefined, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** "Thandi M." — enough to address someone, not enough to identify them at scale. */
export function displayName(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim();
  const initial = (lastName ?? '').trim().charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
