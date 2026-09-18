/**
 * Terra and ROOK wearable webhooks (mounted unauthenticated at /webhooks/*
 * — see routes/webhooks.ts's comment on why the old unauthenticated
 * Paystack webhook was removed entirely rather than just renamed). HMAC
 * signature verification is the only thing standing between "any POST
 * request on the internet" and writing biometric data / device-connection
 * state for a real patient, so this is worth pinning precisely: wrong
 * signature, missing signature, and missing secret all need to fail
 * closed, and a genuinely valid signature needs to still work.
 *
 * Signature enforcement is forced on here via *_WEBHOOK_SIGNATURE_REQUIRED
 * regardless of NODE_ENV, since these routes only enforce it by default in
 * production and this suite runs with NODE_ENV=test.
 *
 * Replay protection (webhookReplayGuard.ts) needs a real Redis to
 * demonstrate for real — NODE_ENV=test skips index.ts's own Redis startup,
 * so this file initializes it itself in beforeAll/afterAll rather than
 * relying on the app's normal boot path, against the redis: service
 * container ci.yml provisions for this job (REDIS_URL). Every other
 * integration test file deliberately runs with no Redis reachable at all
 * (see rateLimiter.test.ts's comment) — this is the one place that matters
 * enough to set up the real dependency instead of exercising the fail-open
 * path.
 */
import request from "supertest";
import crypto from "crypto";
import { app } from "../index";
import prisma from "../lib/prisma";
import { initializeRedis, closeRedis } from "../services/redis";

const TERRA_SECRET = "test-terra-webhook-secret";
const ROOK_SECRET = "test-rook-webhook-secret";

// Signature tests below don't need Redis at all and must keep passing on a
// machine with no Redis running; only the replay-specific tests are gated
// on this actually having succeeded.
let redisAvailable = false;

beforeAll(async () => {
  process.env.TERRA_WEBHOOK_SECRET = TERRA_SECRET;
  process.env.TERRA_WEBHOOK_SIGNATURE_REQUIRED = "true";
  process.env.ROOK_WEBHOOK_SECRET = ROOK_SECRET;
  process.env.ROOK_WEBHOOK_SIGNATURE_REQUIRED = "true";
  try {
    await initializeRedis();
    redisAvailable = true;
  } catch (err) {
    console.warn(
      "[webhooks.integration.test] Redis unavailable — skipping replay-blocking assertions (they need REDIS_URL/a running redis-server; see ci.yml's redis: service for CI):",
      (err as Error).message
    );
  }
});

afterAll(async () => {
  if (redisAvailable) await closeRedis();
});

// Jest registers every `it(...)` synchronously at file-load time, before
// beforeAll has run, so redisAvailable can't gate which tests are
// registered — each Redis-dependent test instead checks it at the top and
// no-ops (passes trivially, with a warning) when Redis wasn't reachable.
function skipIfNoRedis(): boolean {
  if (!redisAvailable) {
    console.warn("[webhooks.integration.test] Skipping: Redis not available in this run");
  }
  return !redisAvailable;
}

function terraSignature(body: object): string {
  return crypto.createHmac("sha256", TERRA_SECRET).update(JSON.stringify(body)).digest("hex");
}

function rookSignature(body: object): string {
  return crypto.createHmac("sha256", ROOK_SECRET).update(JSON.stringify(body)).digest("hex");
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function registerPatient(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: "Str0ng!Passw0rd",
    firstName: label,
    lastName: "Patient",
    role: "PATIENT",
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

describe("webhooks/terra: signature verification", () => {
  it("rejects a request with no signature header at all", async () => {
    const res = await request(app).post("/webhooks/terra").send({ type: "auth" });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong/forged signature", async () => {
    const body = { type: "auth" };
    const res = await request(app)
      .post("/webhooks/terra")
      .set("terra-signature", "0".repeat(64))
      .send(body);
    expect(res.status).toBe(401);
  });

  it("rejects a request signed for a different payload than the one sent (tamper detection)", async () => {
    const signedForThis = terraSignature({ type: "auth" });
    const res = await request(app)
      .post("/webhooks/terra")
      .set("terra-signature", signedForThis)
      .send({ type: "deauth" }); // body was swapped after signing
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed payload", async () => {
    const body = { type: "deauth", user: { user_id: "terra-user-does-not-exist" } };
    const res = await request(app)
      .post("/webhooks/terra")
      .set("terra-signature", terraSignature(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("fails closed (503) when the webhook secret itself is not configured", async () => {
    const original = process.env.TERRA_WEBHOOK_SECRET;
    delete process.env.TERRA_WEBHOOK_SECRET;
    try {
      const res = await request(app)
        .post("/webhooks/terra")
        .set("terra-signature", "anything")
        .send({ type: "auth" });
      expect(res.status).toBe(503);
    } finally {
      process.env.TERRA_WEBHOOK_SECRET = original;
    }
  });

  it("blocks a replay: the same signed payload POSTed twice is only processed once", async () => {
    if (skipIfNoRedis()) return;
    // The replay dedup key lives in Redis for WEBHOOK_REPLAY_TTL_SECONDS
    // (default 300s) — a fixed literal body here would collide with a
    // leftover key from a prior run within that window against a
    // persistent (non-ephemeral) Redis, exactly like the unique-constraint
    // literals elsewhere in this file get a per-run suffix.
    const body = { type: "deauth", user: { user_id: `terra-replay-test-user-${Date.now()}` } };
    const signature = terraSignature(body);

    const first = await request(app).post("/webhooks/terra").set("terra-signature", signature).send(body);
    const second = await request(app).post("/webhooks/terra").set("terra-signature", signature).send(body);

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeFalsy();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });

  it("does not block two different payloads that happen to share nothing but being valid", async () => {
    if (skipIfNoRedis()) return;
    const suffix = Date.now();
    const bodyA = { type: "deauth", user: { user_id: `terra-replay-distinct-a-${suffix}` } };
    const bodyB = { type: "deauth", user: { user_id: `terra-replay-distinct-b-${suffix}` } };

    const resA = await request(app).post("/webhooks/terra").set("terra-signature", terraSignature(bodyA)).send(bodyA);
    const resB = await request(app).post("/webhooks/terra").set("terra-signature", terraSignature(bodyB)).send(bodyB);

    expect(resA.body.duplicate).toBeFalsy();
    expect(resB.body.duplicate).toBeFalsy();
  });
});

describe("webhooks/terra: auth event connects a device to the referenced user", () => {
  it("sets terraUserId and appends the provider on a valid auth event", async () => {
    const patient = await registerPatient("terra-auth-event");
    // terraUserId has a unique constraint — a fixed literal would collide
    // with a leftover row from a prior run against a persistent (non-
    // ephemeral) test database.
    const terraUserId = `terra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      type: "auth",
      user: { user_id: terraUserId, reference_id: patient.userId, provider: "GARMIN" },
    };

    const res = await request(app).post("/webhooks/terra").set("terra-signature", terraSignature(body)).send(body);
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { id: patient.userId } });
    expect((updated as any).terraUserId).toBe(terraUserId);
    expect((updated as any).connectedDevices).toContain("GARMIN");
  });

  it("does nothing (no error) when reference_id doesn't match any user", async () => {
    const body = {
      type: "auth",
      user: { user_id: "terra-orphan", reference_id: "does-not-exist", provider: "FITBIT" },
    };
    const res = await request(app).post("/webhooks/terra").set("terra-signature", terraSignature(body)).send(body);
    expect(res.status).toBe(200);
  });
});

describe("webhooks/rook: signature verification", () => {
  it("rejects a request with no signature header at all", async () => {
    const res = await request(app).post("/webhooks/rook").send({ category: "physical", user_id: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong/forged signature", async () => {
    const res = await request(app)
      .post("/webhooks/rook")
      .set("x-rook-hash", "0".repeat(64))
      .send({ category: "physical", user_id: "x" });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed payload via the X-ROOK-HASH header (hex digest)", async () => {
    const body = { category: "physical", user_id: "rook-user-does-not-exist" };
    const res = await request(app)
      .post("/webhooks/rook")
      .set("x-rook-hash", rookSignature(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("also accepts the legacy rook-signature header", async () => {
    const body = { category: "physical", user_id: "rook-user-legacy-header" };
    const res = await request(app)
      .post("/webhooks/rook")
      .set("rook-signature", rookSignature(body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it("accepts a base64-encoded signature as well as hex", async () => {
    const body = { category: "physical", user_id: "rook-user-base64" };
    const b64Signature = crypto.createHmac("sha256", ROOK_SECRET).update(JSON.stringify(body)).digest("base64");
    const res = await request(app)
      .post("/webhooks/rook")
      .set("x-rook-hash", b64Signature)
      .send(body);
    expect(res.status).toBe(200);
  });

  it("fails closed (503) when no ROOK secret is configured at all", async () => {
    const originalWebhookSecret = process.env.ROOK_WEBHOOK_SECRET;
    delete process.env.ROOK_WEBHOOK_SECRET;
    try {
      const res = await request(app)
        .post("/webhooks/rook")
        .set("x-rook-hash", "anything")
        .send({ category: "physical", user_id: "x" });
      expect(res.status).toBe(503);
    } finally {
      process.env.ROOK_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });
});

describe("webhooks/rook: links rookUserId to an existing platform user", () => {
  it("sets rookUserId on the matching user when a webhook references their platform id", async () => {
    const patient = await registerPatient("rook-link-event");
    const body = { category: "physical", user_id: patient.userId };

    const res = await request(app).post("/webhooks/rook").set("x-rook-hash", rookSignature(body)).send(body);
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { id: patient.userId } });
    expect((updated as any).rookUserId).toBe(patient.userId);
  });

  it("blocks a replay: the same signed ROOK payload POSTed twice is only processed once", async () => {
    if (skipIfNoRedis()) return;
    const patient = await registerPatient("rook-replay-event");
    const body = { category: "physical", user_id: patient.userId };
    const signature = rookSignature(body);

    const first = await request(app).post("/webhooks/rook").set("x-rook-hash", signature).send(body);
    const second = await request(app).post("/webhooks/rook").set("x-rook-hash", signature).send(body);

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeFalsy();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });
});

describe("webhooks: no auth cookie required (unauthenticated by design)", () => {
  it("terra webhook succeeds on signature alone, with no session cookie sent", async () => {
    const body = { type: "deauth", user: { user_id: "no-cookie-needed" } };
    const res = await request(app).post("/webhooks/terra").set("terra-signature", terraSignature(body)).send(body);
    expect(res.status).toBe(200);
  });
});
