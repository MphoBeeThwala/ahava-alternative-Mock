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
import { processAiTriageJob, reanalysisDelaysMs, isUnavailableResult, prolongedOutageAttempts } from "./aiTriageJob";
import { sweepUnanalysedTriageCases } from "../services/aiTriageSweep";

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

describe("a re-analysis queued without the original vitals (holdUrgency)", () => {
  it("adds the AI's diagnosis but never makes the case less urgent than it was held at", async () => {
    const c = await newCase("Painful loss of vision in the right eye");
    await prisma.triageCase.update({ where: { id: c.caseId }, data: { aiTriageLevel: 2 } });
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue({ ...recovered, triageLevel: 4 });
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 1, holdUrgency: true });

    const saved = await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } });
    expect(saved.aiModel).toBe("claude-opus-5-5");
    expect(saved.aiTriageLevel).toBe(2);
  });

  it("still lets a normal re-analysis lower the level, as before", async () => {
    const c = await newCase("tired");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue({ ...recovered, triageLevel: 4 });

    await processAiTriageJob({ ...c, retryAttempt: 1 });

    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } })).aiTriageLevel).toBe(4);
  });
});

describe("sweep for cases the AI never analysed (lost or exhausted retry chain)", () => {
  async function unanalysedCase(idleForMs: number, status: "PENDING_REVIEW" | "ASSIGNED" = "PENDING_REVIEW") {
    const c = await newCase("Headache, fever and drowsiness for five days", status);
    // updatedAt is managed by Prisma; set it directly so the case looks idle.
    await prisma.$executeRaw`UPDATE triage_cases SET "aiModel" = ${aiTriage.AI_UNAVAILABLE_MODEL_LABEL}, "updatedAt" = ${new Date(Date.now() - idleForMs)} WHERE id = ${c.caseId}`;
    return c;
  }
  const hours = (n: number) => n * 3600_000;

  it("re-queues an idle case as a held re-analysis, and leaves recent, claimed and analysed cases alone", async () => {
    const idle = await unanalysedCase(hours(4));
    const recent = await unanalysedCase(30 * 60_000);
    const claimed = await unanalysedCase(hours(4), "ASSIGNED");
    const analysed = await newCase("cough");
    const enqueue = jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    const { requeued } = await sweepUnanalysedTriageCases();

    expect(requeued).toContain(idle.caseId);
    expect(requeued).not.toContain(recent.caseId);
    expect(requeued).not.toContain(claimed.caseId);
    expect(requeued).not.toContain(analysed.caseId);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ caseId: idle.caseId, retryAttempt: 1, holdUrgency: true }));
  });

  it("runs the analysis in-process when there is no queue, so the case still gets one", async () => {
    const idle = await unanalysedCase(hours(4));
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(false);
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(recovered);

    await sweepUnanalysedTriageCases();

    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: idle.caseId } })).aiModel).toBe("claude-opus-5-5");
  });

  it("gives up on a case older than a week", async () => {
    const old = await unanalysedCase(hours(4));
    await prisma.$executeRaw`UPDATE triage_cases SET "createdAt" = ${new Date(Date.now() - hours(24 * 8))} WHERE id = ${old.caseId}`;
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    expect((await sweepUnanalysedTriageCases()).requeued).not.toContain(old.caseId);
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

describe("a case that stays without an AI analysis (a prolonged outage)", () => {
  const original = process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS; else process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = original;
  });

  it("is raised to SATS 2 after the second failed re-analysis, flagged, and the reason is on the case", async () => {
    const c = await newCase("Painful loss of vision in the right eye");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(unavailable);
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 2 });

    const saved = await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } });
    expect(saved.aiTriageLevel).toBe(2);
    expect(saved.aiReasoning).toMatch(/raised to SATS 2/);
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: c.caseId, action: "AI_TRIAGE_DECISION" } });
    expect(JSON.stringify(audit?.metadata)).toContain("AI_UNAVAILABLE_PROLONGED");
  });

  it("does not touch the shared analyser result, and leaves earlier attempts at the hold level", async () => {
    const c = await newCase("tired");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(unavailable);
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 1 });
    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } })).aiTriageLevel).toBe(3);

    await processAiTriageJob({ ...c, retryAttempt: 2 });
    expect(unavailable.triageLevel).toBe(3);
    expect(unavailable.uncertaintyFlags).not.toContain("AI_UNAVAILABLE_PROLONGED");
    expect(unavailable.reasoning).not.toMatch(/raised to SATS 2/);
  });

  it("can be switched off", async () => {
    process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = "0";
    const c = await newCase("tired");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue(unavailable);
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 3 });

    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } })).aiTriageLevel).toBe(3);
  });

  it("never changes a real AI answer: when the AI recovers on a late attempt, its level stands", async () => {
    const c = await newCase("tired");
    jest.spyOn(aiTriage, "analyzeSymptoms").mockResolvedValue({ ...recovered, triageLevel: 4 });
    jest.spyOn(queue, "addAiTriageJob").mockResolvedValue(true);

    await processAiTriageJob({ ...c, retryAttempt: 3 });

    const saved = await prisma.triageCase.findUniqueOrThrow({ where: { id: c.caseId } });
    expect(saved.aiTriageLevel).toBe(4);
    expect(saved.aiModel).toBe("claude-opus-5-5");
  });

  it("reads its setting safely: default 2, 0 means off, rubbish means the default", () => {
    delete process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS;
    expect(prolongedOutageAttempts()).toBe(2);
    process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = "0";
    expect(prolongedOutageAttempts()).toBe(0);
    process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = "5";
    expect(prolongedOutageAttempts()).toBe(5);
    process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = "soon";
    expect(prolongedOutageAttempts()).toBe(2);
    process.env.AI_UNAVAILABLE_ESCALATE_AFTER_ATTEMPTS = "-1";
    expect(prolongedOutageAttempts()).toBe(2);
  });
});
