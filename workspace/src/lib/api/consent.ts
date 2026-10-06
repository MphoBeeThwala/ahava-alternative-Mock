import { apiClient } from './client';

export const consentApi = {
  give: async (consentType: string, version?: string) => {
    const res = await apiClient.post('/consent', version ? { consentType, version } : { consentType });
    return res.data;
  },
  getAll: async () => {
    const res = await apiClient.get('/consent');
    return res.data;
  },
  withdraw: async (consentType: string) => {
    const res = await apiClient.delete(`/consent/${encodeURIComponent(consentType)}`);
    return res.data;
  },
};
