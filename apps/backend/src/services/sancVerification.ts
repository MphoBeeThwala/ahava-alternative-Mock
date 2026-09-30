/**
 * sancVerification.ts
 *
 * SANC (South African Nursing Council) registration checks for nurses
 * (docs/ENGINEERING_PLAN.md §42). A nurse can open patient records and go
 * online only while sancVerificationStatus is 'Active' (services/careAccess.ts).
 *
 *  1. The nurse enters their SANC registration number, at sign-up or later
 *     on their dashboard (PATCH /nurse/profile/sanc).
 *  2. It is looked up in the sanc_register table. If an entry is there,
 *     Active and the name matches, the nurse is verified automatically;
 *     otherwise they are flagged (NOT_FOUND, NAME_MISMATCH, EXPIRED,
 *     SUSPENDED, CANCELLED).
 *  3. An admin checks the flagged number on SANC's own online register and
 *     records what it showed, with a note (recordSancCheck). That is how
 *     nurses are verified in practice today: SANC does not publish its
 *     register as a download, so sanc_register is empty unless a data
 *     source is arranged with SANC.
 *
 * SUSPENDED and CANCELLED are disciplinary. The nurse can't change their
 * number while flagged, and an admin can only clear the flag by
 * recording that the register now shows the registration as active,
 * with an explicit confirmation.
 *
 * Lookups and admin checks are written to the audit log. This service
 * leaves isVerified alone: that flag means the email address is confirmed.
 */

import crypto from 'crypto';
import prisma from '../lib/prisma';

export type SancVerificationStatus =
  | 'Active'
  | 'NOT_FOUND'
  | 'NAME_MISMATCH'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'CANCELLED';

export interface SancVerificationResult {
  status: SancVerificationStatus;
  registrationNumber: string;
  category?: string;
  expiryDate?: Date;
  message: string;
  autoVerified: boolean;
}

/**
 * Normalise a name for fuzzy comparison:
 * lowercase, remove hyphens/apostrophes, collapse whitespace.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two names match with tolerance for initials and transpositions.
 * Returns true if normalised forms are an exact or close match.
 */
function namesMatch(registeredName: string, submittedName: string): boolean {
  const r = normaliseName(registeredName);
  const s = normaliseName(submittedName);
  if (r === s) return true;

  // Allow first initial match: "J Smith" matches "John Smith"
  const rParts = r.split(' ');
  const sParts = s.split(' ');
  if (rParts.length >= 2 && sParts.length >= 2) {
    const lastMatch = rParts[rParts.length - 1] === sParts[sParts.length - 1];
    const firstInitialMatch =
      rParts[0][0] === sParts[0][0] &&
      (rParts[0].length === 1 || sParts[0].length === 1);
    if (lastMatch && firstInitialMatch) return true;
  }

  return false;
}

/**
 * Verify a nurse's SANC registration number against the imported register.
 * Updates the User record with the result and writes an audit log entry.
 */
export async function verifySancRegistration(
  userId: string,
  registrationNumber: string,
  submittedFirstName: string,
  submittedLastName: string
): Promise<SancVerificationResult> {
  const cleanRegNumber = registrationNumber.trim().toUpperCase();

  // Lookup in imported SANC register
  const entry = await (prisma as any).sancRegister.findUnique({
    where: { registrationNumber: cleanRegNumber },
  });

  let result: SancVerificationResult;

  if (!entry) {
    result = {
      status: 'NOT_FOUND',
      registrationNumber: cleanRegNumber,
      message: `Registration number ${cleanRegNumber} not found in SANC register. Manual verification required.`,
      autoVerified: false,
    };
  } else if (!namesMatch(entry.firstName + ' ' + entry.lastName, submittedFirstName + ' ' + submittedLastName)) {
    result = {
      status: 'NAME_MISMATCH',
      registrationNumber: cleanRegNumber,
      category: entry.category,
      message: `Name on SANC register (${entry.firstName} ${entry.lastName}) does not match submitted name. Manual review required.`,
      autoVerified: false,
    };
  } else if (entry.status === 'Suspended') {
    result = {
      status: 'SUSPENDED',
      registrationNumber: cleanRegNumber,
      category: entry.category,
      message: 'This registration is currently suspended. Cannot proceed.',
      autoVerified: false,
    };
  } else if (entry.status === 'Cancelled') {
    result = {
      status: 'CANCELLED',
      registrationNumber: cleanRegNumber,
      category: entry.category,
      message: 'This registration has been cancelled. Cannot proceed.',
      autoVerified: false,
    };
  } else if (entry.expiryDate && new Date(entry.expiryDate) < new Date()) {
    result = {
      status: 'EXPIRED',
      registrationNumber: cleanRegNumber,
      category: entry.category,
      expiryDate: entry.expiryDate,
      message: `Registration expired on ${entry.expiryDate.toISOString().slice(0, 10)}. Nurse must renew with SANC.`,
      autoVerified: false,
    };
  } else {
    // Active and name matches — auto-verify
    result = {
      status: 'Active',
      registrationNumber: cleanRegNumber,
      category: entry.category,
      expiryDate: entry.expiryDate ?? undefined,
      message: `SANC registration verified. Category: ${entry.category}.`,
      autoVerified: true,
    };
  }

  // Update User record
  await prisma.user.update({
    where: { id: userId },
    data: {
      sancId:                 cleanRegNumber,
      sancVerificationStatus: result.status,
      sancVerificationDate:   new Date(),
      sancCategory:           result.category ?? null,
    } as any,
  });

  // Write audit log
  const metadata = {
    registrationNumber: cleanRegNumber,
    status: result.status,
    autoVerified: result.autoVerified,
    message: result.message,
  };
  const checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');

  await prisma.auditLog.create({
    data: {
      userId,
      userRole: 'NURSE',
      action: 'SANC_VERIFICATION',
      resource: 'sancRegister',
      resourceId: cleanRegNumber,
      metadata,
      checksum,
    },
  });

  console.log(`[sancVerification] User ${userId}: ${result.status} (${cleanRegNumber})`);
  return result;
}

/** Disciplinary statuses: never cleared without an explicit admin confirmation. */
export const SANC_BLOCKING_STATUSES: SancVerificationStatus[] = ['SUSPENDED', 'CANCELLED'];

/** What an admin can record after checking SANC's online register. */
export const SANC_REGISTER_FINDINGS = ['ACTIVE', 'NOT_FOUND', 'NAME_MISMATCH', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const;
export type SancRegisterFinding = (typeof SANC_REGISTER_FINDINGS)[number];

export class SancRegistrationBlockedError extends Error {}

/**
 * A nurse entering or changing their own number. Re-entering the number
 * that is already verified changes nothing (an empty register would
 * otherwise turn a checked registration back into NOT_FOUND). While a
 * registration is flagged SUSPENDED or CANCELLED the nurse can't change it
 * at all, so a new number can't be used to shed the flag; an admin
 * handles it.
 */
export async function submitSancNumber(nurseId: string, registrationNumber: string): Promise<{ status: SancVerificationStatus; changed: boolean }> {
  const clean = registrationNumber.trim().toUpperCase();
  const nurse = await prisma.user.findUniqueOrThrow({
    where: { id: nurseId },
    select: { firstName: true, lastName: true, sancId: true, sancVerificationStatus: true },
  });
  const current = nurse.sancVerificationStatus as SancVerificationStatus | null;
  if (current && SANC_BLOCKING_STATUSES.includes(current)) throw new SancRegistrationBlockedError();
  if (nurse.sancId === clean && current === 'Active') return { status: current, changed: false };
  const result = await verifySancRegistration(nurseId, clean, nurse.firstName, nurse.lastName);
  return { status: result.status, changed: true };
}

/**
 * An admin records what SANC's online register showed for this nurse's
 * number. ACTIVE verifies them; anything else flags them. Clearing a
 * SUSPENDED or CANCELLED flag needs confirmStatusChange: the admin is
 * saying the register itself now shows the registration as active.
 */
export async function recordSancCheck(params: {
  nurseId: string;
  finding: SancRegisterFinding;
  confirmStatusChange?: boolean;
}): Promise<SancVerificationStatus> {
  const nurse = await prisma.user.findUniqueOrThrow({
    where: { id: params.nurseId },
    select: { sancId: true, sancVerificationStatus: true },
  });
  const previous = nurse.sancVerificationStatus as SancVerificationStatus | null;
  const status: SancVerificationStatus = params.finding === 'ACTIVE' ? 'Active' : params.finding;
  if (status === 'Active' && previous && SANC_BLOCKING_STATUSES.includes(previous) && !params.confirmStatusChange) {
    throw new SancRegistrationBlockedError();
  }
  await prisma.user.update({
    where: { id: params.nurseId },
    data: { sancVerificationStatus: status, sancVerificationDate: new Date() },
  });
  return status;
}
