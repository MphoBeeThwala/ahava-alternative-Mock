import { apiClient } from './client';

export interface AddressSuggestion { placeId: string; text: string }
export interface ResolvedPlace { address: string; lat: number; lng: number }

/**
 * Address search for booking, proxied by the backend (the Google key never
 * reaches the browser). `available: false` means maps are off, capped or
 * failing: keep the manual address field and the device location.
 */
export const placesApi = {
  config: async (): Promise<{ enabled: boolean }> => {
    const res = await apiClient.get('/places/config');
    return { enabled: !!res.data?.enabled };
  },
  autocomplete: async (input: string, sessionToken: string): Promise<{ available: boolean; suggestions: AddressSuggestion[] }> => {
    const res = await apiClient.get('/places/autocomplete', { params: { input, sessionToken } });
    return { available: !!res.data?.available, suggestions: res.data?.suggestions ?? [] };
  },
  details: async (placeId: string, sessionToken: string): Promise<{ available: boolean; place?: ResolvedPlace }> => {
    const res = await apiClient.get('/places/details', { params: { placeId, sessionToken } });
    return { available: !!res.data?.available, place: res.data?.place };
  },
};
