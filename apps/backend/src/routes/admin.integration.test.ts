/**
 * Admin routes: RBAC gate, user management, recording HPCSA/SANC register
 * checks. Deliberately does NOT exercise POST /admin/reset-trial-data's
 * actual deletion path — this suite shares one database with every other
 * integration test file in the same run, and that endpoint truncates
 * bookings/visits/messages/etc. platform-wide, so only its validation and
 * authorization branches are covered here.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

async function registerAdmin(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: "Admin",
    role: "ADMIN",
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

async function registerRole(role: "PATIENT" | "NURSE" | "DOCTOR", label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: role,
    role,
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

describe("admin: RBAC — non-admin roles are denied", () => {
  it.each(["PATIENT", "NURSE", "DOCTOR"] as const)("%s cannot list users", async (role) => {
    const { agent } = await registerRole(role, `admin-deny-${role.toLowerCase()}`);
    const res = await agent.get("/api/v1/admin/users");
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/admin/users");
    expect(res.status).toBe(401);
  });
});

describe("admin: user listing and patient creation", () => {
  it("lists users, including one just created directly by an admin", async () => {
    const admin = await registerAdmin("admin-list");
    const email = uniqueEmail("admin-created-user");

    const createRes = await admin.agent.post("/api/v1/admin/users").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "Assisted",
      lastName: "Patient",
      role: "PATIENT",
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.user.isActive).toBe(true);
    expect(createRes.body.user.isVerified).toBe(true);

    const listRes = await admin.agent.get("/api/v1/admin/users");
    expect(listRes.status).toBe(200);
    expect(listRes.body.users.some((u: any) => u.email === email)).toBe(true);
  });

  it("rejects creating a user with an email that already exists", async () => {
    const admin = await registerAdmin("admin-dup");
    const email = uniqueEmail("admin-dup-user");
    await admin.agent.post("/api/v1/admin/users").send({
      email, password: STRONG_PASSWORD, firstName: "First", lastName: "One", role: "PATIENT",
    });

    const res = await admin.agent.post("/api/v1/admin/users").send({
      email, password: STRONG_PASSWORD, firstName: "Second", lastName: "Two", role: "PATIENT",
    });

    expect(res.status).toBe(400);
  });

  it.each(["NURSE", "DOCTOR", "ADMIN"] as const)("won't create a %s account directly: staff come from an invite", async (role) => {
    const admin = await registerAdmin(`admin-direct-${role.toLowerCase()}`);
    const email = uniqueEmail("admin-direct-staff");

    const res = await admin.agent.post("/api/v1/admin/users").send({
      email, password: STRONG_PASSWORD, firstName: "Direct", lastName: "Staff", role,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USE_INVITE");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("rejects a weak password on admin-created users too", async () => {
    const admin = await registerAdmin("admin-weak-pw");

    const res = await admin.agent.post("/api/v1/admin/users").send({
      email: uniqueEmail("admin-weak-pw-user"),
      password: "weak",
      firstName: "Weak",
      lastName: "Password",
      role: "PATIENT",
    });

    expect(res.status).toBe(400);
  });
});

describe("admin: stats", () => {
  it("returns platform counts", async () => {
    const admin = await registerAdmin("admin-stats");
    const res = await admin.agent.get("/api/v1/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual(
      expect.objectContaining({
        userCount: expect.any(Number),
        bookingCount: expect.any(Number),
        visitCount: expect.any(Number),
        triageCaseCount: expect.any(Number),
      })
    );
  });
});

describe("admin: suspend / reactivate a user", () => {
  it("suspends a user, which invalidates their existing session", async () => {
    const admin = await registerAdmin("admin-suspend");
    const target = await registerRole("PATIENT", "admin-suspend-target");

    const stillActive = await target.agent.get("/api/v1/auth/me");
    expect(stillActive.status).toBe(200);

    const suspendRes = await admin.agent
      .patch(`/api/v1/admin/users/${target.userId}`)
      .send({ isActive: false });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.user.isActive).toBe(false);

    const afterSuspend = await target.agent.get("/api/v1/auth/me");
    expect(afterSuspend.status).toBe(401);
  });

  it("reactivates a suspended user", async () => {
    const admin = await registerAdmin("admin-reactivate");
    const target = await registerRole("PATIENT", "admin-reactivate-target");
    await admin.agent.patch(`/api/v1/admin/users/${target.userId}`).send({ isActive: false });

    const reactivateRes = await admin.agent
      .patch(`/api/v1/admin/users/${target.userId}`)
      .send({ isActive: true });

    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.user.isActive).toBe(true);
  });

  it("refuses to let an admin suspend their own account", async () => {
    const admin = await registerAdmin("admin-self-suspend");

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${admin.userId}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent user id", async () => {
    const admin = await registerAdmin("admin-suspend-missing");
    const res = await admin.agent
      .patch("/api/v1/admin/users/does-not-exist")
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe("admin: HPCSA verification (doctors)", () => {
  it("verifies a doctor's submitted HPCSA number", async () => {
    const admin = await registerAdmin("admin-hpcsa");
    const doctor = await registerRole("DOCTOR", "admin-hpcsa-doctor");
    await prisma.user.update({ where: { id: doctor.userId }, data: { hcpsaNumber: "MP1234567" } });

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${doctor.userId}/hpcsa`)
      .send({ verify: true, note: "iRegister shows MP1234567 active, name matches" });

    expect(res.status).toBe(200);
    expect(res.body.hcpsa.hcpsaVerified).toBe(true);
    expect(res.body.hcpsa.hcpsaVerifiedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { resource: "ProfessionalRegistration", resourceId: doctor.userId }, orderBy: { createdAt: "desc" } });
    expect(audit!.metadata).toMatchObject({ body: "HPCSA", number: "MP1234567", outcome: "VERIFIED", note: "iRegister shows MP1234567 active, name matches" });
  });

  it("requires a note of what was checked", async () => {
    const admin = await registerAdmin("admin-hpcsa-nonote");
    const doctor = await registerRole("DOCTOR", "admin-hpcsa-nonote-doctor");
    await prisma.user.update({ where: { id: doctor.userId }, data: { hcpsaNumber: "MP7654321" } });

    const res = await admin.agent.patch(`/api/v1/admin/users/${doctor.userId}/hpcsa`).send({ verify: true });

    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: doctor.userId } })).hcpsaVerified).toBe(false);
  });

  it("refuses to verify a doctor who has not submitted a number yet", async () => {
    const admin = await registerAdmin("admin-hpcsa-none");
    const doctor = await registerRole("DOCTOR", "admin-hpcsa-none-doctor");

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${doctor.userId}/hpcsa`)
      .send({ verify: true, note: "Nothing to check, no number submitted" });

    expect(res.status).toBe(400);
  });

  it("404s for a non-doctor id on the HPCSA endpoint", async () => {
    const admin = await registerAdmin("admin-hpcsa-wrong-role");
    const patient = await registerRole("PATIENT", "admin-hpcsa-wrong-role-patient");

    const res = await admin.agent.get(`/api/v1/admin/users/${patient.userId}/hpcsa`);

    expect(res.status).toBe(404);
  });
});

describe("admin: recording SANC register checks (nurses)", () => {
  const NOTE = "Checked SANC online register today: active, name matches";

  async function nurseWith(label: string, sancVerificationStatus: string | null, sancId: string | null = "12345678") {
    const nurse = await registerRole("NURSE", label);
    await prisma.user.update({ where: { id: nurse.userId }, data: { sancId, sancVerificationStatus } });
    return nurse;
  }

  it("verifies a flagged nurse when the admin records the register shows them active", async () => {
    const admin = await registerAdmin("admin-sanc");
    const nurse = await nurseWith("admin-sanc-nurse", "NOT_FOUND");

    const res = await admin.agent.patch(`/api/v1/admin/users/${nurse.userId}/sanc`).send({ finding: "ACTIVE", note: NOTE });

    expect(res.status).toBe(200);
    expect(res.body.sanc.sancVerificationStatus).toBe("Active");
    const audit = await prisma.auditLog.findFirst({ where: { resource: "ProfessionalRegistration", resourceId: nurse.userId }, orderBy: { createdAt: "desc" } });
    expect(audit!.metadata).toMatchObject({ body: "SANC", number: "12345678", outcome: "VERIFIED", previousStatus: "NOT_FOUND", note: NOTE });
  });

  it("takes verification away and the nurse offline when the register shows a problem", async () => {
    const admin = await registerAdmin("admin-sanc-revoke");
    const nurse = await nurseWith("admin-sanc-revoke-nurse", "Active");
    await prisma.user.update({ where: { id: nurse.userId }, data: { isAvailable: true } });

    const res = await admin.agent.patch(`/api/v1/admin/users/${nurse.userId}/sanc`).send({ finding: "SUSPENDED", note: "SANC register lists this registration as suspended" });

    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: nurse.userId } });
    expect(row.sancVerificationStatus).toBe("SUSPENDED");
    expect(row.isAvailable).toBe(false);
  });

  it("won't mark a suspended registration active without confirming the register now shows it active", async () => {
    const admin = await registerAdmin("admin-sanc-suspended");
    const nurse = await nurseWith("admin-sanc-suspended-nurse", "SUSPENDED");

    const blocked = await admin.agent.patch(`/api/v1/admin/users/${nurse.userId}/sanc`).send({ finding: "ACTIVE", note: NOTE });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("SANC_STATUS_CHANGE_UNCONFIRMED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.userId } })).sancVerificationStatus).toBe("SUSPENDED");

    const confirmed = await admin.agent.patch(`/api/v1/admin/users/${nurse.userId}/sanc`).send({ finding: "ACTIVE", note: "Suspension lifted: SANC register shows active as of today", confirmStatusChange: true });
    expect(confirmed.status).toBe(200);
  });

  it("needs a number to check, and a note of what was checked", async () => {
    const admin = await registerAdmin("admin-sanc-validation");
    const noNumber = await nurseWith("admin-sanc-nonumber", null, null);
    const flagged = await nurseWith("admin-sanc-nonote", "EXPIRED");

    expect((await admin.agent.patch(`/api/v1/admin/users/${noNumber.userId}/sanc`).send({ finding: "ACTIVE", note: NOTE })).status).toBe(400);
    expect((await admin.agent.patch(`/api/v1/admin/users/${flagged.userId}/sanc`).send({ finding: "ACTIVE", note: "ok" })).status).toBe(400);
  });
});

describe("nurse: entering their own SANC number", () => {
  it("lets an unverified nurse submit a number, which flags them for an admin check", async () => {
    const nurse = await registerRole("NURSE", "nurse-sanc-self");

    const res = await nurse.agent.patch("/api/v1/nurse/profile/sanc").send({ sancRegistrationNumber: `SELF-${Date.now()}` });

    expect(res.status).toBe(200);
    expect(res.body.sanc.sancVerificationStatus).toBe("NOT_FOUND");
    // No other register entry's name ever comes back to the nurse.
    expect(JSON.stringify(res.body)).not.toMatch(/register \(/);
  });

  it("takes a verified nurse offline when they change to an unchecked number", async () => {
    const nurse = await registerRole("NURSE", "nurse-sanc-change");
    await prisma.user.update({ where: { id: nurse.userId }, data: { sancId: "12345678", sancVerificationStatus: "Active", isAvailable: true } });

    const res = await nurse.agent.patch("/api/v1/nurse/profile/sanc").send({ sancRegistrationNumber: `CHG-${Date.now()}` });

    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: nurse.userId } });
    expect(row.sancVerificationStatus).toBe("NOT_FOUND");
    expect(row.isAvailable).toBe(false);
  });

  it("refuses to clear a suspension by re-entering the same number, and rejects junk", async () => {
    const nurse = await registerRole("NURSE", "nurse-sanc-suspended");
    await prisma.user.update({ where: { id: nurse.userId }, data: { sancId: "99998888", sancVerificationStatus: "SUSPENDED" } });

    expect((await nurse.agent.patch("/api/v1/nurse/profile/sanc").send({ sancRegistrationNumber: "99998888" })).status).toBe(409);
    expect((await nurse.agent.patch("/api/v1/nurse/profile/sanc").send({ sancRegistrationNumber: "<script>" })).status).toBe(400);
  });
});

describe("admin: reset-trial-data validation (destructive path not exercised)", () => {
  it("rejects the call without the literal RESET confirmation", async () => {
    const admin = await registerAdmin("admin-reset-noconfirm");
    const res = await admin.agent.post("/api/v1/admin/reset-trial-data").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a non-admin caller before validation even matters", async () => {
    const target = await registerRole("PATIENT", "admin-reset-non-admin");
    const res = await target.agent.post("/api/v1/admin/reset-trial-data").send({ confirm: "RESET" });
    expect(res.status).toBe(403);
  });
});
