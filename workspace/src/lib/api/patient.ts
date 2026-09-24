import { apiClient } from './client';

export interface BiometricReading {
  heartRate?: number;
  heartRateResting?: number;
  hrvRmssd?: number;
  bloodPressure?: {
    systolic: number;
    diastolic: number;
  };
  oxygenSaturation?: number;
  temperature?: number;
  respiratoryRate?: number;
  weight?: number;
  height?: number;
  glucose?: number;
  stepCount?: number;
  activeCalories?: number;
  skinTempOffset?: number;
  sleepDurationHours?: number;
  ecgRhythm?: 'regular' | 'irregular' | 'unknown';
  temperatureTrend?: 'normal' | 'elevated_single_day' | 'elevated_over_3_days';
  source?: 'wearable' | 'manual';
  deviceType?: string;
}

// Mirrors apps/ml-service/models.py EarlyWarningSummary exactly (raw
// snake_case passthrough — apps/backend/src/routes/patient.ts's
// GET /patient/early-warning forwards mlData unmodified, and its
// ML-service-unavailable fallback is built to the same shape — see
// docs/ENGINEERING_PLAN.md #29). Do not reintroduce a
// riskLevel/trendAnalysis/baselineMetrics-shaped mock; real traffic never
// sends that shape and didn't since the AH-45 refactor.
export interface EarlyWarningSummary {
  user_id?: string;
  processed_at?: string;

  // Current biometrics (latest reading)
  heart_rate_resting?: number;
  hrv_rmssd?: number;
  spo2?: number;
  sleep_duration_hours?: number;
  step_count?: number;
  ecg_rhythm?: string;
  temperature_trend?: string;

  // Personal baselines + extracted trend features
  hr_baseline?: number;
  hrv_baseline?: number;
  hr_trend_2w?: 'rising' | 'stable' | 'declining';
  hrv_vs_baseline?: 'below' | 'at' | 'above';
  sleep_pattern?: 'disrupted' | 'adequate' | 'good';

  // WHO 2019 non-lab CVD risk category — gated behind WHO_2019_CHART_SIGNED_OFF
  // server-side (CLINICAL_SIGNOFF_CHECKLIST.md row 7). `computable` is
  // false (with reasons_not_computable explaining why) until that gate is
  // flipped — render the "why not available" state, don't hide it silently.
  cvd_risk?: {
    instrument?: string;
    computable?: boolean;
    risk_category?: '<5%' | '5-10%' | '10-20%' | '>20%' | null;
    reasons_not_computable?: string[];
    discordance_flag?: boolean;
    physiological_trend_flags?: string[];
    epidemiological_flags?: string[];
  };

  // AH-45.5a (docs/ENGINEERING_PLAN.md §25): change-detection only, not a
  // BP measurement or a hypertension risk score. `prompt_bp_check` stays
  // false until BP_CHECK_PROMPT_SIGNED_OFF is set server-side (see
  // docs/CLINICAL_SIGNOFF_CHECKLIST.md row 10) — do not render this as an
  // actionable prompt without checking `signed_off` first, and do not let
  // it influence any acuity/risk display (e.g. AcuityRow).
  bp_risk?: {
    prompt_bp_check?: boolean;
    hr_deviation?: boolean;
    hrv_deviation?: boolean;
    short_sleep?: boolean;
    signed_off?: boolean;
    contributing_signals?: string[];
    disclaimer?: string;
  };

  fusion?: {
    trajectory_risk_2y_pct?: number | null;
    alert_triggered?: boolean;
    alert_message?: string | null;
  };

  clinical_flags?: string[];
  alert_level?: 'GREEN' | 'YELLOW' | 'RED';
  anomalies?: string[];
  recommendations?: string[];

  uncertainty?: {
    score?: number;
    reasons?: string[];
  };
  provenance?: {
    evidence_sources?: string[];
    clinical_basis?: string[];
    model_version?: string;
    decision_trace_id?: string;
  };
  requires_clinician_review?: boolean;
}

export interface RiskProfile {
  smoker?: boolean;
  hypertension?: boolean;
  diabetes?: boolean;
  asthmaOrCopd?: boolean;
  pregnancy?: boolean;
  familyHistoryCvd?: boolean;
  activityLevel?: 'LOW' | 'MODERATE' | 'HIGH';
  alcoholUse?: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
  cholesterolKnown?: boolean;
  cholesterolValue?: number;
  consentAcknowledged?: boolean;
  onboardingCompleted?: boolean;
  surveyVersion?: number;
  medicalPassport?: {
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    bloodType?: string;
    allergies?: string[];
    chronicConditions?: string[];
    currentMedications?: string[];
  };
  passportCompletionPercent?: number;
  nextPassportQuestion?: string;
}

export interface TriageRequest {
  symptoms: string;
  imageBase64?: string;
  labResultFiles?: {
    fileName: string;
    dataUrl: string;
  }[];
}

export interface TriageResponse {
  success: boolean;
  status?: string;
  triageCaseId?: string;
  meta?: {
    estimatedWaitMinutes?: number;
    attachmentCount?: number;
  };
  data?: {
    triageLevel: number;
    recommendedAction: string;
    possibleConditions: string[];
    reasoning: string;
  };
}

export interface TriageAttachment {
  id: string;
  kind: "symptom_image" | "lab_result" | "follow_up_file";
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  url: string;
}

export interface MedicalPassportSummary {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  bloodType: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  pregnancy: boolean | null;
  missingFields: string[];
}

export interface SafetySummary {
  canPrescribe: boolean;
  blockers: string[];
  warnings: string[];
  missingFields: string[];
}

export interface MonitoringSummary {
  status: string;
  baselineEstablished: boolean;
  alertLevel: string;
  readinessScore?: number;
  recentReadings: Record<string, unknown>[];
}

export interface ApiError {
  message?: string;
  code?: string;
  response?: { data?: { error?: string } };
}

export const patientApi = {
  submitBiometrics: async (data: BiometricReading, idempotencyKey?: string) => {
    const res = await apiClient.post('/patient/biometrics', data, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
    return res.data;
  },
  getBiometricHistory: async (limit = 30) => {
    const res = await apiClient.get(`/patient/biometrics/history?limit=${limit}`);
    return res.data;
  },
  getHealthAlerts: async () => {
    const res = await apiClient.get('/patient/alerts');
    return res.data;
  },
  getMonitoringSummary: async (): Promise<MonitoringSummary> => {
    const res = await apiClient.get('/patient/monitoring/summary');
    const raw = res.data?.data ?? res.data;
    if (!raw || typeof raw !== 'object') return { status: 'offline', baselineEstablished: false, alertLevel: 'Unknown', recentReadings: [] };
    return {
      status: raw.status ?? 'offline',
      baselineEstablished: Boolean(raw.baselineEstablished),
      alertLevel: raw.alertLevel ?? (raw.recentAlerts > 0 ? 'YELLOW' : raw.baselineEstablished ? 'GREEN' : 'Unknown'),
      readinessScore: raw.currentReadinessScore ?? raw.readinessScore,
      recentReadings: Array.isArray(raw.recentReadings) ? raw.recentReadings : [],
    };
  },
  getEarlyWarningSummary: async (): Promise<EarlyWarningSummary> => {
    const res = await apiClient.get('/patient/early-warning');
    const data = res.data?.data ?? res.data;
    if (!data || res.data?.success === false) throw new Error(res.data?.error ?? 'Failed to load');
    return data;
  },
  startDemoStream: async (durationSeconds: number = 300, intervalSeconds: number = 30) => {
    const res = await apiClient.post(`/patient/demo/start-stream?durationSeconds=${durationSeconds}&intervalSeconds=${intervalSeconds}`);
    return res.data;
  },
  updateRiskProfile: async (profile: RiskProfile) => {
    const res = await apiClient.patch('/patient/risk-profile', profile);
    return res.data;
  },
  submitTriage: async (data: TriageRequest): Promise<TriageResponse> => {
    const res = await apiClient.post('/triage', data);
    return res.data;
  },
  getMyTriageCases: async () => {
    const res = await apiClient.get('/triage/my-cases');
    const data = res.data ?? {};
    return {
      ...data,
      cases: Array.isArray(data.cases) ? data.cases : [],
    };
  },
  submitTriageFollowUp: async (caseId: string, payload: {
    responseText?: string;
    followUpFiles?: {
      fileName: string;
      dataUrl: string;
    }[];
  }) => {
    const res = await apiClient.post(`/triage/${caseId}/follow-up-response`, payload);
    return res.data;
  },
};
