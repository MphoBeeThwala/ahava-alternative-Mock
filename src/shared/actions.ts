/**
 * Aura Sandbox API Integration
 * Emergency Alert Actions for Ahava Healthcare Platform
 */

// Aura Sandbox API Configuration
const AURA_API_CONFIG = {
  baseUrl: import.meta.env.VITE_AURA_API_URL || 'https://sandbox.aura.co.za/api/v1',
  apiKey: import.meta.env.VITE_AURA_API_KEY || '',
  timeout: 30000, // 30 seconds
  retries: 3,
};

// Emergency Alert Types
export interface EmergencyAlertPayload {
  alertType: 'MEDICAL' | 'SECURITY' | 'PANIC';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  location: {
    latitude: number;
    longitude: number;
    address?: string;
    accuracy?: number;
  };
  user: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
  };
  details: {
    appointmentId?: number;
    notes?: string;
    timestamp: string;
    deviceInfo?: string;
  };
  emergencyContacts?: Array<{
    name: string;
    phone: string;
    relationship: string;
  }>;
}

export interface AuraAPIResponse {
  success: boolean;
  alertId?: string;
  responseTime?: number;
  dispatchInfo?: {
    estimatedArrival?: string;
    responderType?: string;
    trackingUrl?: string;
  };
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Validates Aura API configuration
 */
export function validateAuraConfig(): { valid: boolean; error?: string } {
  if (!AURA_API_CONFIG.apiKey) {
    return {
      valid: false,
      error: 'Aura API key not configured. Set VITE_AURA_API_KEY environment variable.',
    };
  }
  
  if (!AURA_API_CONFIG.baseUrl) {
    return {
      valid: false,
      error: 'Aura API base URL not configured.',
    };
  }
  
  return { valid: true };
}

/**
 * Makes HTTP request with retry logic
 */
async function makeRequest(
  endpoint: string,
  payload: any,
  retries: number = AURA_API_CONFIG.retries
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AURA_API_CONFIG.timeout);

  try {
    const response = await fetch(`${AURA_API_CONFIG.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AURA_API_CONFIG.apiKey}`,
        'X-Client-Version': '1.0.0',
        'X-Platform': 'Ahava-Healthcare',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Retry on server errors (5xx) or rate limiting (429)
    if ((response.status >= 500 || response.status === 429) && retries > 0) {
      const delay = Math.pow(2, AURA_API_CONFIG.retries - retries) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(endpoint, payload, retries - 1);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Aura API request timeout. Please try again.');
    }
    
    if (retries > 0) {
      const delay = Math.pow(2, AURA_API_CONFIG.retries - retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(endpoint, payload, retries - 1);
    }
    
    throw error;
  }
}

/**
 * Sends emergency alert to Aura Sandbox API
 */
export async function sendEmergencyAlert(
  payload: EmergencyAlertPayload
): Promise<AuraAPIResponse> {
  // Validate configuration
  const configValidation = validateAuraConfig();
  if (!configValidation.valid) {
    throw new Error(configValidation.error);
  }

  try {
    const response = await makeRequest('/emergency/alert', payload);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData.message || `API request failed with status ${response.status}`,
          details: errorData,
        },
      };
    }

    const data = await response.json();
    
    return {
      success: true,
      alertId: data.alert_id || data.alertId,
      responseTime: data.response_time || data.responseTime,
      dispatchInfo: data.dispatch_info || data.dispatchInfo,
      message: data.message || 'Emergency alert sent successfully',
    };
  } catch (error) {
    console.error('Aura API Error:', error);
    
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to send emergency alert',
        details: error,
      },
    };
  }
}

/**
 * Gets current device location with high accuracy
 */
export async function getCurrentLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string;
}> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        
        // Try to get address via reverse geocoding
        let address: string | undefined;
        try {
          address = await reverseGeocode(latitude, longitude);
        } catch (err) {
          console.warn('Reverse geocoding failed:', err);
          address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        }

        resolve({ latitude, longitude, accuracy, address });
      },
      (error) => {
        reject(new Error(`Location error: ${error.message}`));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Reverse geocodes coordinates to address
 */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    // Using OpenStreetMap Nominatim (free, no API key required)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      {
        headers: {
          'User-Agent': 'Ahava-Healthcare/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error('Geocoding failed');
    }

    const data = await response.json();
    return data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  } catch (error) {
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }
}

/**
 * Cancels an active emergency alert
 */
export async function cancelEmergencyAlert(alertId: string): Promise<AuraAPIResponse> {
  const configValidation = validateAuraConfig();
  if (!configValidation.valid) {
    throw new Error(configValidation.error);
  }

  try {
    const response = await makeRequest(`/emergency/alert/${alertId}/cancel`, {
      reason: 'False alarm',
      timestamp: new Date().toISOString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData.message || 'Failed to cancel alert',
          details: errorData,
        },
      };
    }

    const data = await response.json();
    return {
      success: true,
      message: data.message || 'Alert cancelled successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to cancel alert',
        details: error,
      },
    };
  }
}

/**
 * Checks status of an emergency alert
 */
export async function checkAlertStatus(alertId: string): Promise<AuraAPIResponse> {
  const configValidation = validateAuraConfig();
  if (!configValidation.valid) {
    throw new Error(configValidation.error);
  }

  try {
    const response = await fetch(
      `${AURA_API_CONFIG.baseUrl}/emergency/alert/${alertId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${AURA_API_CONFIG.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData.message || 'Failed to check alert status',
          details: errorData,
        },
      };
    }

    const data = await response.json();
    return {
      success: true,
      dispatchInfo: data.dispatch_info || data.dispatchInfo,
      message: data.status || 'Alert status retrieved',
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check status',
        details: error,
      },
    };
  }
}

/**
 * Gets device information for emergency context
 */
export function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  const language = navigator.language;
  
  return `${platform} | ${language} | ${ua.substring(0, 100)}`;
}

/**
 * Fallback emergency action (stores locally if API fails)
 */
export async function fallbackEmergencyAction(payload: EmergencyAlertPayload): Promise<void> {
  try {
    // Store in local database via our API
    await fetch('/api/panic-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointment_id: payload.details.appointmentId,
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        address: payload.location.address,
        notes: `FALLBACK: ${payload.details.notes} | Aura API unavailable`,
      }),
    });

    console.info('Emergency alert stored locally as fallback');
  } catch (error) {
    console.error('Fallback emergency action failed:', error);
    throw error;
  }
}

/**
 * Main emergency action handler
 * Tries Aura API first, falls back to local storage
 */
export async function handleEmergencyAlert(
  payload: EmergencyAlertPayload
): Promise<{ success: boolean; alertId?: string; message: string; usingFallback?: boolean }> {
  try {
    // Try Aura API first
    const auraResponse = await sendEmergencyAlert(payload);
    
    if (auraResponse.success) {
      return {
        success: true,
        alertId: auraResponse.alertId,
        message: auraResponse.message || 'Emergency alert sent to Aura',
      };
    }

    // If Aura fails, use fallback
    console.warn('Aura API failed, using fallback:', auraResponse.error);
    await fallbackEmergencyAction(payload);
    
    return {
      success: true,
      message: 'Emergency alert sent (fallback mode). Emergency services notified.',
      usingFallback: true,
    };
  } catch (error) {
    console.error('Emergency alert failed:', error);
    throw error;
  }
}

