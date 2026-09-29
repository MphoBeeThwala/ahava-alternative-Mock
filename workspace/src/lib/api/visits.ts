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
    patient?: { firstName?: string; lastName?: string };
    scheduledDate?: string;
  };
  doctorId?: string | null;
  /**
   * Set when the caller may see that the visit exists but not the patient's
   * record: NOT_CLAIMED (unclaimed review), ACCESS_EXPIRED (care access has
   * ended), ADMIN_VIEW (operations view). Clinical fields are absent.
   */
  restricted?: 'NOT_CLAIMED' | 'ACCESS_EXPIRED' | 'ADMIN_VIEW';
  patientAge?: number | null;
  patientSex?: string | null;
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
  // BP-calibration reading during an in-progress visit (docs/ENGINEERING_PLAN.md
  // #32). Backend requires the visit to be IN_PROGRESS and the caller to be
  // the assigned nurse.
  recordBiometrics: async (
    id: string,
    data: {
      bloodPressureSystolic: number;
      bloodPressureDiastolic: number;
      heartRate?: number;
      temperature?: number;
      oxygenSaturation?: number;
    },
  ) => {
    const res = await apiClient.post(`/visits/${id}/biometrics`, data);
    return res.data;
  },
};
