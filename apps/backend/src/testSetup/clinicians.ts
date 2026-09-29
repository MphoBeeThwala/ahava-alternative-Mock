/**
 * Integration-test helpers for the clinical access model
 * (services/careAccess.ts). Real registration never verifies a nurse's
 * SANC number or a doctor's HPCSA number on its own, so tests that act as
 * a working clinician mark them verified the same way an admin would, and
 * visits seeded directly in the database get the access grant that
 * accepting the visit over the WebSocket would have created.
 */
import prisma from "../lib/prisma";

export async function verifyClinician(userId: string, role: "NURSE" | "DOCTOR") {
  if (role === "NURSE") {
    await prisma.user.update({ where: { id: userId }, data: { sancId: `TEST-${userId.slice(-8)}`, sancVerificationStatus: "Active", isVerified: true } });
  } else {
    await prisma.user.update({ where: { id: userId }, data: { hcpsaNumber: `MP${userId.slice(-7)}`, hcpsaVerified: true, hcpsaVerifiedAt: new Date() } });
  }
}

export async function grantTestAccess(
  clinicianId: string,
  patientId: string,
  reason: "VISIT_ASSIGNMENT" | "TRIAGE_CASE" | "VISIT_REVIEW" | "MONITORING" = "VISIT_ASSIGNMENT",
  sourceId?: string,
  hours = 48,
) {
  return prisma.patientAccessGrant.create({
    data: { clinicianId, patientId, reason, sourceId: sourceId ?? null, expiresAt: new Date(Date.now() + hours * 3600_000) },
  });
}
