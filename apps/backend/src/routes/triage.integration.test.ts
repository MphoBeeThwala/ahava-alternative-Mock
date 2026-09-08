/**
 * AH-07 / AH-32: submits a real triage case end to end against a real
 * database, with no REDIS_URL and no AI provider keys configured in this
 * test environment — which is exactly what exercises AH-32's synchronous
 * fallback path (addAiTriageJob returns false, so routes/triage.ts calls
 * processAiTriageJob inline) and analyzeSymptoms' own conservative fallback
 * (services/aiTriage.ts, used when no provider is configured). This is the
 * one thing a unit test couldn't show: that the whole chain — interim
 * deterministic-floor case creation, the inline fallback, analyzeSymptoms,
 * and the final DB update — actually composes correctly end to end.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

async function registerAndConsentPatient(agent: ReturnType<typeof request.agent>) {
  const email = uniqueEmail("triage-patient");
  const registerRes = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: "Triage",
    lastName: "Patient",
    role: "PATIENT",
  });
  expect(registerRes.status).toBe(201);

  const consentRes = await agent
    .post("/api/v1/consent")
    .send({ consentType: "AI_TRIAGE", version: "1.0" });
  expect(consentRes.status).toBe(201);

  return email;
}

describe("triage submission (AH-32 end to end, no queue/AI provider configured)", () => {
  it("creates a case immediately and completes AI analysis via the inline fallback", async () => {
    const agent = request.agent(app);
    await registerAndConsentPatient(agent);

    const res = await agent.post("/api/v1/triage").send({
      symptoms: "mild sore throat for two days, no fever",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.triageCaseId).toBeDefined();
    // Never leaks the AI's actual assessment to the patient response —
    // see routes/triage.ts's own comment on this.
    expect(res.body.aiTriageLevel).toBeUndefined();
    expect(res.body.possibleConditions).toBeUndefined();

    // By the time the response returns, processAiTriageJob has already run
    // inline (no queue configured) — the case should be fully analyzed,
    // not left showing the interim placeholder.
    const persisted = await prisma.triageCase.findUnique({
      where: { id: res.body.triageCaseId },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.aiRecommendedAction).not.toMatch(/analysis is in progress/i);
    expect(persisted!.aiModel).toBeDefined();
    expect(persisted!.aiTriageLevel).toBeGreaterThanOrEqual(1);
    expect(persisted!.aiTriageLevel).toBeLessThanOrEqual(5);
  });

  it("escalates a red-flag symptom to level 1 even with no AI provider configured", async () => {
    // Exercises assessDeterministicRisk end to end: with no provider keys
    // set, analyzeSymptoms' conservativeFallback still runs mergeGuardrails,
    // which takes min(fallbackLevel, deterministicFloor) — a real red flag
    // must still land at level 1 through the whole real chain, not just in
    // triageSafety.test.ts's unit tests.
    const agent = request.agent(app);
    await registerAndConsentPatient(agent);

    const res = await agent.post("/api/v1/triage").send({
      symptoms: "he is unconscious and not breathing",
    });

    expect(res.status).toBe(200);
    const persisted = await prisma.triageCase.findUnique({
      where: { id: res.body.triageCaseId },
    });
    expect(persisted!.aiTriageLevel).toBe(1);
  });

  it("rejects submission without AI_TRIAGE consent", async () => {
    const agent = request.agent(app);
    const email = uniqueEmail("no-consent");
    await agent.post("/api/v1/auth/register").send({
      email,
      password: STRONG_PASSWORD,
      firstName: "No",
      lastName: "Consent",
      role: "PATIENT",
    });

    const res = await agent.post("/api/v1/triage").send({
      symptoms: "headache",
    });

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated submission", async () => {
    const res = await request(app).post("/api/v1/triage").send({
      symptoms: "headache",
    });

    expect(res.status).toBe(401);
  });
});
