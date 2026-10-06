/**
 * Maps a BiometricReading + the patient's profile onto a ResearchSnapshot row.
 *
 * Rules:
 *  - Implausible values become null. They are never clamped or defaulted:
 *    live code substitutes 72 bpm / 98% SpO2 for a missing value so the
 *    dashboard renders, but a training set must not contain invented vitals.
 *  - Unknown risk factors are null, never false ("no assumed non-smoker",
 *    the same rule the live engine follows, ENGINEERING_PLAN §45.4).
 *  - Nothing identifying: no ids, no exact timestamps, no free text.
 */
import { ageBandOf, normaliseSex, toDay, RESEARCH_SCHEMA_VERSION } from './pseudonym';

type Num = number | null | undefined;

export interface ReadingLike {
  id: string;
  createdAt: Date;
  heartRate?: Num;
  heartRateResting?: Num;
  hrvRmssd?: Num;
  bloodPressureSystolic?: Num;
  bloodPressureDiastolic?: Num;
  oxygenSaturation?: Num;
  respiratoryRate?: Num;
  skinTempOffset?: Num;
  weight?: Num;
  height?: Num;
  glucose?: Num;
  stepCount?: Num;
  sleepDurationHours?: Num;
  ecgRhythm?: string | null;
  temperatureTrend?: string | null;
  source?: string | null;
}

export interface SubjectLike {
  dateOfBirth: Date | string | null;
  gender: string | null;
  riskProfile: unknown;
}

export interface LiveEngineOutput {
  alertLevel?: string | null;
  cvdRiskCategory?: string | null;
  framinghamRiskPct?: number | null;
  bpPromptCheck?: boolean | null;
  engineVersion?: string | null;
}

const inRange = (v: Num, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

const asNum = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' ? inRange(v, lo, hi) : null;

/** BMI from kg and cm; null unless both are plausible. Weight/height themselves are not stored. */
export function bmiOf(weightKg: Num, heightCm: Num): number | null {
  const w = inRange(weightKg, 20, 400);
  const h = inRange(heightCm, 90, 250);
  if (w === null || h === null) return null;
  const bmi = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
  return inRange(bmi, 10, 80);
}

export interface SnapshotFields {
  observedDay: Date;
  schemaVersion: number;
  ageBand: string;
  sex: string | null;
  smoker: boolean | null;
  diabetes: boolean | null;
  hypertensionKnown: boolean | null;
  hivPositive: boolean | null;
  activeTb: boolean | null;
  bpTreatment: boolean | null;
  totalCholesterolMmol: number | null;
  hdlMmol: number | null;
  hrResting: number | null;
  hrvRmssd: number | null;
  spo2: number | null;
  respRate: number | null;
  skinTempOffset: number | null;
  sbp: number | null;
  dbp: number | null;
  glucose: number | null;
  bmi: number | null;
  steps: number | null;
  sleepHours: number | null;
  ecgIrregular: boolean | null;
  temperatureTrend: string | null;
  source: string;
}

/** Returns null when the subject can't be captured (minor / unknown age). */
export function buildSnapshotFields(reading: ReadingLike, subject: SubjectLike): SnapshotFields | null {
  const ageBand = ageBandOf(subject.dateOfBirth, reading.createdAt);
  if (!ageBand) return null;
  const rp = (subject.riskProfile && typeof subject.riskProfile === 'object' ? subject.riskProfile : {}) as Record<string, unknown>;

  const ecg = (reading.ecgRhythm ?? '').toLowerCase();
  const trend = reading.temperatureTrend ?? null;

  return {
    observedDay: toDay(reading.createdAt),
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    ageBand,
    sex: normaliseSex(subject.gender),
    smoker: asBool(rp.smoker),
    diabetes: asBool(rp.diabetes),
    hypertensionKnown: asBool(rp.hypertension),
    hivPositive: asBool(rp.hivPositive),
    activeTb: asBool(rp.activeTb),
    bpTreatment: asBool(rp.bpTreatment),
    totalCholesterolMmol: asNum(rp.cholesterolValue, 2, 15),
    hdlMmol: asNum(rp.hdlValue, 0.3, 5),
    hrResting: inRange(reading.heartRateResting ?? reading.heartRate, 30, 220),
    hrvRmssd: inRange(reading.hrvRmssd, 0, 300),
    spo2: inRange(reading.oxygenSaturation, 50, 100),
    respRate: inRange(reading.respiratoryRate, 4, 60),
    skinTempOffset: inRange(reading.skinTempOffset, -5, 5),
    sbp: inRange(reading.bloodPressureSystolic, 60, 300),
    dbp: inRange(reading.bloodPressureDiastolic, 30, 200),
    glucose: inRange(reading.glucose, 1, 50),
    bmi: bmiOf(reading.weight, reading.height),
    steps: typeof reading.stepCount === 'number' && reading.stepCount >= 0 && reading.stepCount < 200000 ? Math.round(reading.stepCount) : null,
    sleepHours: inRange(reading.sleepDurationHours, 0, 24),
    ecgIrregular: ecg === 'irregular' ? true : ecg === 'regular' ? false : null,
    temperatureTrend: trend === 'normal' || trend === 'elevated_single_day' || trend === 'elevated_over_3_days' ? trend : null,
    source: reading.source === 'wearable' ? 'wearable' : 'manual',
  };
}

export function liveFields(live?: LiveEngineOutput | null) {
  if (!live) return {};
  const level = live.alertLevel;
  return {
    liveAlertLevel: level === 'GREEN' || level === 'YELLOW' || level === 'RED' ? level : null,
    liveCvdCategory: typeof live.cvdRiskCategory === 'string' ? live.cvdRiskCategory : null,
    liveFraminghamPct: typeof live.framinghamRiskPct === 'number' ? live.framinghamRiskPct : null,
    liveBpPrompt: typeof live.bpPromptCheck === 'boolean' ? live.bpPromptCheck : null,
    liveEngineVersion: typeof live.engineVersion === 'string' ? live.engineVersion.slice(0, 64) : null,
  };
}
