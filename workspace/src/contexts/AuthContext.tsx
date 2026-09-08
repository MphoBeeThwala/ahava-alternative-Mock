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
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateCurrentUser: (patch: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeRiskProfilePreservingPassport(
  currentRiskProfile: unknown,
  incomingRiskProfile: unknown,
): Record<string, unknown> | null | undefined {
  const incoming = asRecord(incomingRiskProfile);
  if (!incoming) {
    return incomingRiskProfile as Record<string, unknown> | null | undefined;
  }

  const current = asRecord(currentRiskProfile);
  if (!current) {
    return incoming;
  }

  const incomingHasPassportData =
    Object.prototype.hasOwnProperty.call(incoming, 'medicalPassport') ||
    Object.prototype.hasOwnProperty.call(incoming, 'passportCompletionPercent') ||
    Object.prototype.hasOwnProperty.call(incoming, 'nextPassportQuestion');

  if (incomingHasPassportData) {
    return incoming;
  }

  const currentHasPassportData =
    Object.prototype.hasOwnProperty.call(current, 'medicalPassport') ||
    Object.prototype.hasOwnProperty.call(current, 'passportCompletionPercent') ||
    Object.prototype.hasOwnProperty.call(current, 'nextPassportQuestion');

  if (!currentHasPassportData) {
    return incoming;
  }

  return {
    ...incoming,
    ...(Object.prototype.hasOwnProperty.call(current, 'medicalPassport')
      ? { medicalPassport: current.medicalPassport }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'passportCompletionPercent')
      ? { passportCompletionPercent: current.passportCompletionPercent }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(current, 'nextPassportQuestion')
      ? { nextPassportQuestion: current.nextPassportQuestion }
      : {}),
  };
}

function mergeUserPreservingPassport(currentUser: User | null, incomingUser: User): User {
  return {
    ...incomingUser,
    riskProfile: mergeRiskProfilePreservingPassport(
      currentUser?.riskProfile,
      incomingUser.riskProfile,
    ),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const updateCurrentUser = useCallback((patch: Partial<User>) => {
    setUser((currentUser) => {
      if (!currentUser) return currentUser;
      const nextUser = { ...currentUser, ...patch } as User;
      if (Object.prototype.hasOwnProperty.call(patch, 'riskProfile')) {
        nextUser.riskProfile = mergeRiskProfilePreservingPassport(
          currentUser.riskProfile,
          patch.riskProfile,
        );
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('user', JSON.stringify(nextUser));
      }
      return nextUser;
    });
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }

      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        setUser(null);
        setToken(null);
        setLoading(false);
        return;
      }

      try {
        const data = await authApi.me();
        if (data?.user) {
          const parsedStoredUser = JSON.parse(storedUser) as User;
          const mergedUser = mergeUserPreservingPassport(
            parsedStoredUser,
            data.user as User,
          );
          setUser(mergedUser);
          setToken('cookie-session');
          localStorage.setItem('user', JSON.stringify(mergedUser));
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('ahava_access_token');
          localStorage.removeItem('ahava_refresh_token');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refresh_token');
        } else {
          throw new Error('Missing user in /auth/me response');
        }
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('ahava_access_token');
        localStorage.removeItem('ahava_refresh_token');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setUser(null);
        setToken(null);
      } finally {
        setLoading(false);
      }
    };

    void initializeAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response: AuthResponse = await authApi.login({ email, password });
    
    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(response.user));
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('ahava_access_token');
      localStorage.removeItem('ahava_refresh_token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refresh_token');
    }
    
    setToken('cookie-session');
    setUser(response.user as User);

    // Hydrate complete user shape (includes riskProfile/onboarding state).
    try {
      const me = await authApi.me();
      if (me?.user) {
        const mergedUser = mergeUserPreservingPassport(response.user as User, me.user as User);
        setUser(mergedUser);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(mergedUser));
          setToken('cookie-session');
        }
      }
    } catch {
      // Non-fatal: keep login response user
    }
  };

  const register = async (data: RegisterData) => {
    const response: AuthResponse = await authApi.register(data);
    
    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(response.user));
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('ahava_access_token');
      localStorage.removeItem('ahava_refresh_token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refresh_token');
    }
    
    setToken('cookie-session');
    setUser(response.user as User);

    // Fetch server profile so persisted user includes riskProfile + full fields.
    try {
      const me = await authApi.me();
      if (me?.user) {
        const mergedUser = mergeUserPreservingPassport(response.user as User, me.user as User);
        setUser(mergedUser);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(mergedUser));
          setToken('cookie-session');
        }
      }
    } catch {
      // Non-fatal: keep register response user
    }
  };

  const refreshUser = useCallback(async () => {
    try {
      const data = await authApi.me();
      if (data.user) {
        setUser((currentUser) => {
          const mergedUser = mergeUserPreservingPassport(currentUser, data.user as User);
          if (typeof window !== 'undefined') {
            localStorage.setItem('user', JSON.stringify(mergedUser));
            setToken('cookie-session');
          }
          return mergedUser;
        });
      }
    } catch { /* non-fatal */ }
  }, []);

  const logout = async () => {
    try {
      await authApi.logout().catch(() => {});
    } catch (error) {
      console.warn('Server logout failed, clearing local storage anyway');
    }
    
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('ahava_access_token');
      localStorage.removeItem('ahava_refresh_token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
    }
    
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
        updateCurrentUser,
        isAuthenticated: !!user && !!token,
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
