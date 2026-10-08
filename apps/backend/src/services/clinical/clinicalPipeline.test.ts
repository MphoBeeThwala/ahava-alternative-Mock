import { validateClinicalPlan, extractCaseQuestions, stripDoses, deriveLegacyFields, type ClinicalPlan } from './clinicalPlan';
import { prepareClinicalContext, assessPlan, buildRecord } from './clinicalPipeline';
import { requiredElementsForCase } from './completenessLinter';
import { selectTestLimitations, doseReference, referenceVersions } from './referenceData';
import { cd4FromText, hivFromText } from './findingsFromInputs';
import { buildPlanPromptSections, buildRepairPrompt } from './planPrompt';
import { HIV_CASE_TEXT, HIV_CASE_FINDINGS, weakPlan, goodPlan } from './testFixtures';

const ctx = () => prepareClinicalContext({ caseText: HIV_CASE_TEXT, structured: HIV_CASE_FINDINGS });

describe('plan validation', () => {
  it('accepts the good plan with no issues', () => {
    const v = validateClinicalPlan(goodPlan(), extractCaseQuestions(HIV_CASE_TEXT));
    expect(v.issues).toEqual([]);
    expect(v.plan?.leadingDiagnosis.probability).toBe(0.9);
  });

  it('lists exactly what is missing so the re-prompt can be targeted', () => {
    const bad = goodPlan() as Record<string, any>;
    delete bad.investigations.definitive;
    bad.existingTreatmentDecisions = [{ treatment: 'RHZE', decision: 'maybe', reason: '' }];
    bad.questionAnswers = [bad.questionAnswers[0]];
    bad.differential[0].evidenceAgainst = [];
    const v = validateClinicalPlan(bad, extractCaseQuestions(HIV_CASE_TEXT));
    expect(v.issues.join('\n')).toMatch(/investigations\.definitive/);
    expect(v.issues.join('\n')).toMatch(/existingTreatmentDecisions\[0\] needs treatment, decision \(continue \| stop \| modify\)/);
    expect(v.issues.join('\n')).toMatch(/Unanswered: "When should ART be started\?"/);
    expect(v.issues.join('\n')).toMatch(/evidenceAgainst/);
  });

  it('returns no plan (so the legacy path applies) for the older flat answer', () => {
    const v = validateClinicalPlan({ triageLevel: 3, possibleConditions: ['x'], recommendedAction: 'y', reasoning: 'z', confidence: 0.8 });
    expect(v.plan).toBeNull();
  });
});

describe('questions in the case', () => {
  it('extracts every question, in order', () => {
    expect(extractCaseQuestions(HIV_CASE_TEXT)).toEqual(['Should we continue TB treatment?', 'When should ART be started?']);
  });
  it('ignores a case with no questions', () => {
    expect(extractCaseQuestions('Fever for three days. No cough.')).toEqual([]);
  });
});

describe('no model-written doses', () => {
  it.each([
    ['Start amphotericin B 3 mg/kg daily', true],
    ['Give 500 mg orally', true],
    ['Transfuse 2 units of packed cells', true],
    ['Hb 6.8 g/dL and glucose 5.2 mmol/L', false],
    ['Albumin 28 g/L, CRP 3 mg/L, ferritin 18000 ng/mL', false],
  ])('%s', (text, stripped) => {
    expect(stripDoses(text).removed > 0).toBe(stripped);
  });

  it('is applied across the whole plan and reported to the reviewer', () => {
    const plan = validateClinicalPlan(weakPlan()).plan as ClinicalPlan;
    const a = assessPlan(plan, [], ctx(), HIV_CASE_TEXT);
    expect(JSON.stringify(a.plan)).not.toMatch(/3 mg\/kg/);
    expect(a.dosesRemoved).toBe(1);
    const rec = buildRecord(a, ctx(), { schemaIssuesRemaining: [], repairRounds: 0 });
    expect(rec.reviewerFlags.map((f) => f.code)).toContain('DOSE_REMOVED');
  });

  it('shows only a guideline pointer while the dose table is empty', () => {
    const d = doseReference('amphotericin b');
    expect(d.cited).toBe(false);
    expect(d.text).not.toMatch(/\d\s?mg/);
    expect(referenceVersions().doseTable.entries).toBe(0);
  });
});

describe('the motivating case: weak plan versus good plan', () => {
  it('flags every failure of the original output', () => {
    const plan = validateClinicalPlan(weakPlan()).plan as ClinicalPlan;
    const a = assessPlan(plan, [], ctx(), HIV_CASE_TEXT);
    const ids = a.lint.map((l) => l.elementId);
    expect(ids).toEqual(expect.arrayContaining([
      'art_timing', 'cotrimoxazole', // CD4 < 200 (TB, CrAg and LAM are all mentioned)
      'tb_treatment_decision',                    // already on TB treatment
      'bone_marrow', 'haematology_referral',      // HLH
      'ampho_renal', 'ampho_electrolytes',        // amphotericin (formulation is named)
      'glucose_check', 'sodium_check',           // confusion
      'cortisol',                                // hypotension + hyponatraemia
    ]));
    expect(a.blocked.map((b) => b.term)).toEqual(['septic shock']); // MAP 71, no lactate, no pressors
    expect(a.calibration.diagnostic.value).toBe(0.55); // 0.92 -> capped: unconfirmed, 2 plausible alternatives
    expect(a.repairIssues.length).toBeGreaterThan(8);
  });

  it('passes the good plan with nothing missing and no blocked terms', () => {
    const v = validateClinicalPlan(goodPlan(), ctx().questions);
    const a = assessPlan(v.plan as ClinicalPlan, v.issues, ctx(), HIV_CASE_TEXT);
    expect(a.lint).toEqual([]);
    expect(a.blocked).toEqual([]);
    expect(a.repairIssues).toEqual([]);
    expect(a.calibration.diagnostic.value).toBeLessThanOrEqual(0.7);
  });

  it('tells the model what is required BEFORE it writes', () => {
    const required = ctx().required.map((r) => r.elementId);
    expect(required).toEqual(expect.arrayContaining(['art_timing', 'cotrimoxazole', 'tb_treatment_decision', 'bone_marrow', 'lp_consideration', 'cortisol']));
    const sections = buildPlanPromptSections({ checks: ctx().checks, limitations: ctx().limitations, questions: ctx().questions, required: ctx().required });
    expect(sections).toMatch(/Sepsis-3 septic shock: NOT ASSESSABLE/);
    expect(sections).toMatch(/Xpert MTB\/RIF[^\n]*negative result does not exclude TB|A single negative result does not exclude TB/);
    expect(sections).toMatch(/1\. Should we continue TB treatment\?/);
    expect(sections).toMatch(/NEVER write a drug dose/);
  });

  it('builds a repair prompt that quotes the previous answer and the problems', () => {
    const p = buildRepairPrompt({ originalPrompt: 'ORIGINAL', previousAnswer: '{"x":1}', issues: ['Missing (A): b.'] });
    expect(p).toMatch(/ORIGINAL[\s\S]*PREVIOUS ANSWER[\s\S]*\{"x":1\}[\s\S]*1\. Missing \(A\): b\./);
  });
});

describe('the patient-visible legacy text carries no treatment detail', () => {
  it('derives recommendedAction without drug names, tests or decisions', () => {
    const plan = validateClinicalPlan(goodPlan()).plan as ClinicalPlan;
    const d = deriveLegacyFields(plan);
    expect(d.recommendedAction).not.toMatch(/amphotericin|RHZE|continue|stop|cortisol|hydrocortisone/i);
    expect(d.recommendedAction).toMatch(/doctor will review/i);
    expect(d.possibleConditions[0]).toMatch(/histoplasmosis/);
  });
});

describe('test limitations', () => {
  it('injects entries for tests the case mentions and for the CD4 band', () => {
    const ids = selectTestLimitations(HIV_CASE_TEXT, 9).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['xpert_advanced_hiv', 'lam_advanced_hiv', 'empirical_tb_treatment_yield', 'crag_serum']));
  });
  it('injects nothing irrelevant for an unrelated case', () => {
    expect(selectTestLimitations('Sore throat for two days', null)).toEqual([]);
  });
});

describe('text hints are literal and ambiguity-safe', () => {
  it('reads one clear CD4 value and refuses conflicting ones', () => {
    expect(cd4FromText('advanced HIV, CD4 9, on treatment')).toBe(9);
    expect(cd4FromText('CD4 count: 188 cells/uL')).toBe(188);
    expect(cd4FromText('CD4 350 last year, CD4 9 now')).toBeNull();
    expect(cd4FromText('CD4 22%')).toBeNull();
    expect(cd4FromText('no CD4 available')).toBeNull();
  });
  it('reads explicit HIV status only', () => {
    expect(hivFromText('HIV negative on testing')).toBe(false);
    expect(hivFromText('known HIV positive, defaulted ART')).toBe(true);
    expect(hivFromText('fever and cough')).toBeNull();
  });
  it('fires CD4 rules on a free-text case and flags that the value came from text', () => {
    const c = prepareClinicalContext({ caseText: HIV_CASE_TEXT });
    expect(c.findings.cd4Cells).toBe(9);
    expect(c.cd4FromTextUsed).toBe(true);
    expect(requiredElementsForCase(c.lintCtx).some((r) => r.elementId === 'art_timing')).toBe(true);
    expect(c.checks.septicShock.status).toBe('not_assessable');
  });
});
