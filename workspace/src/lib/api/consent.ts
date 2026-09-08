import { apiClient } from './client';

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
