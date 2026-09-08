import { apiClient } from './client';

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
