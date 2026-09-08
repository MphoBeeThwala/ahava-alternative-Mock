import { apiClient } from './client';

export interface TerraStatus {
  connected: boolean;
  terraUserId: string | null;
  devices: string[];
}

export interface RookStatus {
  connected: boolean;
  rookUserId: string | null;
}

export const terraApi = {
  connect: async (): Promise<{ url: string }> => {
    const res = await apiClient.post('/terra/connect');
    return res.data;
  },
  disconnect: async () => {
    const res = await apiClient.post('/terra/disconnect');
    return res.data;
  },
  getStatus: async (): Promise<TerraStatus> => {
    const res = await apiClient.get('/terra/status');
    return res.data;
  },
};

export const rookApi = {
  connect: async (): Promise<{ url: string }> => {
    const res = await apiClient.post('/rook/connect');
    return res.data;
  },
  disconnect: async () => {
    const res = await apiClient.post('/rook/disconnect');
    return res.data;
  },
  getStatus: async (): Promise<RookStatus> => {
    const res = await apiClient.get('/rook/status');
    return res.data;
  },
};
