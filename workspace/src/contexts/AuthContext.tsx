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
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initializeAuth = async () => {
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }

      const storedToken = localStorage.getItem('token');
      if (!storedToken) {
        setUser(null);
        setToken(null);
        setLoading(false);
        return;
      }

      try {
        // Validate persisted session against backend. This prevents stale localStorage
        // from granting temporary app access when the token/session is actually invalid.
        const data = await authApi.me();
        if (data?.user) {
          setUser(data.user as User);
          setToken(localStorage.getItem('token'));
          localStorage.setItem('user', JSON.stringify(data.user));
        } else {
          throw new Error('Missing user in /auth/me response');
        }
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
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
      localStorage.setItem('token', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
    }
    
    setToken(response.accessToken);
    setUser(response.user as User);

    // Hydrate complete user shape (includes riskProfile/onboarding state).
    try {
      const me = await authApi.me();
      if (me?.user) {
        setUser(me.user as User);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(me.user));
          const latestToken = localStorage.getItem('token');
          setToken(latestToken);
        }
      }
    } catch {
      // Non-fatal: keep login response user
    }
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

    // Fetch server profile so persisted user includes riskProfile + full fields.
    try {
      const me = await authApi.me();
      if (me?.user) {
        setUser(me.user as User);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(me.user));
          const latestToken = localStorage.getItem('token');
          setToken(latestToken);
        }
      }
    } catch {
      // Non-fatal: keep register response user
    }
  };

  const refreshUser = useCallback(async () => {
    try {
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!storedToken) return;
      const data = await authApi.me();
      if (data.user) {
        setUser(data.user as User);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(data.user));
          const latestToken = localStorage.getItem('token');
          setToken(latestToken);
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  const logout = async () => {
    try {
      if (typeof window !== 'undefined') {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          await authApi.logout(refreshToken).catch(() => {});
        }
      }
    } catch (error) {
      console.warn('Server logout failed, clearing local storage anyway');
    }
    
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
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
