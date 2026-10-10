import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ClinicalPlanPanel } from './ClinicalPlanPanel';
import type { StructuredPlanRecord } from '../../../../lib/api';

afterEach(cleanup);

const record = (over: Partial<StructuredPlanRecord> = {}): StructuredPlanRecord => ({
  schemaVersion: 1,
  audience: 'clinician_only',
  plan: {
    triageLevel: 1,
    triageConfidence: 0.9,
    severity: { summary: 'Critically ill', redFlags: ['reduced consciousness'] },
    leadingDiagnosis: { name: 'Disseminated histoplasmosis with secondary HLH', probability: 0.9, confirmationStatus: 'clinical_only', rationale: 'Skin papules, pancytopenia, ferritin 18000' },
    differential: [{ name: 'Disseminated TB', probability: 0.25, evidenceFor: ['CD4 9'], evidenceAgainst: ['GeneXpert negative'] }],
    mustNotMiss: [{ name: 'Cryptococcal meningitis', why: 'confusion at CD4 9', howToExclude: 'CrAg and lumbar puncture' }],
    investigations: {
      bedsideStat: [{ test: 'Bedside glucose', rationale: 'confusion' }],
      first24h: [{ test: 'Random cortisol', rationale: 'hypotension with low sodium' }],
      definitive: [{ test: 'Bone marrow aspirate and trephine', rationale: 'HLH and infection' }],
    },
    management: {
      immediate: [{ action: 'Liposomal amphotericin B', rationale: 'raised creatinine', guidelineSource: 'SA guideline: verify' }],
      targeted: [], supportive: [],
    },
    existingTreatmentDecisions: [{ treatment: 'Empirical TB treatment', decision: 'continue', reason: 'negative tests do not exclude TB at CD4 9' }],
    timingDecisions: [{ topic: 'ART initiation', recommendation: 'Defer until cryptococcal meningitis excluded', reason: 'IRIS risk' }],
    prophylaxis: [{ agent: 'Cotrimoxazole', indication: 'CD4 below 200' }],
    escalation: { escalateIf: ['falling GCS'], redFlags: ['seizure'], referral: ['Haematology'] },
    questionAnswers: [{ question: 'Should we continue TB treatment?', answer: 'Yes, for now.' }],
  },
  checks: {
    map: 71,
    septicShock: { status: 'not_assessable', reason: 'missing lactate and vasopressor requirement.' },
    hlh2004: { metCount: 5, notAssessableCount: 3, maxPossible: 8, status: 'met' },
    hScore: { scoreMin: 150, scoreMax: 280, status: 'not_assessable' },
    egfr: 31,
  },
  calibration: {
    triage: { value: 0.9, band: 'high' },
    diagnostic: { value: 0.55, band: 'moderate', modelValue: 0.92, confirmationStatus: 'clinical_only', appliedCaps: ['no microbiological or tissue confirmation: capped at 0.7'] },
  },
  reviewerFlags: [],
  references: { completenessRules: { version: '0.1.0', signoff: 'pending' } },
  repairRounds: 0,
  ...over,
});

describe('ClinicalPlanPanel', () => {
  it('shows the tiers, the decision on existing treatment and the timing decision', () => {
    render(<ClinicalPlanPanel record={record()} />);
    expect(screen.getByText(/Bedside \/ stat/)).toBeTruthy();
    expect(screen.getByText('Random cortisol')).toBeTruthy();
    expect(screen.getByText('Bone marrow aspirate and trephine')).toBeTruthy();
    expect(screen.getByText('CONTINUE')).toBeTruthy();
    expect(screen.getByText(/ART initiation:/)).toBeTruthy();
    expect(screen.getByText('Should we continue TB treatment?')).toBeTruthy();
  });

  it('states septic shock as "cannot be assessed" rather than absent, and shows the confidence reduction', () => {
    render(<ClinicalPlanPanel record={record()} />);
    expect(within(screen.getByTestId('septic-shock-line')).getByText('cannot be assessed')).toBeTruthy();
    const line = screen.getByTestId('confidence-line').textContent ?? '';
    expect(line).toMatch(/moderate/);
    expect(line).toMatch(/model said 0\.92/);
    expect(line).toMatch(/labels, not calibrated probabilities/);
  });

  it('puts unresolved gaps in a prominent alert and keeps no-dose wording', () => {
    render(<ClinicalPlanPanel record={record({ reviewerFlags: [
      { code: 'COMPLETENESS_GAP', severity: 'high', message: 'Advanced HIV disease: the plan does not address an explicit ART timing decision.' },
      { code: 'DOSE_REMOVED', severity: 'info', message: '1 model-written dose(s) were removed.' },
    ] })} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/ART timing/);
    expect(alert.textContent).not.toMatch(/dose\(s\) were removed/);
    expect(screen.getByText(/No doses are generated/)).toBeTruthy();
  });

  it('shows no alert when nothing is unresolved', () => {
    render(<ClinicalPlanPanel record={record()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
