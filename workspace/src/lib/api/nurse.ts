import { apiClient } from './client';

export interface NurseAvailability {
  lat: number;
  lng: number;
  isAvailable: boolean;
}

export const nurseApi = {
  updateAvailability: async (data: NurseAvailability) => {
    const res = await apiClient.post('/nurse/availability', data);
    return res.data;
  },
  getMyVisits: async () => {
    // Use /visits endpoint which automatically filters by role (nurse)
    const res = await apiClient.get('/visits');
    return res.data;
  },
  getProfile: async () => {
    // Use /auth/me to get current user profile
    const res = await apiClient.get('/auth/me');
    // Return user data with location info
    return {
      user: res.data.user,
      isAvailable: res.data.user?.isAvailable || false,
      latitude: res.data.user?.lastKnownLat,
      longitude: res.data.user?.lastKnownLng,
    };
  },
};
