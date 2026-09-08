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
  resetTrialData: async (keepUsers: boolean = true) => {
    const res = await apiClient.post('/admin/reset-trial-data', { keepUsers });
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
  setDoctorHpcsa: async (userId: string, hcpsaNumber: string, verify = false) => {
    const res = await apiClient.patch(`/admin/users/${userId}/hpcsa`, { hcpsaNumber, verify });
    return res.data;
  },
  getDoctorHpcsa: async (userId: string) => {
    const res = await apiClient.get(`/admin/users/${userId}/hpcsa`);
    return res.data;
  },
};
