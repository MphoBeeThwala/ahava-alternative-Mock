import fs from 'fs';
import path from 'path';
import { buildCaseInput, packKeyPolicy, plannedRuns, renderReport, scoreSafety, type CaseOutcome, type PackCase } from './diagnosticPack';
import { assessDeterministicRisk } from './triageSafety';
import { checkModel } from './aiProviders';

const PACK = path.join(__dirname, '..', '..', '..', '..', 'docs', 'diagnostic-test-pack', 'ahava-diagnostic-test-cases.json');
const cases = (JSON.parse(fs.readFileSync(PACK, 'utf8')) as { cases: PackCase[] }).cases;
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe('the shipped pack', () => {
  it('has the 20 published cases', () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(20);
  });

  it('never sends the answer key to the engine, at either stage', () => {
    for (const c of cases) {
      for (const stage of [1, 2] as const) {
        const { symptoms } = buildCaseInput(c, stage);
        expect(symptoms).not.toContain(c.answerKey.finalDiagnosis);
        expect(symptoms).not.toContain(c.answerKey.pitfall);
        for (const m of c.answerKey.mustDetect) expect(symptoms).not.toContain(m);
      }
    }
  });

  it('holds back later results at stage 1 and adds them at stage 2', () => {
    const c = byId('AHV-DX-01'); // cryptococcal antigen is withheld until stage 2
    expect(buildCaseInput(c, 1).symptoms).not.toMatch(/Cryptococcal antigen/);
    expect(buildCaseInput(c, 2).symptoms).toMatch(/Cryptococcal antigen[^\n]*positive/);
    expect(buildCaseInput(byId('AHV-DX-13'), 1).symptoms).not.toMatch(/right-sided weakness/);
    expect(buildCaseInput(byId('AHV-DX-13'), 2).symptoms).toMatch(/right-sided weakness/);
  });

  it('passes what the pack reports and nothing it does not (null stays null)', () => {
    const { vitalsSnapshot, patient, symptoms } = buildCaseInput(byId('AHV-DX-05'), 1);
    expect(vitalsSnapshot).toMatchObject({ heartRateResting: 172, respiratoryRate: 43, bloodPressureSystolic: 48, temperature: 34.1, oxygenSaturation: null });
    expect(patient).toEqual({ ageYears: byId('AHV-DX-05').patient.ageYears, heightCm: 68 });
    expect(symptoms).toContain('BP 48/29');
    expect(symptoms).not.toMatch(/SpO2/);
  });

  it('includes the inter-arm / four-limb pressures the pack gives as vitals notes', () => {
    expect(buildCaseInput(byId('AHV-DX-08'), 1).symptoms).toMatch(/R leg 111\/90/);
  });
});

describe('machine scoring', () => {
  const c = byId('AHV-DX-07'); // minimum safe level 1
  it('fails an answer less urgent than the minimum safe level', () => {
    const s = scoreSafety(c, { triageLevel: 2, requiresDoctorReview: true, uncertaintyFlags: [] });
    expect(s).toMatchObject({ urgencyOk: false, underTriageBy: 1, safetyPass: false, aiAnswered: true });
  });
  it('passes an equal or more urgent answer that needs doctor review', () => {
    expect(scoreSafety(c, { triageLevel: 1, requiresDoctorReview: true, uncertaintyFlags: [] }).safetyPass).toBe(true);
  });
  it('fails an urgent answer that does not require doctor review', () => {
    expect(scoreSafety(c, { triageLevel: 1, requiresDoctorReview: false, uncertaintyFlags: [] }).safetyPass).toBe(false);
  });
  it('knows when no AI actually answered', () => {
    expect(scoreSafety(c, { triageLevel: 1, requiresDoctorReview: true, uncertaintyFlags: ['AI_ANALYSIS_UNAVAILABLE'] }).aiAnswered).toBe(false);
  });
  it('treats a deliberately low-acuity case (retinoblastoma) at 2 as safe: more urgent than the minimum', () => {
    expect(scoreSafety(byId('AHV-DX-11'), { triageLevel: 2, requiresDoctorReview: true, uncertaintyFlags: [] }).urgencyOk).toBe(true);
  });
});

describe('the deterministic floor on the pack (what is left when the AI is down)', () => {
  // Pinned so a rules change that makes it WORSE shows up here. Cases the floor
  // alone cannot reach are listed on purpose: they depend on the AI answering.
  const needsAi = ['AHV-DX-03', 'AHV-DX-04', 'AHV-DX-07', 'AHV-DX-08', 'AHV-DX-09', 'AHV-DX-12', 'AHV-DX-13', 'AHV-DX-14', 'AHV-DX-18', 'AHV-DX-20'];
  it('reaches the minimum safe level for exactly the cases it reached when this was written', () => {
    const reached = cases.filter((c) => {
      const i = buildCaseInput(c, 1);
      return assessDeterministicRisk(i.symptoms, i.vitalsSnapshot, i.patient).minTriageLevel <= c.answerKey.minimumAcceptableLevel;
    }).map((c) => c.id);
    expect(cases.map((c) => c.id).filter((id) => !reached.includes(id))).toEqual(needsAi);
  });
});

describe('report', () => {
  const outcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
    id: 'AHV-DX-07', stage: 1, modelUsed: 'claude-opus-5-5', seconds: 41.2, conditions: ['Adrenal crisis'], failures: [],
    machine: scoreSafety(byId('AHV-DX-07'), { triageLevel: 1, requiresDoctorReview: true, uncertaintyFlags: [] }), ...over,
  });
  it('names the under-triaged cases and the unavailable fallback', () => {
    const bad = outcome({ id: 'AHV-DX-13', machine: scoreSafety(byId('AHV-DX-13'), { triageLevel: 3, requiresDoctorReview: true, uncertaintyFlags: ['AI_ANALYSIS_UNAVAILABLE'] }), failures: ['claude/claude-opus-5-5=timeout'] });
    const md = renderReport([outcome(), bad], { generatedAt: 'now', judged: false, mode: 'full engine' });
    expect(md).toMatch(/AI actually answered: \*\*1\/2\*\*/);
    expect(md).toMatch(/Under-triaged: AHV-DX-13 \(got 3, needs 1\)/);
    expect(md).toMatch(/claude\/claude-opus-5-5=timeout/);
  });
});

describe('checkModel', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; delete process.env.ANTHROPIC_API_KEY; });

  it('reports a working model with its latency', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok": true}' }], stop_reason: 'end_turn' }), { status: 200 })) as unknown as typeof fetch;
    const r = await checkModel('claude', 'claude-opus-5-5');
    expect(r).toMatchObject({ ok: true, model: 'claude-opus-5-5' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
  it('reports the failure kind and status, without retrying or falling back', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const f = jest.fn().mockResolvedValue(new Response('{"error":{"type":"not_found_error","message":"model: x"}}', { status: 404 }));
    global.fetch = f as unknown as typeof fetch;
    const r = await checkModel('claude', 'claude-x');
    expect(r).toMatchObject({ ok: false, kind: 'model_not_found', status: 404 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('which API keys a pack run may spend (an early run used up the production credit)', () => {
  const full = { floorOnly: false, smoke: false };

  it('refuses a full run on the loaded production keys by default', () => {
    expect(packKeyPolicy({ ANTHROPIC_API_KEY: 'prod', GEMINI_API_KEY: 'prod' }, full).allowed).toBe(false);
  });

  it('allows a full run on separate test keys, and says it is in test mode', () => {
    expect(packKeyPolicy({ AI_PACK_ANTHROPIC_API_KEY: 'test' }, full)).toEqual({ testMode: true, allowed: true });
    expect(packKeyPolicy({ AI_PACK_GEMINI_API_KEY: 'test' }, full)).toEqual({ testMode: true, allowed: true });
  });

  it('allows spending production credit only when explicitly accepted', () => {
    expect(packKeyPolicy({ AI_PACK_ALLOW_PRODUCTION_KEYS: '1' }, full).allowed).toBe(true);
    expect(packKeyPolicy({ AI_PACK_ALLOW_PRODUCTION_KEYS: 'true' }, full).allowed).toBe(false);
  });

  it('always allows the free and near-free modes', () => {
    expect(packKeyPolicy({}, { floorOnly: true, smoke: false }).allowed).toBe(true);
    expect(packKeyPolicy({}, { floorOnly: false, smoke: true }).allowed).toBe(true);
  });
});

describe('planned runs', () => {
  it('counts one run per case, plus one for each case that has later results when stage 2 is on', () => {
    const withLater = cases.filter((c) => c.input.labs.some((l) => l.withholdUntilStage) || c.input.stages).length;
    expect(plannedRuns(cases, false)).toBe(20);
    expect(plannedRuns(cases, true)).toBe(20 + withLater);
    expect(withLater).toBeGreaterThan(10);
  });
});

describe('a run that stopped early says so at the top of the report', () => {
  it('shows the reason and which judge scored it', () => {
    const md = renderReport([], { generatedAt: 'now', judged: true, mode: 'full engine', judge: 'claude-sonnet-5-5, medium effort', aborted: 'a provider reports no credit left' });
    expect(md).toMatch(/RUN STOPPED EARLY: a provider reports no credit left/);
    expect(md).toMatch(/Judge: claude-sonnet-5-5, medium effort/);
  });
});
