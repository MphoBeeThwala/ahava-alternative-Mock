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
import { verifySancRegistration, adminOverrideVerification } from "./sancVerification";
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
    expect((updated as any).isVerified).toBe(true);
    expect((updated as any).sancVerificationStatus).toBe("Active");
  });

  it("flags NOT_FOUND for a registration number that isn't in the imported register, without verifying", async () => {
    const nurse = await createNurseUser("sanc-not-found");

    const result = await verifySancRegistration(nurse.id, "SANC-DOES-NOT-EXIST-999", "Test", "Nurse");

    expect(result.status).toBe("NOT_FOUND");
    expect(result.autoVerified).toBe(false);

    const updated = await prisma.user.findUnique({ where: { id: nurse.id } });
    expect((updated as any).isVerified).toBe(false);
  });

  it("flags NAME_MISMATCH when the submitted name doesn't match the register, even if the reg number is valid and active", async () => {
    const nurse = await createNurseUser("sanc-mismatch");
    const entry = await seedRegisterEntry({ firstName: "Sipho", lastName: "Mokoena", status: "Active" });

    const result = await verifySancRegistration(nurse.id, entry.registrationNumber, "Completely", "Different");

    expect(result.status).toBe("NAME_MISMATCH");
    expect(result.autoVerified).toBe(false);
    const updated = await prisma.user.findUnique({ where: { id: nurse.id } });
    expect((updated as any).isVerified).toBe(false);
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

describe("adminOverrideVerification", () => {
  it("forces a nurse to verified/Active regardless of their prior flagged status", async () => {
    const nurse = await createNurseUser("sanc-override");
    const admin = await prisma.user.create({
      data: {
        email: uniqueEmail("sanc-override-admin"),
        passwordHash: "not-a-real-hash",
        firstName: "Admin",
        lastName: "User",
        role: UserRole.ADMIN,
      },
    });
    await prisma.user.update({
      where: { id: nurse.id },
      data: { sancVerificationStatus: "NOT_FOUND" as any, isVerified: false },
    });

    await adminOverrideVerification(nurse.id, admin.id, "Confirmed via SANC phone line");

    const updated = await prisma.user.findUnique({ where: { id: nurse.id } });
    expect((updated as any).isVerified).toBe(true);
    expect((updated as any).sancVerificationStatus).toBe("Active");

    const auditEntries = await prisma.auditLog.findMany({
      where: { userId: admin.id, action: "SANC_MANUAL_OVERRIDE" },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    expect((auditEntries[0].metadata as any).reason).toBe("Confirmed via SANC phone line");
  });
});
