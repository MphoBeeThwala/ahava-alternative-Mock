import axios, { AxiosInstance, AxiosError } from 'axios';

// Always use same-origin /api - Next.js rewrites handle the proxy to backend
// This avoids CORS issues entirely and works in both dev and production
function getApiBaseUrl(): string {
  return '/api';
}

function isRefreshExcludedRequest(url?: string): boolean {
  if (!url) return false;
  return [
    '/auth/refresh',
    '/auth/login',
    '/auth/logout',
    '/auth/register',
  ].some((path) => url.includes(path));
}

export const COOKIE_AUTH_HEADERS = {
  'X-Ahava-Auth-Mode': 'cookie',
} as const;

// Create axios instance with default config
export const apiClient: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: keep API calls same-origin and rely on httpOnly session cookies.
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getApiBaseUrl();
    const userJson = typeof window !== 'undefined' ? localStorage.getItem('user') : null;

    // Defensive check: Prevent Patients from calling Staff/Admin endpoints in the frontend
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        const path = config.url || '';
        if (user.role === 'PATIENT') {
          const restrictedPaths = ['/admin', '/doctor', '/nurse', '/triage-cases', '/visits?status='];
          if (restrictedPaths.some(p => path.includes(p))) {
            console.error(`[API] Blocking restricted path for PATIENT: ${path}`);
            return Promise.reject(new Error('Restricted access'));
          }
        }
      } catch {}
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Track if we're already attempting refresh to avoid infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  onSuccess: () => void;
  onFailure: (error: AxiosError) => void;
}> = [];

const processQueue = (error: AxiosError | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.onFailure(error);
    } else {
      prom.onSuccess();
    }
  });
  failedQueue = [];
};

// Response interceptor with automatic token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl =
      originalRequest && typeof originalRequest.url === 'string'
        ? originalRequest.url
        : '';
    const isBootstrapMeRequest = requestUrl.includes('/auth/me');
    const hasCachedUser =
      typeof window !== 'undefined' && Boolean(localStorage.getItem('user'));

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && typeof window !== 'undefined') {
      if (isRefreshExcludedRequest(requestUrl)) {
        return Promise.reject(error);
      }
      if (isBootstrapMeRequest && !hasCachedUser) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      const path = window.location.pathname || '';

      // Don't attempt refresh if already on auth pages
      if (path.startsWith('/auth/')) {
        return Promise.reject(error);
      }

      // If the request was for a restricted path that we just blocked, don't refresh
      if (error.message === 'Restricted access') {
        return Promise.reject(error);
      }

      // Prevent multiple simultaneous refresh attempts
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          console.log('[API] Attempting to refresh session...');

          await apiClient.post('/auth/refresh', {}, {
            headers: COOKIE_AUTH_HEADERS,
          });

          console.log('[API] Session refreshed successfully');

          processQueue(null);

          return apiClient(originalRequest);
        } catch (refreshError) {
          console.error('[API] Session refresh failed:', refreshError);

          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');

          processQueue(refreshError as AxiosError);

          if (isBootstrapMeRequest) {
            return Promise.reject(refreshError);
          }

          window.location.href = '/auth/login';
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      // If already refreshing, queue this request
      return new Promise<void>((onSuccess, onFailure) => {
        failedQueue.push({ onSuccess, onFailure });
      }).then(() => {
        return apiClient(originalRequest);
      });
    }

    return Promise.reject(error);
  }
);

export default apiClient;
