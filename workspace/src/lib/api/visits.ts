import { apiClient } from './client';

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
