/**
 * Mandatory two-factor authentication for staff (services/mfaPolicy.ts).
 * Other suites run with enforcement off (testSetup/globalSetup.js); this
 * one turns it back on.
 */
import request from "supertest";
import { authenticator } from "otplib";
import { app } from "../index";
import prisma from "../lib/prisma";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const ADMIN_SECRET = "test-admin-registration-secret-mfa";
const previous = process.env.MFA_ENFORCEMENT_DISABLED_FOR_TESTS;

beforeAll(() => {
  process.env.MFA_ENFORCEMENT_DISABLED_FOR_TESTS = "false";
  process.env.ADMIN_REGISTRATION_SECRET = ADMIN_SECRET;
});
afterAll(() => {
  process.env.MFA_ENFORCEMENT_DISABLED_FOR_TESTS = previous;
});

async function register(role: "PATIENT" | "NURSE" | "DOCTOR" | "ADMIN", label: string) {
  const agent = request.agent(app);
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await agent.post("/api/v1/auth/register").send({
    email, password: STRONG_PASSWORD, firstName: label, lastName: "Tester", role,
    ...(role === "ADMIN" ? { adminSecret: ADMIN_SECRET } : {}),
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

async function enrol(agent: ReturnType<typeof request.agent>) {
  const setup = await agent.post("/api/v1/auth/2fa/setup").send({});
  expect(setup.status).toBe(200);
  const verify = await agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(setup.body.secret) });
  expect(verify.status).toBe(200);
  return setup.body.secret as string;
}

describe("mandatory two-factor authentication for staff", () => {
  it("limits a nurse without 2FA to enrolment until they set it up", async () => {
    const nurse = await register("NURSE", "mfa-nurse");

    const login = await request(app).post("/api/v1/auth/login").send({ email: nurse.email, password: STRONG_PASSWORD });
    expect(login.body.mfaEnrollmentRequired).toBe(true);

    const blocked = await nurse.agent.get("/api/v1/nurse/profile");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await nurse.agent.get("/api/v1/auth/me")).status).toBe(200);
    expect((await nurse.agent.post("/api/v1/auth/ws-ticket").send({})).status).toBe(403);

    await enrol(nurse.agent);

    expect((await nurse.agent.get("/api/v1/nurse/profile")).status).toBe(200);
  });

  it("applies to doctors and admins too, but not patients", async () => {
    const doctor = await register("DOCTOR", "mfa-doctor");
    const admin = await register("ADMIN", "mfa-admin");
    const patient = await register("PATIENT", "mfa-patient");

    expect((await doctor.agent.get("/api/v1/triage-review/profile/hpcsa")).body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await admin.agent.get("/api/v1/admin/stats")).body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await patient.agent.get("/api/v1/visits")).status).toBe(200);
  });

  it("requires the second factor at every staff login once enrolled", async () => {
    const doctor = await register("DOCTOR", "mfa-login-doctor");
    await enrol(doctor.agent);

    const login = await request(app).post("/api/v1/auth/login").send({ email: doctor.email, password: STRONG_PASSWORD });

    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.headers["set-cookie"]).toBeUndefined();
  });

  it("records sign-ins in the audit log: failures, the 2FA step, and success", async () => {
    const doctor = await register("DOCTOR", "mfa-audit-doctor");
    const secret = await enrol(doctor.agent);

    await request(app).post("/api/v1/auth/login").send({ email: doctor.email, password: "Wrong!Passw0rd" });
    const step1 = await request(app).post("/api/v1/auth/login").send({ email: doctor.email, password: STRONG_PASSWORD });
    await request(app).post("/api/v1/auth/2fa/login-verify").send({ pendingToken: step1.body.pendingToken, code: authenticator.generate(secret) });
    await request(app).post("/api/v1/auth/login").send({ email: `nobody-${Date.now()}@example.test`, password: STRONG_PASSWORD });

    const events = await prisma.auditLog.findMany({ where: { userId: doctor.userId, resource: "Auth" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["LOGIN_FAILED", "LOGIN_2FA_PENDING", "LOGIN_SUCCESS"]);
    expect((events[2].metadata as any).method).toBe("password+totp");
    expect((events[2].metadata as any).ipAddress).toBeDefined();
    const unknown = await prisma.auditLog.findFirst({ where: { resource: "Auth", action: "LOGIN_FAILED", userId: null }, orderBy: { createdAt: "desc" } });
    expect((unknown!.metadata as any).emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(unknown!.metadata)).not.toContain("nobody-");
  });

  it("keeps the same key when setup is opened again, so the app already holding it still works", async () => {
    const nurse = await register("NURSE", "mfa-reopen-nurse");
    const first = await nurse.agent.post("/api/v1/auth/2fa/setup").send({});
    // User adds this key to their authenticator app, then cancels and reopens setup.
    const second = await nurse.agent.post("/api/v1/auth/2fa/setup").send({});
    expect(second.body.secret).toBe(first.body.secret);

    const verify = await nurse.agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(first.body.secret) });
    expect(verify.status).toBe(200);
  });

  it("issues a new key only when asked, and the old one then stops working", async () => {
    const nurse = await register("NURSE", "mfa-regenerate-nurse");
    const first = await nurse.agent.post("/api/v1/auth/2fa/setup").send({});
    const fresh = await nurse.agent.post("/api/v1/auth/2fa/setup").send({ regenerate: true });
    expect(fresh.body.secret).not.toBe(first.body.secret);

    const stale = await nurse.agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(first.body.secret) });
    expect(stale.status).toBe(400);
    const ok = await nurse.agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(fresh.body.secret) });
    expect(ok.status).toBe(200);
  });

  it("does not let staff turn 2FA off", async () => {
    const nurse = await register("NURSE", "mfa-disable-nurse");
    const secret = await enrol(nurse.agent);

    const res = await nurse.agent.post("/api/v1/auth/2fa/disable").send({ password: STRONG_PASSWORD, code: authenticator.generate(secret) });

    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.userId } })).totpEnabled).toBe(true);
  });

  it("lets another admin reset a lost authenticator, ending the user's sessions", async () => {
    const admin = await register("ADMIN", "mfa-reset-admin");
    await enrol(admin.agent);
    const nurse = await register("NURSE", "mfa-reset-nurse");
    await enrol(nurse.agent);

    const self = await admin.agent.post(`/api/v1/admin/users/${admin.userId}/2fa/reset`).send({ reason: "Resetting my own device" });
    expect(self.status).toBe(403);

    const res = await admin.agent.post(`/api/v1/admin/users/${nurse.userId}/2fa/reset`).send({ reason: "Nurse reported lost phone, identity confirmed by line manager" });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: nurse.userId } });
    expect(user.totpEnabled).toBe(false);
    expect(user.totpSecret).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: nurse.userId } })).toBe(0);
    expect((await nurse.agent.get("/api/v1/nurse/profile")).body.code).toBe("MFA_ENROLLMENT_REQUIRED");
  });
});
