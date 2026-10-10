/**
 * End to end through analyzeSymptoms with a scripted model: the structured
 * plan, the one targeted re-prompt, calibration, the doctor-review guardrail,
 * and the fallbacks. Network and evidence providers are mocked; the rest is real.
 */
jest.mock('./evidenceProvider', () => ({
  combineEvidence: jest.fn().mockResolvedValue({ results: [], sourcesQueried: [], sourcesSucceeded: [] }),
  hasSufficientEvidence: () => true,
  getEvidenceSummary: () => 'none',
}));

import { analyzeSymptoms } from './aiTriage';
import { _resetAiHealthForTests } from './aiHealth';
import { HIV_CASE_TEXT, HIV_CASE_FINDINGS, weakPlan, goodPlan } from './clinical/testFixtures';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;
let fetchMock: FetchMock;
const originalFetch = global.fetch;
const env = { ...process.env };

const claudeResponse = (answer: unknown) =>
  new Response(JSON.stringify({
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn',
  }), { status: 200 });
const promptOf = (i: number): string => JSON.parse(String(fetchMock.mock.calls[i][1]?.body)).messages[0].content[0].text;

beforeEach(() => {
  _resetAiHealthForTests();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.GEMINI_API_KEY;
  process.env.AI_PROVIDER_RETRY_DELAY_MS = '0';
  process.env.AI_PLAN_REPAIR_ROUNDS = '1';
  delete process.env.AI_CLAUDE_MODELS;
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
  jest.restoreAllMocks();
});

const run = () => analyzeSymptoms({ symptoms: HIV_CASE_TEXT, findings: HIV_CASE_FINDINGS, patientId: 'p', caseId: 'c' });

describe('the prompt', () => {
  it('carries the computed checks, test limitations, the questions and the required elements', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodPlan()));
    await run();
    const prompt = promptOf(0);
    expect(prompt).toMatch(/DETERMINISTIC CLINICAL CHECKS/);
    expect(prompt).toMatch(/Sepsis-3 septic shock: NOT ASSESSABLE/);
    expect(prompt).toMatch(/MAP: 71 mmHg/);
    expect(prompt).toMatch(/TEST LIMITATIONS THAT APPLY/);
    expect(prompt).toMatch(/GeneXpert|Xpert MTB\/RIF/);
    expect(prompt).toMatch(/1\. Should we continue TB treatment\?/);
    expect(prompt).toMatch(/THE PLAN MUST ADDRESS/);
    expect(prompt).toMatch(/Southern African HIV Clinicians Society/);
    expect(prompt).toMatch(/NEVER write a drug dose/);
  });
});

describe('a complete plan', () => {
  it('needs no re-prompt, keeps the doctor-review guardrail, and caps diagnostic confidence', async () => {
    fetchMock.mockResolvedValueOnce(claudeResponse(goodPlan()));
    const r = await run();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.requiresDoctorReview).toBe(true);
    expect(r.recommendedAction).toMatch(/^Doctor review required before patient-facing interpretation\./);
    expect(r.confidence).toBeLessThanOrEqual(0.7);
    expect(r.triageConfidence).toBe(0.9);
    expect(r.plan?.repairRounds).toBe(0);
    expect(r.plan?.lintRemaining).toEqual([]);
    expect(r.plan?.audience).toBe('clinician_only');
    expect(r.plan?.plan.existingTreatmentDecisions[0].decision).toBe('continue');
    expect(r.plan?.plan.timingDecisions[0].topic).toMatch(/ART/);
    expect(r.possibleConditions[0]).toMatch(/histoplasmosis/);
  });
});

describe('the weak plan from the original failure', () => {
  it('is re-prompted once with exactly what is missing, and the repaired plan is adopted', async () => {
    fetchMock
      .mockResolvedValueOnce(claudeResponse(weakPlan()))
      .mockResolvedValueOnce(claudeResponse(goodPlan()));
    const r = await run();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repair = promptOf(1);
    expect(repair).toMatch(/PROBLEMS FOUND IN YOUR PREVIOUS ANSWER/);
    expect(repair).toMatch(/ART timing decision/);
    expect(repair).toMatch(/continue \/ stop \/ modify decision for the existing TB treatment/);
    expect(repair).toMatch(/bone marrow/);
    expect(repair).toMatch(/cortisol/);
    expect(repair).toMatch(/Unsupported term "septic shock"/);
    expect(repair).toMatch(/Unanswered: "Should we continue TB treatment\?"/);

    expect(r.plan?.repairRounds).toBe(1);
    expect(r.plan?.lintRemaining).toEqual([]);
    expect(r.plan?.blockedTermsRemaining).toEqual([]);
    expect(r.requiresDoctorReview).toBe(true);
  });

  it('when the repair does not help, keeps the answer and flags every gap for the reviewing doctor', async () => {
    fetchMock
      .mockResolvedValueOnce(claudeResponse(weakPlan()))
      .mockResolvedValueOnce(claudeResponse(weakPlan()));
    const r = await run();

    const codes = r.plan!.reviewerFlags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['COMPLETENESS_GAP', 'UNSUPPORTED_TERM', 'PLAN_SCHEMA_INCOMPLETE', 'DOSE_REMOVED', 'CONFIDENCE_CAPPED']));
    expect(r.uncertaintyFlags).toEqual(expect.arrayContaining(['COMPLETENESS_GAP', 'UNSUPPORTED_TERM']));
    expect(JSON.stringify(r.plan)).not.toMatch(/3 mg\/kg/);
    expect(r.confidence).toBe(0.55); // 0.92 reported by the model, unconfirmed, two plausible alternatives
    expect(r.requiresDoctorReview).toBe(true);
  });

  it('survives a failed repair call and still returns the first answer, flagged', async () => {
    fetchMock
      .mockResolvedValueOnce(claudeResponse(weakPlan()))
      .mockResolvedValue(new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400 }));
    const r = await run();
    expect(r.modelUsed).toMatch(/claude/);
    expect(r.plan?.reviewerFlags.some((f) => f.code === 'COMPLETENESS_GAP')).toBe(true);
  });
});

describe('older flat answers', () => {
  const flat = {
    triageLevel: 2, possibleConditions: ['Disseminated infection'], recommendedAction: 'Admit.',
    reasoning: 'Advanced HIV.', confidence: 0.95, uncertaintyFlags: [], evidenceSources: ['Patient Symptoms'], requiresDoctorReview: true,
  };

  it('are re-prompted for the structured plan and, failing that, accepted with the confidence cap applied', async () => {
    fetchMock.mockResolvedValue(claudeResponse(flat));
    const r = await run();
    expect(r.plan).toBeUndefined();
    expect(r.uncertaintyFlags).toContain('NO_STRUCTURED_PLAN');
    expect(r.confidence).toBe(0.7);
    expect(r.requiresDoctorReview).toBe(true);
  });
});

describe('no model available', () => {
  it('still returns the honest fallback with no plan and no diagnosis', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await run();
    expect(r.plan).toBeUndefined();
    expect(r.confidence).toBe(0);
    expect(r.uncertaintyFlags).toContain('AI_ANALYSIS_UNAVAILABLE');
  });
});
