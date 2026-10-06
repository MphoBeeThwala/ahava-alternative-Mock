import { apiClient } from './client';

export interface ResearchReading {
  observedDay: string;
  ageBand: string;
  sex: string | null;
  source: string;
  hrResting: number | null;
  hrvRmssd: number | null;
  spo2: number | null;
  sbp: number | null;
  dbp: number | null;
  glucose: number | null;
  [key: string]: unknown;
}

export interface ResearchOutcomeRow {
  outcomeType: string;
  outcomeDay: string;
  icd10: string | null;
  details: Record<string, unknown> | null;
  source: string;
}

export interface MyResearchData {
  taking_part: boolean;
  since: string | null;
  readings: ResearchReading[];
  outcomes: ResearchOutcomeRow[];
  /** A count only: scores from unvalidated candidate models are never shown. */
  modelScoresComputed: number;
  captureEnabled: boolean;
}

export type ClinicianOutcomeType =
  | 'HYPERTENSION_DIAGNOSED' | 'DIABETES_DIAGNOSED' | 'CVD_EVENT' | 'ARRHYTHMIA_DIAGNOSED'
  | 'HOSPITAL_ADMISSION' | 'DEATH' | 'ALERT_CONFIRMED' | 'ALERT_DISMISSED';

export interface RecordOutcomeInput {
  patientId: string;
  outcomeType: ClinicianOutcomeType;
  outcomeDay: string; // YYYY-MM-DD
  icd10?: string;
  basis?: 'CLINICAL' | 'LAB' | 'IMAGING' | 'DISCHARGE_SUMMARY';
  alertLevel?: 'YELLOW' | 'RED';
}

export interface RecordOutcomeResult {
  success: boolean;
  captured: boolean;
  /** Present when not captured, e.g. 'no_consent'. */
  reason?: string;
}

export const researchApi = {
  /** A patient's own research data (what they have shared). */
  myData: async (): Promise<MyResearchData> => {
    const res = await apiClient.get('/research/my-data');
    return res.data.data;
  },
  /** A verified doctor records a confirmed outcome for a patient they hold access to. */
  recordOutcome: async (input: RecordOutcomeInput): Promise<RecordOutcomeResult> => {
    const res = await apiClient.post('/research/outcomes', input);
    return res.data;
  },
};

/** Same shape the server enforces; checked here so a typo is caught before the request. */
export const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/;
export const isValidIcd10 = (value: string): boolean => ICD10_PATTERN.test(value.trim().toUpperCase());
