import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

  const router = useRouter();

  const initiatePayment = async (params: PaymentParams) => {
    setStatus({ loading: true, error: null, paymentUrl: null, paymentId: null });

    try {
      const response = await fetch('/api/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token'),
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
    } catch (error: any) {
      setStatus({
        loading: false,
        error: error.message || 'Unknown error',
        paymentUrl: null,
        paymentId: null,
      });
    }
  };

  const checkPaymentStatus = async (paymentId: string) => {
    try {
      const response = await fetch('/api/payments/' + paymentId + '/status', {
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('token'),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to check payment status');
      }

      return await response.json();
    } catch (error: any) {
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
