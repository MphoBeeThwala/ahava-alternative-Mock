/**
 * SANC (South African Nursing Council) registration verification —
 * verifySancRegistration is the gate that decides whether a nurse can go
 * live unverified (auto-verified against the imported register) or must be
 * flagged for manual admin review before ever being assigned a visit.
 * Exercised directly against a real database (seeding SancRegister rows)
 * rather than through the register endpoint, since the endpoint only fires
 * this asynchronously via setImmediate — see auth.ts's post-registration
 * hook comment.
 */
import prisma from "../lib/prisma";
import { verifySancRegistration, submitSancNumber, recordSancCheck, SancRegistrationBlockedError } from "./sancVerification";
import { UserRole } from "@prisma/client";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function createNurseUser(label: string) {
  return prisma.user.create({
    data: {
      email: uniqueEmail(label),
      passwordHash: "not-a-real-hash",
      firstName: "Test",
      lastName: "Nurse",
      role: UserRole.NURSE,
    },
  });
}

async function seedRegisterEntry(overrides: Partial<{
  registrationNumber: string;
  firstName: string;
  lastName: string;
  category: string;
  status: string;
  expiryDate: Date | null;
}> = {}) {
  return (prisma as any).sancRegister.create({
    data: {
      registrationNumber: overrides.registrationNumber ?? `SANC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? "Nurse",
      category: overrides.category ?? "Professional Nurse",
      status: overrides.status ?? "Active",
      expiryDate: overrides.expiryDate ?? null,
    },
  });
}

describe("verifySancRegistration", () => {
  it("auto-verifies an active registration with a matching name", async () => {
    const nurse = await createNurseUser("sanc-active");
    const entry = await seedRegisterEntry({ firstName: "Test", lastName: "Nurse", status: "Active" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    expect(result.status).toBe("Active");
    expect(result.autoVerified).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: nurse.id } });
    expect((updated as any).sancVerificationStatus).toBe("Active");
  });

  it("flags NOT_FOUND for a registration number that isn't in the imported register, without verifying", async () => {
    const nurse = await createNurseUser("sanc-not-found");

    const result = await verifySancRegistration(nurse.id, "SANC-DOES-NOT-EXIST-999", "Test", "Nurse");

    expect(result.status).toBe("NOT_FOUND");
    expect(result.autoVerified).toBe(false);

    const updated = await prisma.user.findUnique({ where: { id: nurse.id } });
    expect((updated as any).sancVerificationStatus).toBe("NOT_FOUND");
  });

  it("leaves isVerified (the email-confirmed flag) alone", async () => {
    const nurse = await createNurseUser("sanc-email-flag");
    await prisma.user.update({ where: { id: nurse.id }, data: { isVerified: true } });

    await verifySancRegistration(nurse.id, "SANC-DOES-NOT-EXIST-998", "Test", "Nurse");

    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).isVerified).toBe(true);
  });

  it("flags NAME_MISMATCH when the submitted name doesn't match the register, even if the reg number is valid and active", async () => {
    const nurse = await createNurseUser("sanc-mismatch");
    const entry = await seedRegisterEntry({ firstName: "Sipho", lastName: "Mokoena", status: "Active" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Completely", "Different");

    expect(result.status).toBe("NAME_MISMATCH");
    expect(result.autoVerified).toBe(false);
  });

  it("allows a first-initial match (e.g. 'J Smith' registered, 'John Smith' submitted)", async () => {
    const nurse = await createNurseUser("sanc-initial-match");
    const entry = await seedRegisterEntry({ firstName: "J", lastName: "Smith", status: "Active" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "John", "Smith");

    expect(result.status).toBe("Active");
    expect(result.autoVerified).toBe(true);
  });

  it("flags SUSPENDED and does not verify, even with a matching name", async () => {
    const nurse = await createNurseUser("sanc-suspended");
    const entry = await seedRegisterEntry({ firstName: "Test", lastName: "Nurse", status: "Suspended" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    expect(result.status).toBe("SUSPENDED");
    expect(result.autoVerified).toBe(false);
  });

  it("flags CANCELLED and does not verify", async () => {
    const nurse = await createNurseUser("sanc-cancelled");
    const entry = await seedRegisterEntry({ firstName: "Test", lastName: "Nurse", status: "Cancelled" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    expect(result.status).toBe("CANCELLED");
    expect(result.autoVerified).toBe(false);
  });

  it("flags EXPIRED for an active-status entry whose expiry date is in the past", async () => {
    const nurse = await createNurseUser("sanc-expired");
    const entry = await seedRegisterEntry({
      firstName: "Test",
      lastName: "Nurse",
      status: "Active",
      expiryDate: new Date("2020-01-01"),
    });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    expect(result.status).toBe("EXPIRED");
    expect(result.autoVerified).toBe(false);
  });

  it("still verifies an active entry whose expiry date is in the future", async () => {
    const nurse = await createNurseUser("sanc-future-expiry");
    const entry = await seedRegisterEntry({
      firstName: "Test",
      lastName: "Nurse",
      status: "Active",
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    expect(result.status).toBe("Active");
    expect(result.autoVerified).toBe(true);
  });

  it("writes an audit log entry for every verification attempt", async () => {
    const nurse = await createNurseUser("sanc-audit");
    const entry = await seedRegisterEntry({ firstName: "Test", lastName: "Nurse", status: "Active" });

    await verifySancRegistration(nurse.id, entry.registrationNumber, "Test", "Nurse");

    const auditEntries = await prisma.auditLog.findMany({
      where: { userId: nurse.id, action: "SANC_VERIFICATION" },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(auditEntries[0].resourceId).toBe(entry.registrationNumber);
  });

  it("normalizes the registration number (trims and uppercases) before lookup", async () => {
    const nurse = await createNurseUser("sanc-normalize");
    // registrationNumber has a unique constraint — a fixed literal would
    // collide with a leftover row from a prior run against a persistent
    // (non-ephemeral) test database.
    const regNumber = `SANC-NORM-${Date.now()}`;
    const entry = await seedRegisterEntry({
      registrationNumber: regNumber,
      firstName: "Test",
      lastName: "Nurse",
      status: "Active",
    });

    const result = await verifySancRegistration(nurse.id, `  ${regNumber.toLowerCase()}  `, "Test", "Nurse");

    expect(result.status).toBe("Active");
    expect(result.registrationNumber).toBe(entry.registrationNumber);
  });
});

describe("submitSancNumber (a nurse entering their own number)", () => {
  it("keeps an already-verified number verified when it's re-entered", async () => {
    const nurse = await createNurseUser("sanc-resubmit-active");
    await prisma.user.update({ where: { id: nurse.id }, data: { sancId: "12345678", sancVerificationStatus: "Active" } });

    const res = await submitSancNumber(nurse.id, " 12345678 ");

    expect(res).toEqual({ status: "Active", changed: false });
  });

  it("re-checks a changed number, which takes verification away until it's checked", async () => {
    const nurse = await createNurseUser("sanc-change");
    await prisma.user.update({ where: { id: nurse.id }, data: { sancId: "12345678", sancVerificationStatus: "Active" } });

    const res = await submitSancNumber(nurse.id, `NEW-${Date.now()}`);

    expect(res.status).toBe("NOT_FOUND");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).sancVerificationStatus).toBe("NOT_FOUND");
  });

  it.each(["SUSPENDED", "CANCELLED"])("won't let a %s flag be shed by re-entering or changing the number", async (status) => {
    const nurse = await createNurseUser(`sanc-resubmit-${status}`);
    await prisma.user.update({ where: { id: nurse.id }, data: { sancId: "87654321", sancVerificationStatus: status } });

    await expect(submitSancNumber(nurse.id, "87654321")).rejects.toBeInstanceOf(SancRegistrationBlockedError);
    await expect(submitSancNumber(nurse.id, "11110000")).rejects.toBeInstanceOf(SancRegistrationBlockedError);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } });
    expect(row.sancVerificationStatus).toBe(status);
    expect(row.sancId).toBe("87654321");
  });
});

describe("recordSancCheck (an admin recording what SANC's register showed)", () => {
  it("verifies on ACTIVE and flags on anything else", async () => {
    const nurse = await createNurseUser("sanc-check");
    await prisma.user.update({ where: { id: nurse.id }, data: { sancId: "11112222", sancVerificationStatus: "NOT_FOUND" } });

    expect(await recordSancCheck({ nurseId: nurse.id, finding: "ACTIVE" })).toBe("Active");
    expect(await recordSancCheck({ nurseId: nurse.id, finding: "EXPIRED" })).toBe("EXPIRED");
    expect(await recordSancCheck({ nurseId: nurse.id, finding: "ACTIVE" })).toBe("Active");
  });

  it.each(["SUSPENDED", "CANCELLED"])("clears a %s flag only with an explicit confirmation", async (status) => {
    const nurse = await createNurseUser(`sanc-check-${status}`);
    await prisma.user.update({ where: { id: nurse.id }, data: { sancId: "33334444", sancVerificationStatus: status } });

    await expect(recordSancCheck({ nurseId: nurse.id, finding: "ACTIVE" })).rejects.toBeInstanceOf(SancRegistrationBlockedError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).sancVerificationStatus).toBe(status);

    expect(await recordSancCheck({ nurseId: nurse.id, finding: "ACTIVE", confirmStatusChange: true })).toBe("Active");
  });
});
