/**
 * sancVerification.ts
 *
 * SANC (South African Nursing Council) registration verification service.
 *
 * Flow:
 *  1. Nurse submits their SANC registration number during sign-up
 *  2. We look it up in the SancRegister table (imported from SANC public dataset)
 *  3. If found & Active: auto-verify and mark isVerified = true
 *  4. If name mismatch / expired / suspended: flag for manual admin review
 *  5. All lookups are written to AuditLog for HPCSA compliance
 *
 * SANC register import:
 *  Download the register CSV from https://www.sanc.co.za/registers/
 *  Then run: ts-node scripts/importSancRegister.ts --file sanc_register.csv
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

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
      isVerified:             result.autoVerified,
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

/**
 * Admin override: manually verify a nurse after out-of-band check.
 * Records who approved and why.
 */
export async function adminOverrideVerification(
  nurseUserId: string,
  adminUserId: string,
  reason: string
): Promise<void> {
  await prisma.user.update({
    where: { id: nurseUserId },
    data: {
      isVerified: true,
      sancVerificationStatus: 'Active',
      sancVerificationDate: new Date(),
    } as any,
  });

  const metadata = { adminUserId, reason, nurseUserId };
  const checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');

  await prisma.auditLog.create({
    data: {
      userId: adminUserId,
      userRole: 'ADMIN',
      action: 'SANC_MANUAL_OVERRIDE',
      resource: 'users',
      resourceId: nurseUserId,
      metadata,
      checksum,
    },
  });

  console.log(`[sancVerification] Admin ${adminUserId} manually verified nurse ${nurseUserId}`);
}
