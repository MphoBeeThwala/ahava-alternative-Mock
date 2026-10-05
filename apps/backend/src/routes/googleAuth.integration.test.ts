/**
 * Sign in with Google for patients (routes/googleAuth.ts). Google's token
 * verification is mocked; everything after it (nonce, linking rules, staff
 * exclusion, sessions) is the real code against a real database.
 */
import request from "supertest";
import { authenticator } from "otplib";
import { app } from "../index";
import prisma from "../lib/prisma";
import * as google from "../services/googleIdentity";

const PASSWORD = "Str0ng!Passw0rd";
const prevClientId = process.env.GOOGLE_CLIENT_ID;
beforeAll(() => { process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"; });
afterAll(() => {
  if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prevClientId;
});
afterEach(() => jest.restoreAllMocks());

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const uniqueSub = () => `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Agent = ReturnType<typeof request.agent>;

const startsSession = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).some((c) => c.startsWith("ahava_access_token="));

/** Runs the real nonce step, then "Google" returns a token embedding that nonce. */
async function googleSignIn(agent: Agent, profile: Partial<google.GoogleProfile> & { email: string; subject: string }, opts: { nonce?: string } = {}) {
  const { nonce } = (await agent.post("/api/v1/auth/google/nonce").send({})).body;
  jest.spyOn(google, "verifyGoogleIdToken").mockResolvedValue({
    emailVerified: true, givenName: "Gia", familyName: "Googler", nonce: opts.nonce ?? nonce, ...profile,
  });
  return agent.post("/api/v1/auth/google").send({ credential: "fake-id-token" });
}

async function registerPatient(label: string, role: "PATIENT" | "NURSE" | "ADMIN" = "PATIENT") {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: label, lastName: "Tester", role });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

describe("when Google sign-in isn't configured", () => {
  it("reports disabled and 404s every action", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(app).get("/api/v1/auth/google/config")).body).toEqual({ enabled: false, clientId: null });
    expect((await request(app).post("/api/v1/auth/google/nonce").send({})).status).toBe(404);
    expect((await request(app).post("/api/v1/auth/google").send({ credential: "x" })).status).toBe(404);
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  });

  it("reports enabled, with the web client id, once configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "web.apps.googleusercontent.com, android.apps.googleusercontent.com";
    expect((await request(app).get("/api/v1/auth/google/config")).body).toEqual({ enabled: true, clientId: "web.apps.googleusercontent.com" });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  });
});

describe("signing in with Google as a new patient", () => {
  it("creates a verified PATIENT with no password, links the identity, and starts a session", async () => {
    const agent = request.agent(app);
    const email = uniqueEmail("g-new");
    const subject = uniqueSub();

    const res = await googleSignIn(agent, { email, subject });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, role: "PATIENT", isVerified: true, firstName: "Gia", lastName: "Googler" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(await prisma.authIdentity.findUnique({ where: { provider_subject: { provider: "GOOGLE", subject } } })).toMatchObject({ userId: user.id });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { userId: user.id, action: "CREATE", resource: "Auth" } })).not.toBeNull();
  });

  it("recognises the same Google account next time, even if its email changed", async () => {
    const email = uniqueEmail("g-return");
    const subject = uniqueSub();
    await googleSignIn(request.agent(app), { email, subject });

    const again = await googleSignIn(request.agent(app), { email: uniqueEmail("g-return-renamed"), subject });

    expect(again.status).toBe(200);
    expect(again.body.user.email).toBe(email);
  });

  it("can't be used for password login", async () => {
    const email = uniqueEmail("g-nopw");
    await googleSignIn(request.agent(app), { email, subject: uniqueSub() });
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD })).status).toBe(401);
  });
});

describe("rejecting bad Google tokens", () => {
  it("rejects a token Google's check refuses", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/google/nonce").send({});
    jest.spyOn(google, "verifyGoogleIdToken").mockRejectedValue(new google.GoogleTokenError("bad"));
    const res = await agent.post("/api/v1/auth/google").send({ credential: "forged" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  it("rejects a token whose nonce isn't the one this browser asked for", async () => {
    const res = await googleSignIn(request.agent(app), { email: uniqueEmail("g-nonce"), subject: uniqueSub() }, { nonce: "someone-elses-nonce" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_NONCE_INVALID");
  });

  it("rejects a token with no nonce cookie at all (token injection)", async () => {
    jest.spyOn(google, "verifyGoogleIdToken").mockResolvedValue({ subject: uniqueSub(), email: uniqueEmail("g-inject"), emailVerified: true, nonce: "x" });
    const res = await request(app).post("/api/v1/auth/google").send({ credential: "t" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_NONCE_INVALID");
  });

  it("makes the nonce single-use", async () => {
    const agent = request.agent(app);
    const profile = { email: uniqueEmail("g-once"), subject: uniqueSub() };
    const { nonce } = (await agent.post("/api/v1/auth/google/nonce").send({})).body;
    jest.spyOn(google, "verifyGoogleIdToken").mockResolvedValue({ ...profile, emailVerified: true, nonce });
    expect((await agent.post("/api/v1/auth/google").send({ credential: "t" })).status).toBe(200);
    expect((await agent.post("/api/v1/auth/google").send({ credential: "t" })).status).toBe(401);
  });

  it("rejects an email Google hasn't verified", async () => {
    const res = await googleSignIn(request.agent(app), { email: uniqueEmail("g-unverified"), subject: uniqueSub(), emailVerified: false });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_EMAIL_UNVERIFIED");
  });
});

describe("an existing password account is never merged without its password", () => {
  it("asks for the password, creates no link and no session until it's proven", async () => {
    const patient = await registerPatient("g-link");
    const subject = uniqueSub();
    const agent = request.agent(app);

    const first = await googleSignIn(agent, { email: patient.email, subject });

    expect(first.status).toBe(200);
    expect(first.body.linkRequired).toBe(true);
    expect(first.body.success).toBe(false);
    expect(startsSession(first)).toBe(false);
    expect(await prisma.authIdentity.count({ where: { userId: patient.userId } })).toBe(0);

    const wrong = await agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: "Wrong!Passw0rd1" });
    expect(wrong.status).toBe(401);
    expect(await prisma.authIdentity.count({ where: { userId: patient.userId } })).toBe(0);

    const ok = await agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(patient.userId);
    expect(await prisma.authIdentity.count({ where: { userId: patient.userId, subject } })).toBe(1);
    expect(await prisma.auditLog.findFirst({ where: { userId: patient.userId, action: "UPDATE", resource: "Auth" } })).not.toBeNull();

    // From now on Google alone is enough.
    const next = await googleSignIn(request.agent(app), { email: patient.email, subject });
    expect(next.body.user?.id).toBe(patient.userId);
  });

  it("won't accept a link token that's expired or forged", async () => {
    const res = await request(app).post("/api/v1/auth/google/link").send({ linkToken: "not-a-token", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_LINK_EXPIRED");
  });

  it("also needs the authenticator code when the patient turned 2FA on", async () => {
    const patient = await registerPatient("g-link-2fa");
    const setup = await patient.agent.post("/api/v1/auth/2fa/setup").send({});
    await patient.agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(setup.body.secret) });
    const agent = request.agent(app);
    const first = await googleSignIn(agent, { email: patient.email, subject: uniqueSub() });
    expect(first.body.needsTwoFactorCode).toBe(true);

    const noCode = await agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: PASSWORD });
    expect(noCode.status).toBe(403);
    expect(noCode.body.code).toBe("REAUTH_CODE_REQUIRED");
    const ok = await agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: PASSWORD, code: authenticator.generate(setup.body.secret) });
    expect(ok.status).toBe(200);
  });

  it("still asks a linked patient with 2FA for their code after Google", async () => {
    const patient = await registerPatient("g-2fa-after");
    const setup = await patient.agent.post("/api/v1/auth/2fa/setup").send({});
    await patient.agent.post("/api/v1/auth/2fa/verify-setup").send({ code: authenticator.generate(setup.body.secret) });
    const subject = uniqueSub();
    const agent = request.agent(app);
    const first = await googleSignIn(agent, { email: patient.email, subject });
    await agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: PASSWORD, code: authenticator.generate(setup.body.secret) });

    const next = await googleSignIn(request.agent(app), { email: patient.email, subject });

    expect(next.body.twoFactorRequired).toBe(true);
    expect(next.body.pendingToken).toBeDefined();
    expect(startsSession(next)).toBe(false);
  });

  it("throttles password guessing through the link endpoint", async () => {
    const patient = await registerPatient("g-link-throttle");
    const agent = request.agent(app);
    const first = await googleSignIn(agent, { email: patient.email, subject: uniqueSub() });
    for (let i = 0; i < 5; i++) {
      expect((await agent.post("/api/v1/auth/google/link").set("X-Forwarded-For", "203.0.113.55").send({ linkToken: first.body.linkToken, password: "Wrong!Passw0rd1" })).status).toBe(401);
    }
    const blocked = await agent.post("/api/v1/auth/google/link").set("X-Forwarded-For", "203.0.113.55").send({ linkToken: first.body.linkToken, password: PASSWORD });
    expect(blocked.status).toBe(429);
  });
});

describe("staff are never reachable through Google", () => {
  it.each(["NURSE", "ADMIN"] as const)("refuses a Google account whose email belongs to a %s", async (role) => {
    const staff = await registerPatient(`g-staff-${role.toLowerCase()}`, role);
    const res = await googleSignIn(request.agent(app), { email: staff.email, subject: uniqueSub() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("GOOGLE_NOT_AVAILABLE");
    expect(await prisma.authIdentity.count({ where: { userId: staff.userId } })).toBe(0);
  });

  it("refuses an identity that somehow points at a staff user", async () => {
    const staff = await registerPatient("g-staff-forced", "NURSE");
    const subject = uniqueSub();
    await prisma.authIdentity.create({ data: { userId: staff.userId, provider: "GOOGLE", subject, email: staff.email } });
    const res = await googleSignIn(request.agent(app), { email: staff.email, subject });
    expect(res.status).toBe(403);
  });
});

describe("account state", () => {
  it("refuses a deactivated patient", async () => {
    const email = uniqueEmail("g-off");
    const subject = uniqueSub();
    const created = await googleSignIn(request.agent(app), { email, subject });
    await prisma.user.update({ where: { id: created.body.user.id }, data: { isActive: false } });
    expect((await googleSignIn(request.agent(app), { email, subject })).status).toBe(401);
  });
});

describe("unlinking", () => {
  it("needs the password, and refuses when there's no password to fall back on", async () => {
    const googleOnly = request.agent(app);
    await googleSignIn(googleOnly, { email: uniqueEmail("g-only"), subject: uniqueSub() });
    const blocked = await googleOnly.delete("/api/v1/auth/google").send({ password: PASSWORD });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("PASSWORD_REQUIRED");

    const patient = await registerPatient("g-unlink");
    const subject = uniqueSub();
    const first = await googleSignIn(patient.agent, { email: patient.email, subject });
    await patient.agent.post("/api/v1/auth/google/link").send({ linkToken: first.body.linkToken, password: PASSWORD });
    expect((await patient.agent.get("/api/v1/auth/google/status")).body).toMatchObject({ linked: true, hasPassword: true });

    expect((await patient.agent.delete("/api/v1/auth/google").send({ password: "Wrong!Passw0rd1" })).status).toBe(401);
    expect((await patient.agent.delete("/api/v1/auth/google").send({ password: PASSWORD })).status).toBe(200);
    expect(await prisma.authIdentity.count({ where: { userId: patient.userId } })).toBe(0);
  });
});
