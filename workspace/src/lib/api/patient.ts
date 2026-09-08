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

export interface EarlyWarningSummary {
  // Required fields from fallback or ML response
  riskLevel?: string;
  alert_level?: 'GREEN' | 'YELLOW' | 'RED';
  recommendations?: string[];

  // Trend analysis from fallback or ML response
  trendAnalysis?: {
    heartRate?: string;
    oxygenSaturation?: string;
    sleepQuality?: string;
  };

  // Baseline metrics or current biometrics
  baselineMetrics?: {
    timestamp?: string;
    heart_rate_resting?: number;
    hrv_rmssd?: number;
    spo2?: number;
    skin_temp_offset?: number;
    respiratory_rate?: number;
    step_count?: number;
    active_calories?: number;
    sleep_duration_hours?: number;
    ecg_rhythm?: string;
    temperature_trend?: string;
  };

  // Optional ML-specific fields
  user_id?: string;
  processed_at?: string;
  hr_baseline?: number;
  hrv_baseline?: number;
  hr_trend_2w?: string;
  hrv_vs_baseline?: string;
  sleep_pattern?: string;
  risk_scores?: {
    framingham_10y_pct?: number;
    qrisk3_10y_pct?: number;
    ml_cvd_risk_pct?: number;
    ml_confidence?: number;
  };
  fusion?: {
    trajectory_risk_2y_pct?: number;
    alert_triggered?: boolean;
    alert_message?: string;
  };
  clinical_flags?: string[];
  anomalies?: string[];
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
  submitBiometrics: async (data: BiometricReading) => {
    const res = await apiClient.post('/patient/biometrics', data);
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
