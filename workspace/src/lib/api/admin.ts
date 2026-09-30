import { apiClient } from './client';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
  hcpsaNumber?: string | null;
  hcpsaVerified?: boolean;
  sancId?: string | null;
  sancVerificationStatus?: string | null;
  sancCategory?: string | null;
}

export type SancRegisterFinding = 'ACTIVE' | 'NOT_FOUND' | 'NAME_MISMATCH' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

export type InvitableRole = 'NURSE' | 'DOCTOR' | 'ADMIN';

export interface StaffInvite {
  id: string;
  email: string;
  role: InvitableRole;
  firstName: string | null;
  lastName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  sentCount: number;
}

export interface BpFlagValidationReport {
  sampleSize: number;
  totalCalibrationReadings?: number;
  unpairedCalibrationReadings?: number;
  pairingWindowDays?: number;
  elevatedThreshold?: { systolic: number; diastolic: number };
  confusionMatrix?: { truePositive: number; falsePositive: number; falseNegative: number; trueNegative: number };
  sensitivity?: number | null;
  specificity?: number | null;
  positivePredictiveValue?: number | null;
  caveat?: string | null;
  message?: string;
  pairs?: Array<{
    patientRef: string; // pseudonymous (keyed hash), not a user id
    calibrationReadingId: string;
    calibrationAt: string;
    elevated: boolean;
    flaggedReadingId: string;
    flaggedAt: string;
    promptBpCheck: boolean;
  }>;
}

export const adminApi = {
  getBpFlagValidationReport: async (): Promise<BpFlagValidationReport> => {
    const res = await apiClient.get('/admin/bp-flag-validation');
    return res.data;
  },
  getAllUsers: async (): Promise<User[]> => {
    const res = await apiClient.get('/admin/users');
    return res.data.users || [];
  },
  resetTwoFactor: async (userId: string, reason: string) => {
    const res = await apiClient.post(`/admin/users/${userId}/2fa/reset`, { reason });
    return res.data;
  },
  updateUserStatus: async (userId: string, isActive: boolean) => {
    const res = await apiClient.patch(`/admin/users/${userId}`, { isActive });
    return res.data;
  },
  getStats: async () => {
    const res = await apiClient.get('/admin/stats');
    return res.data;
  },
  // `confirm: 'RESET'` is required server-side too — the UI's own confirm()/
  // prompt() dialogs are client-side only and don't stop a direct API call.
  resetTrialData: async (keepUsers: boolean = true) => {
    const res = await apiClient.post('/admin/reset-trial-data', { keepUsers, confirm: 'RESET' });
    return res.data;
  },
  // Patients only: staff accounts come from an invite (sendInvite).
  createUser: async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: 'PATIENT';
  }) => {
    const res = await apiClient.post('/admin/users', data);
    return res.data;
  },
  // The returned link is shown once, for when the email doesn't arrive.
  sendInvite: async (data: { email: string; role: InvitableRole; firstName?: string; lastName?: string }): Promise<{ invite: StaffInvite; inviteLink: string }> => {
    const res = await apiClient.post('/admin/invites', data);
    return res.data;
  },
  listInvites: async (): Promise<StaffInvite[]> => {
    const res = await apiClient.get('/admin/invites');
    return res.data.invites || [];
  },
  resendInvite: async (id: string): Promise<{ invite: StaffInvite; inviteLink: string }> => {
    const res = await apiClient.post(`/admin/invites/${id}/resend`, {});
    return res.data;
  },
  revokeInvite: async (id: string) => {
    const res = await apiClient.post(`/admin/invites/${id}/revoke`, {});
    return res.data;
  },
  // Recording a check of the council's own register. `note` says what was
  // checked (required); it goes to the audit log. hcpsaNumber is omitted
  // (not sent as '') unless the admin is correcting the number.
  setDoctorHpcsa: async (userId: string, verify: boolean, note: string, hcpsaNumber?: string) => {
    const res = await apiClient.patch(`/admin/users/${userId}/hpcsa`, {
      verify,
      note,
      ...(hcpsaNumber ? { hcpsaNumber } : {}),
    });
    return res.data;
  },
  getDoctorHpcsa: async (userId: string) => {
    const res = await apiClient.get(`/admin/users/${userId}/hpcsa`);
    return res.data;
  },
  getNurseSanc: async (userId: string) => {
    const res = await apiClient.get(`/admin/users/${userId}/sanc`);
    return res.data;
  },
  // What SANC's online register showed. ACTIVE verifies; anything else flags.
  // Marking a SUSPENDED/CANCELLED registration active needs confirmStatusChange.
  recordSancCheck: async (userId: string, check: { finding: SancRegisterFinding; note: string; confirmStatusChange?: boolean }) => {
    const res = await apiClient.patch(`/admin/users/${userId}/sanc`, check);
    return res.data;
  },
};
