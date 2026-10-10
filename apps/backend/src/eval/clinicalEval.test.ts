/**
 * CI gate for clinical quality that can run without a model. It scores the
 * recorded outputs under eval/recorded through the SAME post-processing
 * production uses, and fails if a change to the rules, reference data,
 * calibration, validator or scorer makes a complete plan stop passing or a
 * thin plan stop being caught. Live model quality is checked separately
 * (pnpm eval:clinical:live, see eval/README.md).
 */
import { loadCases, loadRecordings, loadThresholds, runOffline, checkExpectation } from './evalFiles';
import { checkThresholds, scoreRawOutput, SECTIONS, renderEvalReport } from './clinicalEval';

describe('eval folder', () => {
  const cases = loadCases();

  it('has the motivating HIV/HLH case as a gold case', () => {
    expect(cases.map((c) => c.id)).toContain('HIV-HLH-001');
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s has rubric items for every section', (_id, c) => {
    for (const s of SECTIONS) expect((c.rubric[s] ?? []).length).toBeGreaterThan(0);
  });

  it('every rubric item id is unique within its case', () => {
    for (const c of cases) {
      const ids = SECTIONS.flatMap((s) => (c.rubric[s] ?? []).map((i) => i.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every rubric regex compiles', () => {
    for (const c of cases) {
      for (const s of SECTIONS) {
        for (const item of c.rubric[s] ?? []) {
          const patterns = 'anyOf' in item ? item.anyOf : 'treatmentPattern' in item ? [item.treatmentPattern] : 'topicPattern' in item ? [item.topicPattern] : [];
          for (const p of patterns) expect(() => new RegExp(p, 'i')).not.toThrow();
        }
      }
    }
  });
});

describe('offline evaluation of recorded outputs', () => {
  const offline = runOffline();

  it('passes: complete plans meet the thresholds and thin plans are caught', () => {
    expect(offline.failures).toEqual([]);
  });

  it('scores the complete HIV/HLH plan at 1.0 in every section', () => {
    const good = offline.results.find((r) => r.caseId === 'HIV-HLH-001' && r.kind === 'good')!;
    for (const s of SECTIONS) expect(good.score.sections[s].score).toBe(1);
  });

  it('reproduces the original failures in the weak recording, section by section', () => {
    const weak = offline.results.find((r) => r.caseId === 'HIV-HLH-001' && r.kind === 'weak')!;
    const missed = (s: typeof SECTIONS[number]) => weak.score.sections[s].items.filter((i) => !i.passed).map((i) => i.id);
    expect(missed('investigations')).toEqual(expect.arrayContaining(['inv_bone_marrow', 'inv_skin', 'inv_urine_histoplasma', 'inv_lp', 'inv_cortisol', 'inv_lactate']));
    expect(missed('management')).toEqual(expect.arrayContaining(['mgmt_tb_decision', 'mgmt_art_timing', 'mgmt_cotrimoxazole', 'mgmt_questions']));
    expect(missed('safety')).toEqual(expect.arrayContaining(['saf_no_septic_shock', 'saf_no_doses', 'saf_complete']));
    // The calibrator catches the model's 0.92 by itself.
    expect(weak.score.sections.calibration.score).toBe(1);
    expect(weak.score.record!.calibration.diagnostic.modelValue).toBe(0.92);
    expect(weak.score.record!.calibration.diagnostic.value).toBeLessThanOrEqual(0.7);
  });
});

describe('the scorer itself', () => {
  const c = loadCases().find((x) => x.id === 'HIV-HLH-001')!;
  const good = loadRecordings('HIV-HLH-001').find((r) => r.recording.kind === 'good')!.recording;

  it('fails every item when the output is not a plan', () => {
    const s = scoreRawOutput(c, { triageLevel: 2, possibleConditions: ['x'] });
    expect(s.parsed).toBe(false);
    expect(s.overall).toBe(0);
    expect(s.sections.safety.score).toBe(0);
  });

  it('drops the investigations score when a required test is removed from a good plan', () => {
    const edited = JSON.parse(JSON.stringify(good.output));
    edited.investigations.definitive = edited.investigations.definitive.filter((t: { test: string }) => !/marrow/i.test(t.test));
    edited.investigations.first24h = edited.investigations.first24h.filter((t: { test: string }) => !/marrow/i.test(t.test));
    const s = scoreRawOutput(c, edited);
    expect(s.sections.investigations.score).toBeLessThan(1);
    expect(s.sections.investigations.items.find((i) => i.id === 'inv_bone_marrow')!.passed).toBe(false);
  });

  it('fails the TB-rule-out check when negative tests are used to exclude TB', () => {
    const edited = JSON.parse(JSON.stringify(good.output));
    edited.severity.summary += ' The negative GeneXpert and LAM rule out TB.';
    const s = scoreRawOutput(c, edited);
    expect(s.sections.management.items.find((i) => i.id === 'mgmt_no_tb_rule_out')!.passed).toBe(false);
  });

  it('does not penalise "does not rule out TB"', () => {
    const s = scoreRawOutput(c, good.output);
    expect(s.sections.management.items.find((i) => i.id === 'mgmt_no_tb_rule_out')!.passed).toBe(true);
  });

  it('fails an unexplained decision to stop TB treatment', () => {
    const edited = JSON.parse(JSON.stringify(good.output));
    edited.existingTreatmentDecisions[0].decision = 'stop';
    const s = scoreRawOutput(c, edited);
    expect(s.sections.management.items.find((i) => i.id === 'mgmt_tb_decision')!.passed).toBe(false);
  });
});

describe('thresholds and regression against a baseline', () => {
  const c = loadCases()[0];
  const good = loadRecordings(c.id).find((r) => r.recording.kind === 'good')!.recording;
  const weak = loadRecordings(c.id).find((r) => r.recording.kind === 'weak')!.recording;
  const t = loadThresholds();

  it('fails a weak output against the section minimums', () => {
    const failures = checkThresholds([scoreRawOutput(c, weak.output)], t);
    expect(failures.join('\n')).toMatch(/investigations .* below the minimum/);
    expect(failures.join('\n')).toMatch(/safety .* below the minimum/);
  });

  it('fails a drop beyond the allowed regression from the baseline', () => {
    const score = scoreRawOutput(c, good.output);
    const baseline = { updatedAt: 'x', cases: { [c.id]: { diagnosis: 1 } } };
    expect(checkThresholds([score], { ...t, minSection: { diagnosis: 0, investigations: 0, management: 0, calibration: 0, safety: 0 } }, baseline)).toEqual([]);
    const worse = JSON.parse(JSON.stringify(good.output));
    worse.leadingDiagnosis.name = 'Community-acquired pneumonia';
    worse.differential = worse.differential.slice(0, 1).map((d: { name: string }) => ({ ...d, name: 'Influenza' }));
    worse.mustNotMiss = [];
    const failures = checkThresholds([scoreRawOutput(c, worse)], { ...t, minSection: { diagnosis: 0, investigations: 0, management: 0, calibration: 0, safety: 0 } }, baseline);
    expect(failures.join('\n')).toMatch(/diagnosis fell from baseline 1/);
  });

  it('checkExpectation reports a guard that stopped catching a weakness', () => {
    const score = scoreRawOutput(c, good.output); // a good plan "expected" to be weak
    expect(checkExpectation(weak, score).join('\n')).toMatch(/expected at most/);
  });

  it('renders a per-section report', () => {
    const score = scoreRawOutput(c, weak.output);
    const md = renderEvalReport([score], { mode: 'offline', generatedAt: 'now', failures: ['x'] });
    expect(md).toMatch(/\| HIV-HLH-001 \|/);
    expect(md).toMatch(/\*\*investigations\*\* missed: .*inv_bone_marrow/);
  });
});
