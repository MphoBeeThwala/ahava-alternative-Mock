/**
 * Admin routes: RBAC gate, user management, HPCSA/SANC manual-override
 * flows. Deliberately does NOT exercise POST /admin/reset-trial-data's
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
const ADMIN_SECRET = "test-admin-registration-secret";

beforeAll(() => {
  process.env.ADMIN_REGISTRATION_SECRET = ADMIN_SECRET;
});

async function registerAdmin(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: "Admin",
    role: "ADMIN",
    adminSecret: ADMIN_SECRET,
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

describe("admin: registration is gated by ADMIN_REGISTRATION_SECRET", () => {
  it("rejects ADMIN registration with a wrong or missing secret", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: uniqueEmail("admin-bad-secret"),
      password: STRONG_PASSWORD,
      firstName: "Bad",
      lastName: "Secret",
      role: "ADMIN",
      adminSecret: "wrong",
    });
    expect(res.status).toBe(403);
  });
});

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

describe("admin: user listing and creation", () => {
  it("lists users, including one just created directly by an admin", async () => {
    const admin = await registerAdmin("admin-list");
    const email = uniqueEmail("admin-created-user");

    const createRes = await admin.agent.post("/api/v1/admin/users").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "Staff",
      lastName: "Onboarded",
      role: "NURSE",
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
      .send({ verify: true });

    expect(res.status).toBe(200);
    expect(res.body.hcpsa.hcpsaVerified).toBe(true);
    expect(res.body.hcpsa.hcpsaVerifiedAt).not.toBeNull();
  });

  it("refuses to verify a doctor who has not submitted a number yet", async () => {
    const admin = await registerAdmin("admin-hpcsa-none");
    const doctor = await registerRole("DOCTOR", "admin-hpcsa-none-doctor");

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${doctor.userId}/hpcsa`)
      .send({ verify: true });

    expect(res.status).toBe(400);
  });

  it("404s for a non-doctor id on the HPCSA endpoint", async () => {
    const admin = await registerAdmin("admin-hpcsa-wrong-role");
    const patient = await registerRole("PATIENT", "admin-hpcsa-wrong-role-patient");

    const res = await admin.agent.get(`/api/v1/admin/users/${patient.userId}/hpcsa`);

    expect(res.status).toBe(404);
  });
});

describe("admin: SANC manual override (nurses)", () => {
  it("overrides a nurse flagged NOT_FOUND back to verified with a reason", async () => {
    const admin = await registerAdmin("admin-sanc");
    const nurse = await registerRole("NURSE", "admin-sanc-nurse");
    await prisma.user.update({
      where: { id: nurse.userId },
      data: { sancVerificationStatus: "NOT_FOUND" },
    });

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${nurse.userId}/sanc`)
      .send({ reason: "Manually confirmed registration via SANC phone line" });

    expect(res.status).toBe(200);
  });

  it("refuses to override a nurse who isn't flagged for review", async () => {
    const admin = await registerAdmin("admin-sanc-notflagged");
    const nurse = await registerRole("NURSE", "admin-sanc-notflagged-nurse");
    await prisma.user.update({
      where: { id: nurse.userId },
      data: { sancVerificationStatus: "Active" },
    });

    const res = await admin.agent
      .patch(`/api/v1/admin/users/${nurse.userId}/sanc`)
      .send({ reason: "Trying to override an already-active nurse" });

    expect(res.status).toBe(400);
  });

  it("requires a reason of at least 3 characters", async () => {
    const admin = await registerAdmin("admin-sanc-noreason");
    const nurse = await registerRole("NURSE", "admin-sanc-noreason-nurse");
    await prisma.user.update({
      where: { id: nurse.userId },
      data: { sancVerificationStatus: "EXPIRED" },
    });

    const res = await admin.agent.patch(`/api/v1/admin/users/${nurse.userId}/sanc`).send({ reason: "x" });

    expect(res.status).toBe(400);
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
