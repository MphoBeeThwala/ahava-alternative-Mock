import axios, { AxiosInstance } from 'axios';

// API Base URL: use same-origin /api when unset (Next.js rewrites proxy to backend → no CORS, no env)
function normalizeApiBase(url: string): string {
  const base = url.replace(/\/+$/, '').trim();
  return base.endsWith('/api') ? base : `${base}/api`;
}
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL
  ? normalizeApiBase(process.env.NEXT_PUBLIC_API_URL)
  : '/api';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/auth/login';
      }
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
  source?: 'wearable' | 'manual';
  deviceType?: string;
}

export interface TriageRequest {
  symptoms: string;
  imageBase64?: string;
}

export interface TriageResponse {
  success: boolean;
  data: {
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
  address: string;
  encryptedAddress: string;
  amountInCents: number;
  patientLat: number;
  patientLng: number;
  notes?: string;
}

export interface Booking {
  id: string;
  patientId: string;
  scheduledDate: string;
  status: string;
  address: string;
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
export const doctorApi = {
  getPendingVisits: async () => {
    const res = await apiClient.get('/visits?status=PENDING_REVIEW');
    return res.data;
  },
  approveVisit: async (visitId: string) => {
    const res = await apiClient.post(`/visits/${visitId}/approve`);
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
};

export default apiClient;

