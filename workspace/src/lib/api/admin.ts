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
  // `confirm: 'RESET'` is required server-side too — the UI's own confirm()/
  // prompt() dialogs are client-side only and don't stop a direct API call.
  resetTrialData: async (keepUsers: boolean = true) => {
    const res = await apiClient.post('/admin/reset-trial-data', { keepUsers, confirm: 'RESET' });
    return res.data;
  },
  createUser: async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  }) => {
    const res = await apiClient.post('/admin/users', data);
    return res.data;
  },
  // hcpsaNumber is omitted (not sent as '') when only the verified flag is
  // changing — the backend requires a non-empty string when this field is
  // present at all.
  setDoctorHpcsa: async (userId: string, verify: boolean, hcpsaNumber?: string) => {
    const res = await apiClient.patch(`/admin/users/${userId}/hpcsa`, {
      verify,
      ...(hcpsaNumber ? { hcpsaNumber } : {}),
    });
    return res.data;
  },
  getDoctorHpcsa: async (userId: string) => {
    const res = await apiClient.get(`/admin/users/${userId}/hpcsa`);
    return res.data;
  },
};
