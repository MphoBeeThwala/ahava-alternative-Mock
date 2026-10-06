/**
 * The background AI-triage job: what happens to a case when the AI is
 * unavailable, when it recovers, and when a doctor has already picked the
 * case up. Real database; the AI layer and the queue are stubbed.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import * as aiTriage from "../services/aiTriage";
import * as queue from "../services/queue";
import { processAiTriageJob, reanalysisDelaysMs, isUnavailableResult } from "./aiTriageJob";

const PASSWORD = "Str0ng!Passw0rd";

async function newCase(symptoms: string, status: "PENDING_REVIEW" | "ASSIGNED" = "PENDING_REVIEW") {
  const email = `job-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/v1/auth/register").send({ email, password: PASSWORD, firstName: "Job", lastName: "Patient", role: "PATIENT" });
  expect(res.status).toBe(201);
  const patientId = res.body.user.id as string;
  const created = await prisma.triageCase.create({
    data: {
      patientId, symptoms, status,
      aiTriageLevel: 3, aiRecommendedAction: "interim", aiPossibleConditions: [], aiReasoning: "interim",
      slaDeadline: new Date(Date.now() + 3600_000), doctorFeeCents: 0, aiContextUsed: false, statPearlsUsed: false,
      createdAt: new Date(Date.now() - 30 * 60_000), // submitted half an hour ago
    },
  });
  return { caseId: created.id, patientId, symptoms };
}

const unavailable: aiTriage.TriageResult = {
  triageLevel: 3,
  possibleConditions: ["AI analysis unavailable: no provisional diagnosis was generated"],
  recommendedAction: "A doctor must read the full history.",
  reasoning: "AI analysis was unavailable.",
  confidence: 0,
  uncertaintyFlags: ["AI_ANALYSIS_UNAVAILABLE", "AI_PROVIDER_FAILURE", "FALLBACK_USED"],
  evidenceSources: ["Local Clinical Rules"],
  requiresDoctorReview: true,
  modelUsed: aiTriage.AI_UNAVAILABLE_MODEL_LABEL,
  providerFailures: [{ provider: "claude", model: "claude-opus-5-5", kind: "timeout", message: "timed out after 90000ms" }],
};
const recovered: aiTriage.TriageResult = {
  triageLevel: 2,
  possibleConditions: ["Multiple sclerosis (first demyelinating attack)"],
  recommendedAction: "Urgent neurology review.",
  reasoning: "Optic neuritis with periventricular lesions.",
  confidence: 0.8,
  uncertaintyFlags: [],
  evidenceSources: ["Patient Symptoms"],
  requiresDoctorReview: true,
  modelUsed: "claude-opus-5-5",
};

afterEach(() => jest.restoreAllMocks());

describe("when the AI is unavailable", () => {
  it("saves the honest result, audits why, and queues an automatic re-analysis", async () => {
    const c = await newCase("Painful loss of vision in the right eye");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(unavailable);
    const enqueue = jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob(c);

    const saved = await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } });
    expect(saved.aiModel).toMatch(/^no-ai-analysis/);
    expect(saved.aiPossibleConditions).toEqual(["AI analysis unavailable: no provisional diagnosis was generated"]);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ caseId: c.caseId, retryAttempt: 1 }), { delayMs: reanalysisDelaysMs()[0] });

    const audit = await prisma.auditLog.findFirst({ where: { resourceId: c.caseId, action: "AI_TRIAGE_DECISION" } });
    expect(JSON.stringify(audit?.metadata)).toContain("aiAnalysisUnavailable");
    expect(JSON.stringify(audit?.metadata)).toContain("timed out after 90000ms");
  });

  it("stops retrying after the last delay, and says so", async () => {
    const c = await newCase("tired");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(unavailable);
    const enqueue = jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});

    await processAiTriageJob({ ...c, retryAttempt: reanalysisDelaysMs().length });

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("when the AI recovers on a re-analysis", () => {
  it("updates the case with the real analysis and keeps the original SLA clock", async () => {
    const c = await newCase("Painful loss of vision in the right eye");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(recovered);
    const enqueue = jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 1 });

    const saved = await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } });
    expect(saved.aiModel).toBe("claude-opus-5-5");
    expect((saved.aiPossibleConditions as string[])[0]).toMatch(/multiple sclerosis/i);
    expect(saved.aiTriageLevel).toBe(2);
    // Level 2 is 15 minutes from SUBMISSION (30 minutes ago), not from now.
    expect(saved.slaDeadline!.getTime()).toBeLessThan(Date.now());
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never overwrites a case a doctor has already picked up", async () => {
    const c = await newCase("Painful loss of vision in the right eye", "ASSIGNED");
    const analyze = jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(recovered);

    await processAiTriageJob({ ...c, retryAttempt: 1 });

    expect(analyze).not.toHaveBeenCalled();
    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } })).aiRecommendedAction).toBe("interim");
  });
});

describe("retry schedule", () => {
  const original = process.env.AI_REANALYSIS_DELAYS_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_REANALYSIS_DELAYS_MS; else process.env.AI_REANALYSIS_DELAYS_MS = original;
  });

  it("defaults to 2 min, 10 min, 30 min, 2 h and can be overridden", () => {
    delete process.env.AI_REANALYSIS_DELAYS_MS;
    expect(reanalysisDelaysMs()).toEqual([120_000, 600_000, 1_800_000, 7_200_000]);
    process.env.AI_REANALYSIS_DELAYS_MS = "1000, 2000";
    expect(reanalysisDelaysMs()).toEqual([1000, 2000]);
  });

  it("recognises an unavailable result by its flag, not its text", () => {
    expect(isUnavailableResult(unavailable)).toBe(true);
    expect(isUnavailableResult(recovered)).toBe(false);
  });
});
