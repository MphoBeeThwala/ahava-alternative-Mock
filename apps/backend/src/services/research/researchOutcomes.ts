/**
 * The ground-truth vocabulary. This list is a contract with the Python side
 * (apps/ml-service/research/outcomes.py): a type added here has to be added
 * there before a model can be trained on it, and a contract test on each side
 * pins the list.
 *
 * Values are structured only: a type, a day, an optional ICD-10 code and a
 * small whitelisted details object. Free text never enters the research
 * tables, so there is nothing to de-identify after the fact.
 */

export const OUTCOME_TYPES = [
  'HYPERTENSION_DIAGNOSED',
  'DIABETES_DIAGNOSED',
  'CVD_EVENT',            // MI, stroke/TIA, heart-failure decompensation, revascularisation
  'ARRHYTHMIA_DIAGNOSED',
  'HOSPITAL_ADMISSION',
  'EMERGENCY_REFERRAL',   // recorded automatically when a doctor issues an EMERGENCY referral
  'DEATH',
  'ALERT_CONFIRMED',      // a clinician judged an early-warning alert to reflect a real problem
  'ALERT_DISMISSED',      // ...or judged it a false alarm
  'TRIAGE_REVIEWED',      // recorded automatically: AI triage level vs the doctor's final level
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

/** Types a clinician may enter by hand. The automatic ones are written by the system only. */
export const CLINICIAN_ENTERABLE: readonly OutcomeType[] = [
  'HYPERTENSION_DIAGNOSED',
  'DIABETES_DIAGNOSED',
  'CVD_EVENT',
  'ARRHYTHMIA_DIAGNOSED',
  'HOSPITAL_ADMISSION',
  'DEATH',
  'ALERT_CONFIRMED',
  'ALERT_DISMISSED',
];

// REMOTE_TRIAGE marks a diagnosis made remotely during a triage case, without
// an examination or test: a weaker label than the others. Analyses can leave
// these out (research `--strong-labels-only`).
export const OUTCOME_BASES = ['CLINICAL', 'LAB', 'IMAGING', 'DISCHARGE_SUMMARY', 'REMOTE_TRIAGE'] as const;
export type OutcomeBasis = (typeof OUTCOME_BASES)[number];

// ICD-10: letter (not U), two digits, optional .1-4 alphanumerics. Format check
// only; this does not assert the code exists.
const ICD10_RE = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/;

/** Optional ICD-10 from a form: blank is fine, anything else must be a well-formed code. */
export function parseOptionalIcd10(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const code = String(value).trim().toUpperCase();
  if (!ICD10_RE.test(code)) return { ok: false, error: 'icd10 is not a valid ICD-10 code format (for example I10 or E11.9)' };
  return { ok: true, value: code };
}

const inRange = (cat: string, letter: string, lo: number, hi: number) => {
  const n = Number(cat.slice(1, 3));
  return cat[0] === letter && Number.isInteger(n) && n >= lo && n <= hi;
};

/**
 * Which research outcome types a coded diagnosis counts as. Deliberately
 * conservative: only categories that clearly mean the outcome. Admission and
 * death cannot be read off a diagnosis and are never inferred here.
 */
export function outcomeTypesForIcd10(code: string | null): OutcomeType[] {
  if (!code) return [];
  const cat = code.slice(0, 3);
  const out: OutcomeType[] = [];
  if (inRange(cat, 'I', 10, 15)) out.push('HYPERTENSION_DIAGNOSED');           // hypertensive diseases
  if (inRange(cat, 'E', 10, 14)) out.push('DIABETES_DIAGNOSED');               // diabetes mellitus
  if (['I21', 'I22', 'I46', 'I50', 'G45'].includes(cat) || inRange(cat, 'I', 60, 64)) {
    out.push('CVD_EVENT');                                                      // MI, cardiac arrest, heart failure, stroke, TIA
  }
  if (inRange(cat, 'I', 47, 49)) out.push('ARRHYTHMIA_DIAGNOSED');             // tachycardias, atrial fibrillation, other arrhythmias
  return out;
}

export interface ClinicianOutcomeInput {
  outcomeType: unknown;
  outcomeDay: unknown;
  icd10?: unknown;
  basis?: unknown;
  alertLevel?: unknown;
}

export interface ValidOutcome {
  outcomeType: OutcomeType;
  outcomeDay: Date;
  icd10: string | null;
  details: Record<string, string>;
}

const DAY_MS = 86_400_000;

export function validateClinicianOutcome(
  input: ClinicianOutcomeInput,
  now = new Date(),
): { ok: true; value: ValidOutcome } | { ok: false; error: string } {
  const type = String(input.outcomeType ?? '');
  if (!CLINICIAN_ENTERABLE.includes(type as OutcomeType)) {
    return { ok: false, error: `outcomeType must be one of: ${CLINICIAN_ENTERABLE.join(', ')}` };
  }

  const dayRaw = typeof input.outcomeDay === 'string' ? input.outcomeDay : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) return { ok: false, error: 'outcomeDay must be YYYY-MM-DD' };
  const day = new Date(`${dayRaw}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== dayRaw) {
    return { ok: false, error: 'outcomeDay is not a real date' };
  }
  if (day.getTime() > now.getTime() + DAY_MS) return { ok: false, error: 'outcomeDay cannot be in the future' };
  if (day.getTime() < Date.UTC(2000, 0, 1)) return { ok: false, error: 'outcomeDay is implausibly old' };

  let icd10: string | null = null;
  if (input.icd10 !== undefined && input.icd10 !== null && input.icd10 !== '') {
    const code = String(input.icd10).trim().toUpperCase();
    if (!ICD10_RE.test(code)) return { ok: false, error: 'icd10 is not a valid ICD-10 code format' };
    icd10 = code;
  }

  const details: Record<string, string> = {};
  if (input.basis !== undefined && input.basis !== null && input.basis !== '') {
    if (!OUTCOME_BASES.includes(input.basis as OutcomeBasis)) {
      return { ok: false, error: `basis must be one of: ${OUTCOME_BASES.join(', ')}` };
    }
    details.basis = input.basis as string;
  }
  if (type === 'ALERT_CONFIRMED' || type === 'ALERT_DISMISSED') {
    if (input.alertLevel !== undefined && input.alertLevel !== null && input.alertLevel !== '') {
      if (input.alertLevel !== 'YELLOW' && input.alertLevel !== 'RED') {
        return { ok: false, error: 'alertLevel must be YELLOW or RED' };
      }
      details.alertLevel = input.alertLevel;
    }
  }
  return { ok: true, value: { outcomeType: type as OutcomeType, outcomeDay: day, icd10, details } };
}

export type TriageRoute = 'RELEASED' | 'PRESCRIPTION' | 'REFERRAL';

/** Details object for the automatic TRIAGE_REVIEWED outcome. Levels only, no text. */
export function triageDetails(aiLevel: number, finalLevel: number | null, route: TriageRoute) {
  const level = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5 ? (n as number) : null);
  const ai = level(aiLevel);
  const fin = level(finalLevel) ?? ai; // no override recorded = the doctor accepted the AI level
  return { aiLevel: ai, finalLevel: fin, overridden: ai !== null && fin !== null && ai !== fin, route };
}
