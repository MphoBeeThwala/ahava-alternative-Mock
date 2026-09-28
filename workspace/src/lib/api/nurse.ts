import { apiClient } from './client';

// lat/lng are required to go online; going offline may omit them so the
// last known location isn't overwritten.
export type NurseAvailability =
  | { isAvailable: true; lat: number; lng: number }
  | { isAvailable: false; lat?: number; lng?: number };

export const nurseApi = {
  updateAvailability: async (data: NurseAvailability) => {
    // The backend route is PATCH; this used to POST, which 404'd ("Route not found").
    const res = await apiClient.patch('/nurse/availability', data);
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
