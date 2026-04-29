import axios, { AxiosInstance, AxiosError } from 'axios';

// Always use same-origin /api - Next.js rewrites handle the proxy to backend
// This avoids CORS issues entirely and works in both dev and production
function getApiBaseUrl(): string {
  return '/api';
}

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: ensure dev uses direct backend URL and token is always attached
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getApiBaseUrl();
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Track if we're already attempting refresh to avoid infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  onSuccess: (token: string) => void;
  onFailure: (error: AxiosError) => void;
}> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.onFailure(error);
    } else {
      prom.onSuccess(token!);
    }
  });
  failedQueue = [];
};

// Response interceptor with automatic token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry && typeof window !== 'undefined') {
      originalRequest._retry = true;
      const path = window.location.pathname || '';
      
      // Don't attempt refresh if already on auth pages
      if (path.startsWith('/auth/')) {
        return Promise.reject(error);
      }

      // Prevent multiple simultaneous refresh attempts
      if (!isRefreshing) {
        isRefreshing = true;
        const refreshToken = localStorage.getItem('refreshToken');

        if (refreshToken) {
          try {
            console.log('[API] Attempting to refresh token...');
            
            // Attempt to refresh token
            const response = await apiClient.post('/auth/refresh', { refreshToken });
            const { accessToken, refreshToken: newRefreshToken } = response.data;
            
            console.log('[API] Token refreshed successfully');
            
            // Update stored tokens
            localStorage.setItem('token', accessToken);
            localStorage.setItem('refreshToken', newRefreshToken);
            
            // Update the original request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            }
            
            // Process queued requests with new token
            processQueue(null, accessToken);
            
            // Retry original request with new token
            return apiClient(originalRequest);
          } catch (refreshError) {
            console.error('[API] Token refresh failed:', refreshError);
            
            // Refresh failed, log out
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('refreshToken');
            
            processQueue(refreshError, null);
            
            // Redirect to login
            window.location.href = '/auth/login';
            return Promise.reject(refreshError);
          } finally {
            isRefreshing = false;
          }
        } else {
          console.warn('[API] No refresh token available, logging out');
          
          // No refresh token available, log out
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/auth/login';
          
          return Promise.reject(error);
        }
      }

      // If already refreshing, queue this request
      return new Promise((onSuccess, onFailure) => {
        failedQueue.push({ onSuccess, onFailure });
      });
    }

    return Promise.reject(error);
  }
);

// ==================== AUTH ====================
export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  preferredLanguage?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    isVerified: boolean;
    preferredLanguage?: string;
  };
  accessToken: string;
  refreshToken: string;
}

export const authApi = {
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/register', data);
    return res.data;
  },
  login: async (data: LoginData): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/login', data);
    return res.data;
  },
  refreshToken: async (refreshToken: string): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/refresh', { refreshToken });
    return res.data;
  },
  forgotPassword: async (email: string) => {
    const res = await apiClient.post('/auth/forgot-password', { email });
    return res.data;
  },
  resetPassword: async (token: string, password: string) => {
    const res = await apiClient.post('/auth/reset-password', { token, password });
    return res.data;
  },
  verifyEmail: async (token: string) => {
    const res = await apiClient.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    return res.data;
  },
  resendVerification: async (email: string) => {
    const res = await apiClient.post('/auth/resend-verification', { email });
    return res.data;
  },
  manualVerify: async () => {
    const res = await apiClient.post('/auth/manual-verify');
    return res.data;
  },
  updateProfile: async (data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    preferredLanguage?: string | null;
    email?: string;
  }) => {
    const res = await apiClient.put('/auth/profile', data);
    return res.data;
  },
};

// ==================== PATIENT ====================
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
}

export interface TriageRequest {
  symptoms: string;
  imageBase64?: string;
}

export interface TriageResponse {
  success: boolean;
  status?: string;
  triageCaseId?: string;
  meta?: {
    estimatedWaitMinutes?: number;
  };
  data?: {
    triageLevel: number;
    recommendedAction: string;
    possibleConditions: string[];
    reasoning: string;
  };
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
};

// ==================== BOOKINGS ====================
export interface CreateBookingData {
  scheduledDate: string; // ISO date string
  address?: string;
  encryptedAddress: string;
  amountInCents: number;
  patientLat: number;
  patientLng: number;
  notes?: string;
  estimatedDuration?: number;
  paymentMethod?: string;
}

export interface Booking {
  id: string;
  patientId: string;
  scheduledDate: string;
  status: string;
  address?: string;
  encryptedAddress?: string;
  amountInCents: number;
  createdAt: string;
  updatedAt: string;
}

export const bookingsApi = {
  create: async (data: CreateBookingData) => {
    const res = await apiClient.post('/bookings', data);
    return res.data;
  },
  getMyBookings: async () => {
    // Use /bookings endpoint which automatically filters by role (patient)
    const res = await apiClient.get('/bookings');
    return res.data;
  },
  getById: async (id: string) => {
    const res = await apiClient.get(`/bookings/${id}`);
    return res.data;
  },
  cancel: async (id: string) => {
    const res = await apiClient.patch(`/bookings/${id}/cancel`);
    return res.data;
  },
};

// ==================== VISITS ====================
export interface Visit {
  id: string;
  bookingId: string;
  nurseId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  triageLevel?: number;
  biometrics?: Record<string, unknown> & {
    heartRate?: number;
    bloodPressure?: { systolic: number; diastolic: number };
    temperature?: number;
    oxygenSaturation?: number;
  };
  treatment?: { medications?: { name: string; dosage: string }[]; notes?: string };
  nurseReport?: string;
  booking?: {
    address?: string;
    encryptedAddress?: string;
    patient?: { firstName?: string; lastName?: string };
    scheduledDate?: string;
  };
}

export const visitsApi = {
  getMyVisits: async () => {
    // Use /visits endpoint which automatically filters by role
    const res = await apiClient.get('/visits');
    return res.data;
  },
  getById: async (id: string) => {
    const res = await apiClient.get(`/visits/${id}`);
    return res.data;
  },
  updateStatus: async (id: string, status: string) => {
    const res = await apiClient.patch(`/visits/${id}/status`, { status });
    return res.data;
  },
};

// ==================== NURSE ====================
export interface NurseAvailability {
  lat: number;
  lng: number;
  isAvailable: boolean;
}

export const nurseApi = {
  updateAvailability: async (data: NurseAvailability) => {
    const res = await apiClient.post('/nurse/availability', data);
    return res.data;
  },
  getMyVisits: async () => {
    // Use /visits endpoint which automatically filters by role (nurse)
    const res = await apiClient.get('/visits');
    return res.data;
  },
  getProfile: async () => {
    // Use /auth/me to get current user profile
    const res = await apiClient.get('/auth/me');
    // Return user data with location info
    return {
      user: res.data.user,
      isAvailable: res.data.user?.isAvailable || false,
      latitude: res.data.user?.lastKnownLat,
      longitude: res.data.user?.lastKnownLng,
    };
  },
};

// ==================== DOCTOR ====================
export interface TriageCase {
  id: string;
  patientId: string;
  doctorId: string | null;
  symptoms: string;
  aiTriageLevel: number;
  aiRecommendedAction: string;
  aiPossibleConditions: string[];
  aiReasoning: string;
  status: string;
  doctorNotes: string | null;
  doctorDiagnosis: string | null;
  doctorRecommendations: string | null;
  finalDiagnosis: string | null;
  finalTriageLevel: number | null;
  referredTo: string | null;
  aiModel: string | null;
  aiContextUsed: boolean;
  createdAt: string;
  patient?: { id: string; firstName: string; lastName: string; email?: string; phone?: string | null };
}

export const doctorApi = {
  getPendingVisits: async () => {
    const res = await apiClient.get('/visits?status=PENDING_REVIEW');
    return res.data;
  },
  approveVisit: async (visitId: string, review?: string) => {
    const res = await apiClient.post(`/visits/${visitId}/approve`, review != null ? { review } : {});
    return res.data;
  },
  getTriageCases: async (status?: 'PENDING_REVIEW' | 'mine') => {
    const q = status ? `?status=${status}` : '?status=PENDING_REVIEW';
    const res = await apiClient.get(`/triage-cases${q}`);
    return res.data;
  },
  approveTriageCase: async (caseId: string, finalDiagnosis?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/approve`, finalDiagnosis != null ? { finalDiagnosis } : {});
    return res.data;
  },
  overrideTriageCase: async (caseId: string, doctorNotes?: string, finalDiagnosis?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/override`, { doctorNotes, finalDiagnosis });
    return res.data;
  },
  referTriageCase: async (caseId: string, referredTo: string, doctorNotes?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/refer`, { referredTo, doctorNotes });
    return res.data;
  },
  // New review-flow endpoints
  claimTriageCase: async (caseId: string) => {
    const res = await apiClient.post(`/triage-review/${caseId}/claim`);
    return res.data;
  },
  reviewTriageCase: async (caseId: string, payload: {
    doctorNotes: string;
    doctorDiagnosis: string;
    doctorRecommendations?: string;
    finalTriageLevel?: number;
    overrideReason?: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/review`, payload);
    return res.data;
  },
  releaseTriageCase: async (caseId: string) => {
    const res = await apiClient.post(`/triage-review/${caseId}/release`);
    return res.data;
  },
  getTriageReviewQueue: async (status = 'PENDING_REVIEW') => {
    const res = await apiClient.get(`/triage-review?status=${status}`);
    return res.data;
  },
  issuePrescription: async (caseId: string, payload: {
    diagnosis: string;
    medications: { name: string; dosage: string; frequency: string; duration: string; instructions?: string }[];
    doctorNotes?: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/prescription`, payload);
    return res.data;
  },
  issueEmergencyReferral: async (caseId: string, payload: {
    referralType: string;
    provisionalDiagnosis: string;
    clinicalNotes: string;
    recommendedFacility: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/emergency-referral`, payload);
    return res.data;
  },
  getPrescriptionPdfUrl: (caseId: string) => `/api/triage-review/${caseId}/prescription/pdf`,
  getReferralPdfUrl: (caseId: string) => `/api/triage-review/${caseId}/referral/pdf`,
};

// ==================== TERRA (WEARABLE) ====================
export interface TerraStatus {
  connected: boolean;
  terraUserId: string | null;
  devices: string[];
}

export interface RookStatus {
  connected: boolean;
  rookUserId: string | null;
}

export const terraApi = {
  connect: async (): Promise<{ url: string }> => {
    const res = await apiClient.post('/terra/connect');
    return res.data;
  },
  disconnect: async () => {
    const res = await apiClient.post('/terra/disconnect');
    return res.data;
  },
  getStatus: async (): Promise<TerraStatus> => {
    const res = await apiClient.get('/terra/status');
    return res.data;
  },
};

export const rookApi = {
  connect: async (): Promise<{ url: string }> => {
    const res = await apiClient.post('/rook/connect');
    return res.data;
  },
  disconnect: async () => {
    const res = await apiClient.post('/rook/disconnect');
    return res.data;
  },
  getStatus: async (): Promise<RookStatus> => {
    const res = await apiClient.get('/rook/status');
    return res.data;
  },
};

// ==================== CONSENT ====================
export const consentApi = {
  give: async (consentType: string) => {
    const res = await apiClient.post('/consent', { consentType });
    return res.data;
  },
  getAll: async () => {
    const res = await apiClient.get('/consent');
    return res.data;
  },
};

// ==================== ADMIN ====================
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
}

export const adminApi = {
  getAllUsers: async (): Promise<User[]> => {
    const res = await apiClient.get('/admin/users');
    return res.data.users || [];
  },
  updateUserStatus: async (userId: string, isActive: boolean) => {
    const res = await apiClient.patch(`/admin/users/${userId}`, { isActive });
    return res.data;
  },
  getStats: async () => {
    const res = await apiClient.get('/admin/stats');
    return res.data;
  },
  setDoctorHpcsa: async (userId: string, hcpsaNumber: string, verify = false) => {
    const res = await apiClient.patch(`/admin/users/${userId}/hpcsa`, { hcpsaNumber, verify });
    return res.data;
  },
  getDoctorHpcsa: async (userId: string) => {
    const res = await apiClient.get(`/admin/users/${userId}/hpcsa`);
    return res.data;
  },
};

// ==================== DOCTOR PROFILE ====================
export const doctorProfileApi = {
  getHpcsa: async () => {
    const res = await apiClient.get('/triage-review/profile/hpcsa');
    return res.data;
  },
  submitHpcsa: async (hcpsaNumber: string) => {
    const res = await apiClient.patch('/triage-review/profile/hpcsa', { hcpsaNumber });
    return res.data;
  },
};

export default apiClient;
