import { apiClient } from './client';

export interface CreateBookingData {
  scheduledDate: string; // ISO date string
  address?: string;
  encryptedAddress: string;
  amountInCents: number;
  patientLat: number;
  patientLng: number;
  notes?: string;
  estimatedDuration?: number;
  paymentMethod?: string;
}

export interface Booking {
  id: string;
  patientId: string;
  scheduledDate: string;
  status: string;
  address?: string;
  encryptedAddress?: string;
  amountInCents: number;
  createdAt: string;
  updatedAt: string;
}

export const bookingsApi = {
  create: async (data: CreateBookingData) => {
    const res = await apiClient.post('/bookings', data);
    return res.data;
  },
  getMyBookings: async () => {
    // Use /bookings endpoint which automatically filters by role (patient)
    const res = await apiClient.get('/bookings');
    return res.data;
  },
  getById: async (id: string) => {
    const res = await apiClient.get(`/bookings/${id}`);
    return res.data;
  },
  cancel: async (id: string) => {
    const res = await apiClient.patch(`/bookings/${id}/cancel`);
    return res.data;
  },
};
