import { apiClient } from './client';

export type AccessGrantReason =
  | 'VISIT_ASSIGNMENT'
  | 'TRIAGE_CASE'
  | 'VISIT_REVIEW'
  | 'MONITORING'
  | 'ADMIN_GRANT'
  | 'BREAK_GLASS';

export const ACCESS_REASON_LABEL: Record<AccessGrantReason, string> = {
  VISIT_ASSIGNMENT: 'Home visit',
  TRIAGE_CASE: 'Triage case',
  VISIT_REVIEW: 'Visit review',
  MONITORING: 'Remote monitoring',
  ADMIN_GRANT: 'Authorised by an administrator',
  BREAK_GLASS: 'Emergency access',
};

export interface MyAccessGrant {
  id: string;
  patient: { id: string; name: string };
  reason: AccessGrantReason;
  sourceId: string | null;
  startsAt: string;
  expiresAt: string;
}

export interface AdminAccessGrant {
  id: string;
  clinician: { id: string; firstName: string; lastName: string; role: string; sancId: string | null; hcpsaNumber: string | null };
  patient: { id: string; name: string };
  reason: AccessGrantReason;
  justification: string | null;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING';
}

export interface PatientAccessLogEntry {
  id: string;
  clinician: { name: string; role: string; registration: { body: 'SANC' | 'HPCSA'; number: string | null } };
  reason: AccessGrantReason;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING';
}

export const accessApi = {
  // Clinicians
  getMine: async (): Promise<MyAccessGrant[]> => {
    const res = await apiClient.get('/access-grants/mine');
    return res.data?.grants ?? [];
  },
  breakGlass: async (patientId: string, justification: string) => {
    const res = await apiClient.post('/access-grants/break-glass', { patientId, justification });
    return res.data;
  },
  getPatientRecord: async (patientId: string) => {
    const res = await apiClient.get(`/patient-records/${patientId}`);
    return res.data;
  },
  // Patients
  getMyRecordAccess: async (): Promise<PatientAccessLogEntry[]> => {
    const res = await apiClient.get('/access-grants/my-record');
    return res.data?.access ?? [];
  },
  // Admins
  list: async (view: 'active' | 'break-glass-review' | 'all' = 'active'): Promise<AdminAccessGrant[]> => {
    const res = await apiClient.get(`/access-grants?view=${view}`);
    return res.data?.grants ?? [];
  },
  grant: async (data: { clinicianId: string; patientId: string; hours: number; justification: string }) => {
    const res = await apiClient.post('/access-grants', data);
    return res.data;
  },
  revoke: async (id: string, reason: string) => {
    const res = await apiClient.post(`/access-grants/${id}/revoke`, { reason });
    return res.data;
  },
  reviewBreakGlass: async (id: string, note: string) => {
    const res = await apiClient.post(`/access-grants/${id}/review`, { note });
    return res.data;
  },
};
