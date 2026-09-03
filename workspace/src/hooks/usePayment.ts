import { useState } from 'react';

export interface PaymentParams {
  amount: number;
  bookingId?: string;
  triageCaseId?: string;
  type: 'NURSE_VISIT' | 'TELEMEDICINE_CONSULT' | 'OTHER';
}

export interface PaymentStatus {
  loading: boolean;
  error: string | null;
  paymentUrl: string | null;
  paymentId: string | null;
}

export function usePayment() {
  const [status, setStatus] = useState<PaymentStatus>({
    loading: false,
    error: null,
    paymentUrl: null,
    paymentId: null,
  });

  const initiatePayment = async (params: PaymentParams) => {
    setStatus({ loading: true, error: null, paymentUrl: null, paymentId: null });

    try {
      const response = await fetch('/api/payments/create', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error('Payment initialization failed');
      }

      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      }

      setStatus({
        loading: false,
        error: null,
        paymentUrl: data.url,
        paymentId: data.paymentId,
      });
    } catch (error) {
      setStatus({
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        paymentUrl: null,
        paymentId: null,
      });
    }
  };

  const checkPaymentStatus = async (paymentId: string) => {
    try {
      const response = await fetch('/api/payments/' + paymentId + '/status', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to check payment status');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  };

  return {
    status,
    initiatePayment,
    checkPaymentStatus,
  };
}

export default usePayment;
