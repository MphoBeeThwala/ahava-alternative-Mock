/**
 * Singleton Token Refresh Manager
 * Prevents race conditions and ensures only one refresh request at a time
 */

const TOKEN_KEY = "ahava_access_token";
const REFRESH_KEY = "ahava_refresh_token";

let refreshPromise: Promise<string> | null = null;

export function getAccessToken(): string | null {
  try { 
    return localStorage.getItem(TOKEN_KEY); 
  } catch { 
    return null; 
  }
}

export function getRefreshToken(): string | null {
  try { 
    return localStorage.getItem(REFRESH_KEY); 
  } catch { 
    return null; 
  }
}

export function saveTokens(access: string, refresh: string) {
  try {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  } catch {}
}

export function clearTokens() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {}
}

/**
 * Singleton token refresh - ensures only one refresh request runs at a time
 */
export async function refreshTokenOnce(): Promise<string> {
  // If refresh is already in progress, return the existing promise
  if (refreshPromise) {
    console.log("[TokenManager] Refresh already in progress, waiting...");
    return refreshPromise;
  }

  console.log("[TokenManager] Starting token refresh...");
  
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await fetch(`${window.location.origin}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Token refresh failed");
    }

    const data = await response.json();
    if (!data.accessToken) {
      throw new Error("No access token in refresh response");
    }

    saveTokens(data.accessToken, data.refreshToken || refreshToken);
    console.log("[TokenManager] Token refreshed successfully");
    return data.accessToken;
  })();

  // Clear the promise when done (whether success or failure)
  refreshPromise.finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

/**
 * Force logout and redirect to login
 */
export function forceLogout() {
  console.log("[TokenManager] Forcing logout due to auth failure");
  clearTokens();
  window.location.href = "/";
}
