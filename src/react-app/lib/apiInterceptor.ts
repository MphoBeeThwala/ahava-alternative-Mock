/**
 * API Interceptor with Request Queue
 * Handles 401 responses, queues failed requests, and retries after token refresh
 */

import { refreshTokenOnce, forceLogout, getAccessToken } from "./tokenManager";

interface QueuedRequest {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

let isRefreshing = false;
let failedQueue: QueuedRequest[] = [];

/**
 * Process all queued requests after successful token refresh
 */
function processQueue(error: Error | null, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token!);
    }
  });
  failedQueue = [];
}

/**
 * Enhanced fetch with automatic token refresh and retry logic
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const originalRequest = { url, options };

  // Add auth header to initial request
  const token = getAccessToken();
  if (token) {
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  let response = await fetch(url, options);

  // If we get a 401, try to refresh and retry
  if (response.status === 401) {
    console.log("[API] Received 401, attempting token refresh...");

    // If refresh is already in progress, queue this request
    if (isRefreshing) {
      console.log("[API] Refresh in progress, queuing request...");
      return new Promise<Response>((resolve, reject) => {
        failedQueue.push({
          resolve: async (newToken) => {
            const retryOptions = {
              ...originalRequest.options,
              headers: {
                ...originalRequest.options.headers,
                Authorization: `Bearer ${newToken}`,
              },
            };
            try {
              const retryResponse = await fetch(originalRequest.url, retryOptions);
              resolve(retryResponse);
            } catch (error) {
              reject(error as Error);
            }
          },
          reject,
        });
      });
    }

    isRefreshing = true;

    try {
      const newToken = await refreshTokenOnce();
      processQueue(null, newToken);

      // Retry the original request with new token
      const retryOptions = {
        ...originalRequest.options,
        headers: {
          ...originalRequest.options.headers,
          Authorization: `Bearer ${newToken}`,
        },
      };

      console.log("[API] Retrying request with new token...");
      response = await fetch(originalRequest.url, retryOptions);
      return response;

    } catch (error) {
      console.error("[API] Token refresh failed:", error);
      processQueue(error as Error);
      forceLogout();
      throw error;
    } finally {
      isRefreshing = false;
    }
  }

  return response;
}

/**
 * Helper function for making authenticated API calls
 * Returns JSON response or throws error
 */
export async function apiCall<T = any>(
  url: string, 
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }

  return response.json();
}
