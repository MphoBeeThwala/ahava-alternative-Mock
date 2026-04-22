'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, AuthResponse, RegisterData } from '../lib/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  isActive: boolean;
  isVerified: boolean;
  preferredLanguage?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  riskProfile?: Record<string, unknown> | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  /** True while we're still validating the stored session against the backend */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** Merge a partial user update into both React state and localStorage */
  updateUser: (patch: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readStoredSession(): { token: string | null; user: User | null; refreshToken: string | null } {
  if (typeof window === 'undefined') return { token: null, user: null, refreshToken: null };
  const token = localStorage.getItem('token');
  const refreshToken = localStorage.getItem('refreshToken');
  const raw = localStorage.getItem('user');
  let user: User | null = null;
  if (raw) {
    try { user = JSON.parse(raw) as User; } catch { user = null; }
  }
  return { token, user, refreshToken };
}

function clearStoredSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

/**
 * Call /api/auth/me with the stored token — bypassing the axios interceptor —
 * so we can positively confirm the stored session is still valid before we
 * mark the user "authenticated". Without this check, a stale/expired token in
 * localStorage causes the login page to flash-redirect to the dashboard
 * ("login gets skipped"), and every first-page-load ends in a 401 storm.
 */
async function validateStoredToken(token: string): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.user ?? null) as User | null;
  } catch {
    return null;
  }
}

/** Silent refresh on app boot — bypasses interceptor to avoid recursion */
async function silentRefresh(refreshToken: string): Promise<{ accessToken: string; user: User } | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.accessToken || !data?.refreshToken || !data?.user) return null;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    return { accessToken: data.accessToken, user: data.user as User };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // Start in loading state — we don't know yet whether the stored token is valid.
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = readStoredSession();

      // Nothing stored → not authenticated, stop loading.
      if (!stored.token || !stored.user) {
        clearStoredSession();
        if (!cancelled) setLoading(false);
        return;
      }

      // Optimistically hydrate from storage so UI doesn't flash while we validate.
      if (!cancelled) {
        setUser(stored.user);
        setToken(stored.token);
      }

      // Validate with the backend. If the token is dead, clear state immediately
      // so the login page doesn't auto-redirect us into a broken dashboard.
      const validated = await validateStoredToken(stored.token);
      if (cancelled) return;

      if (validated) {
        setUser(validated);
        setToken(stored.token);
        try { localStorage.setItem('user', JSON.stringify(validated)); } catch { /* noop */ }
      } else {
        // Try a silent refresh one time before giving up
        const refreshed = stored.refreshToken ? await silentRefresh(stored.refreshToken) : null;
        if (cancelled) return;
        if (refreshed) {
          setUser(refreshed.user);
          setToken(refreshed.accessToken);
        } else {
          clearStoredSession();
          setUser(null);
          setToken(null);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    const response: AuthResponse = await authApi.login({ email, password });

    if (typeof window !== 'undefined') {
      localStorage.setItem('token', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
    }

    setToken(response.accessToken);
    setUser(response.user as User);
  };

  const register = async (data: RegisterData) => {
    const response: AuthResponse = await authApi.register(data);

    if (typeof window !== 'undefined') {
      localStorage.setItem('token', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
    }

    setToken(response.accessToken);
    setUser(response.user as User);
  };

  /**
   * Imperatively merge a partial user update into both React state and
   * localStorage. Use this right after a mutation (e.g. the risk-profile
   * survey save) so the rest of the app sees the fresh state *immediately*
   * — without waiting for a slow /auth/me roundtrip that might 401 and
   * leave the context stale, which was the root of the "stuck on profile /
   * can't transact" bug.
   */
  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      const next = prev ? ({ ...prev, ...patch } as User) : prev;
      if (next && typeof window !== 'undefined') {
        try { localStorage.setItem('user', JSON.stringify(next)); } catch { /* noop */ }
      }
      return next;
    });
  }, []);

  /**
   * Refresh the in-memory user from /auth/me. If the call 401s we attempt
   * a one-shot silent refresh and retry once. Any failure is non-fatal —
   * we just keep the previous state rather than nuking it, which used to
   * cause transient logouts on flaky networks.
   */
  const refreshUser = useCallback(async () => {
    const doFetch = async (bearer: string) => fetch('/api/auth/me', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${bearer}` },
    });

    try {
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!storedToken) return;
      let res = await doFetch(storedToken);
      if (res.status === 401) {
        const rt = localStorage.getItem('refreshToken');
        const refreshed = rt ? await silentRefresh(rt) : null;
        if (!refreshed) return;
        setToken(refreshed.accessToken);
        res = await doFetch(refreshed.accessToken);
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data?.user) {
        setUser(data.user as User);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('user', JSON.stringify(data.user)); } catch { /* noop */ }
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  const logout = async () => {
    try {
      // Call backend logout to invalidate refresh token in database
      // Use a direct API call without the interceptor to avoid redirect loop
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${storedToken}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch {
      console.warn('Server logout failed, clearing local storage anyway');
    }

    clearStoredSession();
    setToken(null);
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        refreshUser,
        updateUser,
        isAuthenticated: !loading && !!user && !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
