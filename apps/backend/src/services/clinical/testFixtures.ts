/**
 * Shared fixtures for the clinical-plan tests: the motivating case (advanced
 * HIV, CD4 9, disseminated fungal infection with secondary HLH, failing
 * empirical TB treatment), a WEAK plan that reproduces the original failures,
 * and a GOOD plan that covers them. Not production code.
 */
import type { ClinicalFindings } from './clinicalChecks';

export const HIV_CASE_TEXT =
  '38 year old woman with advanced HIV, CD4 9, on empirical TB treatment (RHZE) for 6 weeks with no improvement. ' +
  'Fever, new confusion, skin papules, pancytopenia, raised creatinine, ferritin 18000. GeneXpert negative, TB-LAM negative. ' +
  'BP 95/59, sodium 124. Transferred for opinion. Should we continue TB treatment? When should ART be started?';

export const HIV_CASE_FINDINGS: ClinicalFindings = {
  ageYears: 38, sex: 'F', sbp: 95, dbp: 59, hr: 118, rr: 24, tempC: 38.9, cd4Cells: 9, hivPositive: true,
  alteredMentation: true, haemoglobinGdl: 6.8, plateletsX10e9: 42, neutrophilsX10e9: 0.9, wbcX10e9: 2.1,
  ferritinUgL: 18000, triglyceridesMmol: 4.6, splenomegaly: true, sodiumMmol: 124, glucoseMmol: 5.2, creatinineUmol: 190,
};

const t = (test: string, rationale = 'needed for diagnosis') => ({ test, rationale });
const a = (action: string, rationale = 'indicated', guidelineSource = 'SA guideline: verify') => ({ action, rationale, guidelineSource });

/** Everything structurally valid, but clinically thin: the failures from the original test case. */
export function weakPlan(): Record<string, unknown> {
  return {
    triageLevel: 1,
    triageConfidence: 0.9,
    severity: { summary: 'Septic shock with multi-organ dysfunction in advanced HIV.', redFlags: ['confusion'] },
    leadingDiagnosis: {
      name: 'Disseminated histoplasmosis with secondary HLH',
      probability: 0.92,
      confirmationStatus: 'clinical_only',
      rationale: 'Skin papules, pancytopenia, very high ferritin at CD4 9.',
    },
    differential: [
      { name: 'Disseminated TB', probability: 0.25, evidenceFor: ['endemic setting', 'CD4 9'], evidenceAgainst: ['GeneXpert negative', 'TB-LAM negative'] },
      { name: 'Cryptococcosis', probability: 0.2, evidenceFor: ['CD4 9', 'confusion'], evidenceAgainst: ['no headache reported'] },
    ],
    mustNotMiss: [{ name: 'Cryptococcal meningitis', why: 'confusion at CD4 9', howToExclude: 'CrAg and lumbar puncture' }],
    investigations: {
      bedsideStat: [t('Blood cultures')],
      first24h: [t('Urine LAM')],
      definitive: [],
    },
    management: {
      immediate: [a('Start liposomal amphotericin B 3 mg/kg daily')],
      targeted: [],
      supportive: [a('IV fluids')],
    },
    existingTreatmentDecisions: [],
    timingDecisions: [],
    prophylaxis: [],
    escalation: { escalateIf: ['deterioration in consciousness'], redFlags: ['seizure'], referral: [] },
    questionAnswers: [],
    evidenceSources: ['Patient Symptoms'],
    uncertaintyFlags: [],
  };
}

/** Covers every element the starter rules require for the HIV case. */
export function goodPlan(): Record<string, unknown> {
  return {
    triageLevel: 1,
    triageConfidence: 0.9,
    severity: {
      summary: 'Critically ill: advanced HIV (CD4 9) with fever, confusion, hyponatraemia and borderline blood pressure. Sepsis-3 septic shock criteria cannot be assessed without lactate and vasopressor status.',
      redFlags: ['reduced consciousness', 'sodium 124', 'pancytopenia'],
    },
    leadingDiagnosis: {
      name: 'Disseminated fungal infection (probable histoplasmosis) with secondary HLH',
      probability: 0.9,
      confirmationStatus: 'clinical_only',
      rationale: 'Skin papules, pancytopenia, ferritin 18000 and CD4 9 with failure of empirical TB treatment; no tissue or culture confirmation yet.',
    },
    differential: [
      { name: 'Disseminated tuberculosis', probability: 0.25, evidenceFor: ['endemic setting', 'CD4 9', 'HLH trigger'], evidenceAgainst: ['GeneXpert and urine LAM negative, which do not exclude TB at this CD4'] },
      { name: 'Cryptococcal disease', probability: 0.2, evidenceFor: ['CD4 9', 'confusion'], evidenceAgainst: ['CrAg not yet reported'] },
    ],
    mustNotMiss: [
      { name: 'Cryptococcal meningitis', why: 'confusion at CD4 9', howToExclude: 'serum CrAg and lumbar puncture with CSF CrAg' },
      { name: 'Adrenal insufficiency', why: 'hypotension with hyponatraemia', howToExclude: 'cortisol before steroids' },
    ],
    investigations: {
      bedsideStat: [t('Bedside glucose'), t('Lactate and blood gas'), t('Serum sodium and potassium, repeat'), t('Blood cultures including mycobacterial and fungal bottles')],
      first24h: [t('Serum CrAg'), t('Urine LAM'), t('Urine Histoplasma antigen'), t('Random cortisol'), t('Creatinine, potassium and magnesium baseline'), t('Lumbar puncture with CSF CrAg, culture and Xpert if safe'), t('Ferritin, triglycerides, fibrinogen')],
      definitive: [t('Bone marrow aspirate and trephine with culture and histology'), t('Skin smear and biopsy of papules for histology and fungal culture')],
    },
    management: {
      immediate: [
        a('Liposomal amphotericin B preferred over deoxycholate formulation because of raised creatinine; monitor creatinine, potassium and magnesium daily'),
        a('Correct hyponatraemia cautiously and give empirical hydrocortisone if cortisol is low or the patient deteriorates'),
      ],
      targeted: [a('Haematology referral for HLH management and trigger-directed therapy')],
      supportive: [a('Cautious IV fluids with sodium monitoring')],
    },
    existingTreatmentDecisions: [
      { treatment: 'Empirical TB treatment (RHZE)', decision: 'continue', reason: 'negative GeneXpert and LAM do not exclude TB at CD4 9; stop only if an alternative diagnosis is proven and TB is excluded on culture' },
    ],
    timingDecisions: [
      { topic: 'ART initiation', recommendation: 'Defer ART until cryptococcal meningitis is excluded and amphotericin has been started; then start within the timeframe in the SA HIV Clinicians Society guideline', reason: 'risk of IRIS and unmasked CNS disease' },
    ],
    prophylaxis: [{ agent: 'Cotrimoxazole prophylaxis', indication: 'CD4 below 200' }],
    escalation: {
      escalateIf: ['falling GCS', 'systolic BP below 90 despite fluids', 'rising creatinine'],
      redFlags: ['seizure', 'persistent vomiting'],
      referral: ['Haematology', 'Infectious diseases'],
    },
    questionAnswers: [
      { question: 'Should we continue TB treatment?', answer: 'Yes, continue for now, because the negative tests do not exclude TB at this CD4; revisit when culture and marrow results are back.' },
      { question: 'When should ART be started?', answer: 'Not before cryptococcal meningitis is excluded and antifungal therapy is under way; then early, per the SA HIV Clinicians Society guideline.' },
    ],
    evidenceSources: ['Patient Symptoms', 'Patient Vitals', 'WHO'],
    uncertaintyFlags: ['NO_TISSUE_DIAGNOSIS'],
  };
}
