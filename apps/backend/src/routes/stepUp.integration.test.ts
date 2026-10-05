/**
 * Step-up authentication for sensitive actions (middleware/stepUp.ts), and
 * the tighter staff session policy (services/sessionPolicy.ts). Other suites
 * run with step-up off (testSetup/globalSetup.js); this one turns it back on.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { authenticator } from "otplib";
import { app } from "../index";
import prisma from "../lib/prisma";
import * as queue from "../services/queue";
import { getJwtSecret, TOKEN_ALGORITHM, TOKEN_AUDIENCE, TOKEN_ISSUER } from "../services/tokens";

const PASSWORD = "Str0ng!Passw0rd";
const previous = process.env.STEP_UP_DISABLED_FOR_TESTS;
beforeAll(() => { process.env.STEP_UP_DISABLED_FOR_TESTS = "false"; });
afterAll(() => { process.env.STEP_UP_DISABLED_FOR_TESTS = previous; });

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function register(role: "PATIENT" | "NURSE" | "ADMIN", label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: label, lastName: "Tester", role });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string, cookies: res.headers["set-cookie"] as unknown as string[] };
}

async function enrol(agent: ReturnType<typeof request.agent>) {
  const setup = await agent.post("/api/v1/auth/2fa/setup").send({});
  expect(setup.status).toBe(200);
  expect((await agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(setup.body.secret) })).status).toBe(200);
  return setup.body.secret as string;
}

describe("step-up for sensitive admin actions", () => {
  it("asks for a fresh code, accepts a correct one, and the window runs out", async () => {
    const admin = await register("ADMIN", "stepup-admin");
    const secret = await enrol(admin.agent);
    const spy = jest.spyOn(queue, "addEmailJob").mockResolvedValue(undefined as never);
    const invite = { email: uniqueEmail("invitee"), role: "NURSE" };

    const refused = await admin.agent.post("/api/v1/admin/invites").send(invite);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("STEP_UP_REQUIRED");

    const wrong = await admin.agent.post("/api/v1/auth/2fa/step-up").send({ code: "000000" });
    expect(wrong.status).toBe(401);
    expect((await admin.agent.post("/api/v1/admin/invites").send(invite)).status).toBe(403);

    const ok = await admin.agent.post("/api/v1/auth/2fa/step-up").send({ code: authenticator.generate(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.validForSeconds).toBeGreaterThan(0);
    expect((await admin.agent.post("/api/v1/admin/invites").send(invite)).status).toBe(201);

    // 10 minutes later the window has closed.
    await prisma.user.update({ where: { id: admin.userId }, data: { stepUpVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await admin.agent.post("/api/v1/admin/invites").send({ ...invite, email: uniqueEmail("invitee2") })).body.code).toBe("STEP_UP_REQUIRED");
    spy.mockRestore();

    expect(await prisma.auditLog.findFirst({ where: { userId: admin.userId, action: "STEP_UP_SUCCESS" } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { userId: admin.userId, action: "STEP_UP_FAILED" } })).not.toBeNull();
  });

  it("locks the step-up endpoint after repeated wrong codes", async () => {
    const admin = await register("ADMIN", "stepup-lock");
    await enrol(admin.agent);
    for (let i = 0; i < 5; i++) expect((await admin.agent.post("/api/v1/auth/2fa/step-up").send({ code: "000000" })).status).toBe(401);
    expect((await admin.agent.post("/api/v1/auth/2fa/step-up").send({ code: "000000" })).status).toBe(429);
  });

  it("an admin without 2FA gets pointed at enrolment, not a code prompt", async () => {
    const admin = await register("ADMIN", "stepup-no2fa");
    const res = await admin.agent.post("/api/v1/admin/invites").send({ email: uniqueEmail("x"), role: "NURSE" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
  });

  it("lets an admin suspend an account with one click, but reactivating needs step-up", async () => {
    const admin = await register("ADMIN", "stepup-suspend");
    const secret = await enrol(admin.agent);
    const target = await register("PATIENT", "stepup-target");

    expect((await admin.agent.patch(`/api/v1/admin/users/${target.userId}`).send({ isActive: false })).status).toBe(200);
    const blocked = await admin.agent.patch(`/api/v1/admin/users/${target.userId}`).send({ isActive: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("STEP_UP_REQUIRED");

    await admin.agent.post("/api/v1/auth/2fa/step-up").send({ code: authenticator.generate(secret) });
    expect((await admin.agent.patch(`/api/v1/admin/users/${target.userId}`).send({ isActive: true })).status).toBe(200);
  });
});

function forgedRefreshToken(userId: string, role: string, ageSeconds: number, sessionAgeSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { userId, role, typ: "refresh", authTime: now - sessionAgeSeconds, iat: now - ageSeconds },
    getJwtSecret(),
    { algorithm: TOKEN_ALGORITHM, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE, expiresIn: 7 * 86400, jwtid: crypto.randomUUID() },
  );
}
async function storeRefresh(userId: string, token: string) {
  await prisma.refreshToken.create({ data: { token: crypto.createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 86400_000) } });
}

describe("staff session policy", () => {
  it("gives staff a 5-minute access token and patients 15", async () => {
    const nurse = await register("NURSE", "sess-nurse-ttl");
    const patient = await register("PATIENT", "sess-patient-ttl");
    const ttl = (cookies: string[]) => {
      const raw = cookies.find((c) => c.startsWith("ahava_access_token="))!.split(";")[0].split("=")[1];
      const { exp, iat } = jwt.decode(decodeURIComponent(raw)) as { exp: number; iat: number };
      return exp - iat;
    };
    expect(ttl(nurse.cookies)).toBe(300);
    expect(ttl(patient.cookies)).toBe(900);
  });

  it("refuses to refresh an idle staff session, and deletes it", async () => {
    const nurse = await register("NURSE", "sess-idle");
    const token = forgedRefreshToken(nurse.userId, "NURSE", 20 * 60, 20 * 60);
    await storeRefresh(nurse.userId, token);

    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_IDLE_TIMEOUT");
    expect(await prisma.refreshToken.count({ where: { token: crypto.createHash("sha256").update(token).digest("hex") } })).toBe(0);
    expect(await prisma.auditLog.findFirst({ where: { userId: nurse.userId, action: "SESSION_EXPIRED" } })).not.toBeNull();
  });

  it("refuses to refresh a staff session past its absolute lifetime, however active", async () => {
    const nurse = await register("NURSE", "sess-max");
    const token = forgedRefreshToken(nurse.userId, "NURSE", 2 * 60, 13 * 3600);
    await storeRefresh(nurse.userId, token);

    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_MAX_AGE");
  });

  it("refreshes an active staff session and keeps the original session start", async () => {
    const nurse = await register("NURSE", "sess-ok");
    const token = forgedRefreshToken(nurse.userId, "NURSE", 4 * 60, 3 * 3600);
    await storeRefresh(nurse.userId, token);

    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(200);
    const next = jwt.decode(res.body.refreshToken) as { authTime: number };
    expect(Math.abs(next.authTime - (jwt.decode(token) as { authTime: number }).authTime)).toBe(0);
  });

  it("never applies the staff limits to a patient", async () => {
    const patient = await register("PATIENT", "sess-patient");
    const token = forgedRefreshToken(patient.userId, "PATIENT", 3 * 86400, 3 * 86400);
    await storeRefresh(patient.userId, token);

    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: token })).status).toBe(200);
  });
});

describe("login throttling", () => {
  it("blocks one IP after repeated failures but lets the real owner in from another", async () => {
    const patient = await register("PATIENT", "throttle-owner");
    const attacker = "203.0.113.200";
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", attacker).send({ email: patient.email, password: "Wrong!Passw0rd1" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", attacker).send({ email: patient.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("LOGIN_THROTTLED");
    expect(blocked.headers["retry-after"]).toBeDefined();

    const owner = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "198.51.100.77").send({ email: patient.email, password: PASSWORD });
    expect(owner.status).toBe(200);
  });
});
