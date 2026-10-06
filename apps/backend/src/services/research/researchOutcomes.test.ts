import fs from 'fs';
import path from 'path';
import { CLINICIAN_ENTERABLE, OUTCOME_TYPES, triageDetails, validateClinicianOutcome } from './researchOutcomes';

const NOW = new Date('2026-10-06T12:00:00Z');
const ok = (o: Record<string, unknown>) => validateClinicianOutcome({ outcomeType: 'CVD_EVENT', outcomeDay: '2026-09-01', ...o }, NOW);

describe('validateClinicianOutcome', () => {
  it('accepts a minimal valid outcome and normalises it', () => {
    const r = ok({ icd10: 'i21.9', basis: 'LAB' });
    expect(r).toEqual({
      ok: true,
      value: { outcomeType: 'CVD_EVENT', outcomeDay: new Date('2026-09-01T00:00:00.000Z'), icd10: 'I21.9', details: { basis: 'LAB' } },
    });
  });

  it('only lets clinicians enter clinician types; automatic types are system-only', () => {
    expect(ok({ outcomeType: 'TRIAGE_REVIEWED' }).ok).toBe(false);
    expect(ok({ outcomeType: 'EMERGENCY_REFERRAL' }).ok).toBe(false);
    expect(ok({ outcomeType: 'NOT_A_TYPE' }).ok).toBe(false);
    for (const t of CLINICIAN_ENTERABLE) expect(ok({ outcomeType: t }).ok).toBe(true);
  });

  it.each([
    ['not a date', { outcomeDay: 'yesterday' }],
    ['impossible date', { outcomeDay: '2026-02-30' }],
    ['future date', { outcomeDay: '2026-12-01' }],
    ['ancient date', { outcomeDay: '1990-01-01' }],
    ['a Date object instead of YYYY-MM-DD', { outcomeDay: new Date() }],
    ['bad ICD-10', { icd10: 'heart attack' }],
    ['ICD-10 U-code', { icd10: 'U07.1' }],
    ['unknown basis', { basis: 'GUESS' }],
  ])('rejects %s', (_label, over) => {
    expect(ok(over).ok).toBe(false);
  });

  it('allows today and tomorrow (timezone slack) but not further ahead', () => {
    expect(ok({ outcomeDay: '2026-10-06' }).ok).toBe(true);
    expect(ok({ outcomeDay: '2026-10-07' }).ok).toBe(true);
    expect(ok({ outcomeDay: '2026-10-09' }).ok).toBe(false);
  });

  it('never carries free text: unknown fields are dropped, alertLevel only on alert outcomes', () => {
    const r = validateClinicianOutcome(
      { outcomeType: 'ALERT_DISMISSED', outcomeDay: '2026-09-01', alertLevel: 'RED', notes: 'Mrs X, Soweto' } as never,
      NOW,
    );
    expect(r.ok && r.value.details).toEqual({ alertLevel: 'RED' });
    const cvd = ok({ alertLevel: 'RED' });
    expect(cvd.ok && cvd.value.details).toEqual({});
    expect(validateClinicianOutcome({ outcomeType: 'ALERT_CONFIRMED', outcomeDay: '2026-09-01', alertLevel: 'GREEN' }, NOW).ok).toBe(false);
  });
});

describe('triageDetails', () => {
  it('records levels and whether the doctor changed them, with no text', () => {
    expect(triageDetails(3, 2, 'RELEASED')).toEqual({ aiLevel: 3, finalLevel: 2, overridden: true, route: 'RELEASED' });
    expect(triageDetails(3, 3, 'REFERRAL').overridden).toBe(false);
  });
  it('treats no recorded final level as acceptance of the AI level', () => {
    expect(triageDetails(4, null, 'PRESCRIPTION')).toEqual({ aiLevel: 4, finalLevel: 4, overridden: false, route: 'PRESCRIPTION' });
  });
  it('nulls out-of-range levels instead of storing them', () => {
    expect(triageDetails(9, 0, 'RELEASED')).toMatchObject({ aiLevel: null, finalLevel: null, overridden: false });
  });
});

describe('contract with the Python side', () => {
  it('OUTCOME_TYPES matches apps/ml-service/research/outcomes.py', () => {
    const file = path.resolve(__dirname, '../../../../ml-service/research/outcomes.py');
    if (!fs.existsSync(file)) return; // backend image builds without the ml-service tree
    const src = fs.readFileSync(file, 'utf8');
    const block = /OUTCOME_TYPES\s*=\s*\(([^)]*)\)/.exec(src);
    expect(block).not.toBeNull();
    const py = [...block![1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(py).toEqual([...OUTCOME_TYPES]);
  });
});
