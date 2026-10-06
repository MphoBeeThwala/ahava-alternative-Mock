import fs from 'fs';
import path from 'path';
import { CLINICIAN_ENTERABLE, OUTCOME_BASES, OUTCOME_TYPES, outcomeTypesForIcd10, parseOptionalIcd10, triageDetails, validateClinicianOutcome } from './researchOutcomes';

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

describe('parseOptionalIcd10', () => {
  it('treats blank as "no code" and normalises a valid one', () => {
    for (const blank of [undefined, null, '']) expect(parseOptionalIcd10(blank)).toEqual({ ok: true, value: null });
    expect(parseOptionalIcd10(' i10 ')).toEqual({ ok: true, value: 'I10' });
    expect(parseOptionalIcd10('e11.9')).toEqual({ ok: true, value: 'E11.9' });
  });
  it('rejects anything that is not a well-formed code', () => {
    for (const bad of ['hypertension', 'I', '10', 'U07.1', 'I1000000', 'I10; DROP TABLE', 123]) {
      expect(parseOptionalIcd10(bad).ok).toBe(false);
    }
  });
});

describe('outcomeTypesForIcd10 (conservative mapping)', () => {
  it.each([
    ['I10', ['HYPERTENSION_DIAGNOSED']],
    ['I15.9', ['HYPERTENSION_DIAGNOSED']],
    ['E11.9', ['DIABETES_DIAGNOSED']],
    ['E14', ['DIABETES_DIAGNOSED']],
    ['I21.0', ['CVD_EVENT']],
    ['I63.9', ['CVD_EVENT']],
    ['G45.9', ['CVD_EVENT']],
    ['I50.0', ['CVD_EVENT']],
    ['I46.9', ['CVD_EVENT']],
    ['I48.0', ['ARRHYTHMIA_DIAGNOSED']],
  ])('%s -> %j', (code, expected) => {
    expect(outcomeTypesForIcd10(code)).toEqual(expected);
  });
  it('maps nothing for diagnoses that are not these outcomes', () => {
    for (const code of ['J06.9', 'A09', 'I25.1', 'I16.0', 'O10.0', 'E15', 'I65.2', null]) {
      expect(outcomeTypesForIcd10(code as string | null)).toEqual([]);
    }
  });
  it('never infers admission or death from a diagnosis', () => {
    const everything = ['I10', 'E11', 'I21', 'I46', 'I48', 'I63', 'G45', 'I50'].flatMap(outcomeTypesForIcd10);
    expect(everything).not.toContain('HOSPITAL_ADMISSION');
    expect(everything).not.toContain('DEATH');
  });
});

describe('outcome bases', () => {
  it('includes a weaker REMOTE_TRIAGE basis for diagnoses made without an examination or test', () => {
    expect(OUTCOME_BASES).toContain('REMOTE_TRIAGE');
    const r = validateClinicianOutcome({ outcomeType: 'DIABETES_DIAGNOSED', outcomeDay: '2026-09-01', basis: 'REMOTE_TRIAGE' }, NOW);
    expect(r.ok && r.value.details).toEqual({ basis: 'REMOTE_TRIAGE' });
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
