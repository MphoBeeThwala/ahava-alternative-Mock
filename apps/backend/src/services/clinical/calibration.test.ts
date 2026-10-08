import { calibrateConfidence, caseHasConfirmatoryEvidence, bandFor, UNCONFIRMED_CAP } from './calibration';

const base = {
  modelTriageConfidence: 0.9,
  modelDiagnosticConfidence: 0.92,
  claimedConfirmation: 'clinical_only' as const,
  alternativeProbabilities: [] as Array<number | null>,
  caseText: 'Advanced HIV, CD4 9. GeneXpert negative, TB-LAM negative. Skin lesions, pancytopenia.',
};

describe('calibrateConfidence', () => {
  it('caps the 0.92 case at 0.7 without confirmation, but leaves triage confidence alone', () => {
    const r = calibrateConfidence(base);
    expect(r.diagnostic.value).toBe(UNCONFIRMED_CAP);
    expect(r.diagnostic.modelValue).toBe(0.92);
    expect(r.triage.value).toBe(0.9);
    expect(r.diagnostic.appliedCaps[0]).toMatch(/no microbiological or tissue confirmation/);
  });

  it('lowers further when two, or three or more, alternatives stay plausible', () => {
    expect(calibrateConfidence({ ...base, alternativeProbabilities: [0.3, 0.2] }).diagnostic.value).toBe(0.55);
    expect(calibrateConfidence({ ...base, alternativeProbabilities: [0.3, 0.2, 0.15] }).diagnostic.value).toBe(0.45);
    expect(calibrateConfidence({ ...base, alternativeProbabilities: [0.3, 0.05] }).diagnostic.value).toBe(0.7);
  });

  it('never raises a low value', () => {
    expect(calibrateConfidence({ ...base, modelDiagnosticConfidence: 0.3 }).diagnostic.value).toBe(0.3);
  });

  it('lets confirmed diagnoses exceed 0.7 only when the case text really contains a positive result', () => {
    const confirmed = calibrateConfidence({
      ...base, claimedConfirmation: 'microbiologically_confirmed',
      caseText: 'Urine Histoplasma antigen positive. Blood culture grew Histoplasma capsulatum.',
    });
    expect(confirmed.diagnostic.value).toBe(0.92);
    expect(confirmed.diagnostic.band).toBe('high');

    const unsupported = calibrateConfidence({ ...base, claimedConfirmation: 'tissue_confirmed' });
    expect(unsupported.diagnostic.value).toBe(0.7);
    expect(unsupported.diagnostic.confirmationStatus).toBe('clinical_only');
    expect(unsupported.diagnostic.appliedCaps.join(' ')).toMatch(/claimed confirmation not found/);
  });

  it('applies the no-reference-evidence ceiling of 0.5', () => {
    expect(calibrateConfidence({ ...base, noReferenceEvidence: true }).diagnostic.value).toBe(0.5);
  });

  it('treats non-finite model values as 0.45', () => {
    expect(calibrateConfidence({ ...base, modelDiagnosticConfidence: NaN }).diagnostic.value).toBe(0.45);
  });
});

describe('caseHasConfirmatoryEvidence', () => {
  it.each([
    'Blood culture grew Mycobacterium tuberculosis.',
    'GeneXpert positive, rifampicin sensitive.',
    'Cryptococcal antigen positive in CSF.',
    'Bone marrow biopsy shows haemophagocytosis and yeast forms.',
  ])('accepts a stated positive result: %s', (t) => expect(caseHasConfirmatoryEvidence(t)).toBe(true));

  it.each([
    'GeneXpert negative and TB-LAM negative.',
    'No organisms seen. Cultures pending.',
    'Skin smear not done. Bone marrow biopsy requested.',
    'CrAg not detected.',
  ])('rejects negatives and pending tests: %s', (t) => expect(caseHasConfirmatoryEvidence(t)).toBe(false));
});

describe('bands', () => {
  it('maps values to bands', () => {
    expect([0.2, 0.5, 0.7, 0.9].map(bandFor)).toEqual(['low', 'moderate', 'probable', 'high']);
  });
});
