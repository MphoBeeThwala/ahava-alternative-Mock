/**
 * Account-security hardening (Phase A):
 *  - reset / verification tokens are stored hashed, and verification expires
 *  - changing the sign-in email needs the current password (and 2FA code)
 *  - the destructive trial-data reset is off in production
 *  - an admin account can't act through the patient gates
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import * as queue from "../services/queue";
import { hashOneTimeToken } from "../services/oneTimeTokens";
import { invalidateCachedUser } from "../middleware/auth";

const PASSWORD = "Str0ng!Passw0rd";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function registerPatient(label: string) {
  const email = uniqueEmail(label);
  const device1 = request.agent(app);
  const res = await device1.post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: label, lastName: "Tester", role: "PATIENT" });
  expect(res.status).toBe(201);
  const device2 = request.agent(app);
  expect((await device2.post("/api/v1/auth/login").send({ email, password: PASSWORD })).status).toBe(200);
  return { email, userId: res.body.user.id as string, device1, device2 };
}

function capturedToken(spy: jest.SpyInstance): string {
  const mail = spy.mock.calls.at(-1)![0] as { html: string; text?: string };
  return /token=([0-9a-f]{64})/.exec(`${mail.text ?? ""}${mail.html}`)![1];
}

describe("one-time email tokens are stored hashed", () => {
  it("keeps only the hash of a password-reset token, and the hash itself is not a working token", async () => {
    const { email, userId } = await registerPatient("tok-reset");
    const spy = jest.spyOn(queue, "addEmailJob").mockResolvedValue(undefined as never);
    await request(app).post("/api/v1/auth/forgot-password").send({ email });
    const token = capturedToken(spy);
    spy.mockRestore();

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordResetToken: true } });
    expect(stored.passwordResetToken).toBe(hashOneTimeToken(token));
    expect(stored.passwordResetToken).not.toBe(token);

    // Someone who only has the database value can't reset the password.
    const withHash = await request(app).post("/api/v1/auth/reset-password").send({ token: stored.passwordResetToken, password: "N3w!Passw0rd-2026" });
    expect(withHash.status).toBe(400);
    const withToken = await request(app).post("/api/v1/auth/reset-password").send({ token, password: "N3w!Passw0rd-2026" });
    expect(withToken.status).toBe(200);
  });

  it("verifies an email with the emailed token, and refuses it once expired", async () => {
    const spy = jest.spyOn(queue, "addEmailJob").mockResolvedValue(undefined as never);
    const { userId } = await registerPatient("tok-verify");
    const token = capturedToken(spy);
    spy.mockRestore();

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerificationToken: true, emailVerificationExpiry: true } });
    expect(stored.emailVerificationToken).toBe(hashOneTimeToken(token));
    expect(stored.emailVerificationExpiry!.getTime()).toBeGreaterThan(Date.now());

    expect((await request(app).get("/api/v1/auth/verify-email").query({ token: stored.emailVerificationToken })).status).toBe(400);

    await prisma.user.update({ where: { id: userId }, data: { emailVerificationExpiry: new Date(Date.now() - 1000) } });
    expect((await request(app).get("/api/v1/auth/verify-email").query({ token })).status).toBe(400);

    await prisma.user.update({ where: { id: userId }, data: { emailVerificationExpiry: new Date(Date.now() + 60_000) } });
    expect((await request(app).get("/api/v1/auth/verify-email").query({ token })).status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.isVerified).toBe(true);
    expect(after.emailVerificationToken).toBeNull();
  });
});

describe("changing the sign-in email needs re-authentication", () => {
  it("refuses without the current password, and with a wrong one", async () => {
    const { device1, email, userId } = await registerPatient("email-noreauth");
    const newEmail = uniqueEmail("email-new");

    const none = await device1.put("/api/v1/auth/profile").send({ email: newEmail });
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("REAUTH_REQUIRED");

    const wrong = await device1.put("/api/v1/auth/profile").send({ email: newEmail, currentPassword: "Wrong!Passw0rd1" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("REAUTH_FAILED");

    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email);
    expect(await prisma.auditLog.findFirst({ where: { userId, action: "EMAIL_CHANGE_FAILED" } })).not.toBeNull();
  });

  it("changes it with the password, signs out other devices, un-verifies, notifies the old address and audits", async () => {
    const { device1, device2, email, userId } = await registerPatient("email-reauth");
    const newEmail = uniqueEmail("email-changed");
    const spy = jest.spyOn(queue, "addEmailJob").mockResolvedValue(undefined as never);

    const res = await device1.put("/api/v1/auth/profile").send({ email: newEmail, currentPassword: PASSWORD });
    const recipients = spy.mock.calls.map((c) => c[0].to);
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.emailChanged).toBe(true);
    expect(recipients).toContain(newEmail);
    expect(recipients).toContain(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.email).toBe(newEmail);
    expect(user.isVerified).toBe(false);
    expect((await device2.post("/api/v1/auth/refresh").send({})).status).toBe(401);
    expect((await device1.post("/api/v1/auth/refresh").send({})).status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { userId, action: "EMAIL_CHANGED" } })).not.toBeNull();
  });

  it("does not ask for the password when other fields change but the email doesn't", async () => {
    const { device1 } = await registerPatient("email-same");
    const res = await device1.put("/api/v1/auth/profile").send({ firstName: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.emailChanged).toBe(false);
  });
});

describe("admin accounts don't pass the patient gates", () => {
  it("cannot create a booking or read patient triage cases", async () => {
    const admin = request.agent(app);
    const email = uniqueEmail("gate-admin");
    expect((await admin.post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: "Gate", lastName: "Admin", role: "ADMIN" })).status).toBe(201);
    expect((await admin.post("/api/v1/bookings").send({})).status).toBe(403);
    expect((await admin.get("/api/v1/triage/my-cases")).status).toBe(403);
  });
});

describe("reset-trial-data is disabled in production", () => {
  const originalEnv = { NODE_ENV: process.env.NODE_ENV, ALLOW: process.env.ALLOW_TRIAL_DATA_RESET };
  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.ALLOW === undefined) delete process.env.ALLOW_TRIAL_DATA_RESET;
    else process.env.ALLOW_TRIAL_DATA_RESET = originalEnv.ALLOW;
  });

  it("refuses an admin in production without the explicit opt-in, and audits the attempt", async () => {
    const admin = request.agent(app);
    const email = uniqueEmail("reset-prod-admin");
    const reg = await admin.post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: "Reset", lastName: "Admin", role: "ADMIN" });
    expect(reg.status).toBe(201);

    // In production the staff-2FA bypass used by the test suite is off, so
    // the admin has to look enrolled to reach the route at all.
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { totpEnabled: true } });
    await invalidateCachedUser(reg.body.user.id);

    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_TRIAL_DATA_RESET;
    const res = await admin.post("/api/v1/admin/reset-trial-data").send({ confirm: "RESET" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RESET_DISABLED");
    expect(await prisma.auditLog.findFirst({ where: { userId: reg.body.user.id, action: "ACCESS_DENIED", resource: "AdminAction" } })).not.toBeNull();
  });
});
