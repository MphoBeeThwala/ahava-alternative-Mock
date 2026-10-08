import {
  computeMap, computeQSofa, evaluateSepticShock, computeCorrectedSodium, computeEgfr, evaluateHlh2004,
  computeHScore, computeCd4Triggers, evaluateClinicalChecks, findBlockedTerms, renderChecksForPrompt,
  type ClinicalFindings,
} from './clinicalChecks';
import { findingsFromLabs, findingsFromVitals, mergeFindings } from './findingsFromInputs';

// The motivating case: advanced HIV, CD4 9, disseminated fungal infection with
// secondary HLH. MAP ~71, no lactate, no pressors.
const hivCase: ClinicalFindings = {
  ageYears: 38, sex: 'F', sbp: 95, dbp: 59, hr: 118, rr: 24, tempC: 38.9, hivPositive: true, cd4Cells: 9,
  alteredMentation: true, haemoglobinGdl: 6.8, plateletsX10e9: 42, neutrophilsX10e9: 0.9, wbcX10e9: 2.1,
  ferritinUgL: 18000, triglyceridesMmol: 4.6, splenomegaly: true, sodiumMmol: 124, glucoseMmol: 5.2, creatinineUmol: 190,
};

describe('MAP', () => {
  it('computes (SBP + 2 DBP) / 3 and is null when BP is incomplete', () => {
    expect(computeMap(95, 59)).toBe(71);
    expect(computeMap(120, 80)).toBe(93.3);
    expect(computeMap(95, null)).toBeNull();
  });
});

describe('Sepsis-3 septic shock', () => {
  it('is NOT ASSESSABLE (not "not met") when lactate and pressor status are unknown, and says MAP is >= 65', () => {
    const r = evaluateSepticShock(hivCase);
    expect(r.status).toBe('not_assessable');
    expect(r.map).toBe(71);
    expect(r.hypotensive).toBe('not_met');
    expect(r.missing).toEqual(['lactate', 'vasopressor requirement']);
    expect(r.reason).toMatch(/Do not label the patient as being in septic shock/);
  });
  it('is not met with an explicit "no pressors" or a lactate <= 2', () => {
    expect(evaluateSepticShock({ ...hivCase, vasopressorsRequired: false }).status).toBe('not_met');
    expect(evaluateSepticShock({ ...hivCase, lactateMmol: 1.6 }).status).toBe('not_met');
  });
  it('is met only with pressors AND lactate > 2', () => {
    expect(evaluateSepticShock({ ...hivCase, vasopressorsRequired: true, lactateMmol: 4.1 }).status).toBe('met');
    expect(evaluateSepticShock({ ...hivCase, vasopressorsRequired: true }).status).toBe('not_assessable');
  });
});

describe('qSOFA', () => {
  it('scores RR >= 22, SBP <= 100, altered mentation', () => {
    const q = computeQSofa(hivCase);
    expect(q.score).toBe(3);
    expect(q.status).toBe('met');
  });
  it('does not call a negative screen when components are unknown', () => {
    expect(computeQSofa({ sbp: 120 }).status).toBe('not_assessable');
    expect(computeQSofa({ sbp: 120, rr: 16, gcs: 15 }).status).toBe('not_met');
  });
});

describe('corrected sodium and eGFR', () => {
  it('corrects sodium for raised glucose only', () => {
    expect(computeCorrectedSodium({ sodiumMmol: 124, glucoseMmol: 5.2 })?.corrected).toBe(124);
    expect(computeCorrectedSodium({ sodiumMmol: 124, glucoseMmol: 28 })?.corrected).toBeGreaterThan(130);
    expect(computeCorrectedSodium({ sodiumMmol: 124 })).toBeNull();
  });
  it('computes CKD-EPI 2021 eGFR and needs age and sex', () => {
    expect(computeEgfr({ creatinineUmol: 190, ageYears: 38, sex: 'F' })).toBeLessThan(45);
    expect(computeEgfr({ creatinineUmol: 190 })).toBeNull();
  });
});

describe('HLH-2004', () => {
  it('counts the criteria that are met and keeps unknown ones separate', () => {
    const r = evaluateHlh2004(hivCase);
    // fever, splenomegaly, cytopenias, TG, ferritin
    expect(r.metCount).toBe(5);
    expect(r.status).toBe('met');
    expect(r.notAssessableCount).toBe(3); // marrow, NK, sCD25
  });
  it('is not assessable when missing inputs could still reach 5', () => {
    const r = evaluateHlh2004({ tempC: 39, ferritinUgL: 3000 });
    expect(r.metCount).toBe(2);
    expect(r.status).toBe('not_assessable');
  });
  it('is not met when even all unknowns cannot reach 5', () => {
    const r = evaluateHlh2004({
      tempC: 37, splenomegaly: false, haemoglobinGdl: 13, plateletsX10e9: 250, neutrophilsX10e9: 4,
      triglyceridesMmol: 1, fibrinogenGL: 3, ferritinUgL: 100,
    });
    expect(r.status).toBe('not_met');
  });
});

describe('HScore', () => {
  it('scores a complete picture exactly', () => {
    const r = computeHScore({ ...hivCase, hepatomegaly: false, fibrinogenGL: 1.2, astUL: 120, marrowHaemophagocytosis: true });
    // HIV 18 + temp 33 + organomegaly 23 + cytopenias 34 + ferritin 50 + TG 64 + fibrinogen 30 + AST 19 + marrow 35
    expect(r.scoreMin).toBe(306);
    expect(r.scoreMax).toBe(306);
    expect(r.status).toBe('met');
  });
  it('reports a range rather than a number when inputs are missing', () => {
    const r = computeHScore(hivCase);
    expect(r.scoreMin).toBeLessThan(r.scoreMax);
    expect(r.missing).toEqual(expect.arrayContaining(['fibrinogen', 'AST', 'bone marrow haemophagocytosis']));
  });
  it('is not met when even the maximum is below 169', () => {
    const r = computeHScore({ tempC: 36.8, splenomegaly: false, hepatomegaly: false, haemoglobinGdl: 13, wbcX10e9: 7, plateletsX10e9: 250, ferritinUgL: 120, triglyceridesMmol: 1, fibrinogenGL: 4, astUL: 20, marrowHaemophagocytosis: false });
    expect(r.scoreMax).toBeLessThan(169);
    expect(r.status).toBe('not_met');
  });
});

describe('CD4 triggers', () => {
  it('fires the advanced-disease package at CD4 9', () => {
    const t = computeCd4Triggers(hivCase)!;
    expect(t).toMatchObject({ advancedHivDisease: true, veryAdvanced: true, profound: true, crAgScreeningIndicated: true, tbLamIndicated: true, cotrimoxazoleProphylaxisIndicated: true });
  });
  it('does nothing at CD4 350 and nothing for a known HIV-negative patient', () => {
    expect(computeCd4Triggers({ cd4Cells: 350, hivPositive: true })?.advancedHivDisease).toBe(false);
    expect(computeCd4Triggers({ cd4Cells: 188, hivPositive: false })).toBeNull();
  });
});

describe('blocked terms', () => {
  const checks = evaluateClinicalChecks(hivCase);
  it('blocks an assertion of septic shock when the criteria are not met', () => {
    const hits = findBlockedTerms('Patient is in septic shock with multi-organ failure.', checks);
    expect(hits).toHaveLength(1);
    expect(hits[0].term).toBe('septic shock');
  });
  it.each([
    'Septic shock criteria are not met (no lactate, no pressors).',
    'There is no septic shock at present.',
    'Escalate if the patient progresses to septic shock.',
    'At risk of septic shock; recheck lactate.',
    'Not in septic shock by Sepsis-3 criteria.',
  ])('allows a non-assertion: %s', (text) => {
    expect(findBlockedTerms(text, checks)).toHaveLength(0);
  });
  it('allows the term once the criteria are genuinely met', () => {
    const met = evaluateClinicalChecks({ ...hivCase, lactateMmol: 5, vasopressorsRequired: true });
    expect(findBlockedTerms('Patient is in septic shock.', met)).toHaveLength(0);
  });
});

describe('inputs from structured values only', () => {
  it('maps pack labs with unit conversion and ignores combined or unknown-unit rows', () => {
    const f = findingsFromLabs([
      { name: 'Haemoglobin', value: 68, unit: 'g/L' },
      { name: 'Platelets', value: 42000, unit: '/uL' },
      { name: 'White cell count', value: 2.1, unit: 'x10^3/uL' },
      { name: 'Glucose', value: 100, unit: 'mg/dL' },
      { name: 'Creatinine', value: 2.1, unit: 'mg/dL' },
      { name: 'Triglycerides', value: 400, unit: 'mg/dL' },
      { name: 'Fibrinogen', value: 120, unit: 'mg/dL' },
      { name: 'Ferritin', value: 18000, unit: 'ng/mL' },
      { name: 'CD4 count', value: 9, unit: 'cells/uL' },
      { name: 'AST / ALT', value: 80, unit: 'U/L' },
      { name: 'Sodium / Potassium / Chloride', value: 124, unit: 'mmol/L' },
      { name: 'Lactate', value: '>10', unit: 'mmol/L' },
    ]);
    expect(f).toMatchObject({ haemoglobinGdl: 6.8, plateletsX10e9: 42, wbcX10e9: 2.1, creatinineUmol: 186, fibrinogenGL: 1.2, ferritinUgL: 18000, cd4Cells: 9 });
    expect(f.glucoseMmol).toBeCloseTo(5.6, 1);
    expect(f.triglyceridesMmol).toBeCloseTo(4.52, 1);
    expect(f.astUL).toBeUndefined();
    expect(f.sodiumMmol).toBeUndefined();
    expect(f.lactateMmol).toBeUndefined();
  });
  it('maps the vitals snapshot and merges, later values winning', () => {
    const v = findingsFromVitals({ bloodPressureSystolic: 95, bloodPressureDiastolic: 59, temperature: 38.9, avpu: 'confused' });
    expect(v).toMatchObject({ sbp: 95, dbp: 59, tempC: 38.9, alteredMentation: true });
    expect(mergeFindings(v, { sbp: 100 }).sbp).toBe(100);
  });
});

describe('prompt rendering', () => {
  it('states what could not be assessed', () => {
    const text = renderChecksForPrompt(evaluateClinicalChecks(hivCase));
    expect(text).toMatch(/Sepsis-3 septic shock: NOT ASSESSABLE/);
    expect(text).toMatch(/HLH-2004: 5\/8 criteria met/);
    expect(text).toMatch(/CD4 9/);
  });
});
