/**
 * React Auth Provider and Hooks
 * JWT token-based auth — tokens stored in localStorage.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase } from "@/react-app/lib/native";
import { getAccessToken, saveTokens, clearTokens } from "./tokenManager";
import { apiCall } from "./apiInterceptor";

/** Bearer Authorization header for use in any fetch call */
export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: string;
  emailVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authReady: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, password: string, name: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate auth state before rendering any routes
  useEffect(() => {
    validateAuthState();
  }, []);

  const validateAuthState = async () => {
    console.log("[Auth] Validating auth state before rendering...");
    try {
      const token = getAccessToken();
      if (!token) {
        console.log("[Auth] No token found, auth ready");
        setAuthReady(true);
        setLoading(false);
        return;
      }

      // Try to validate current token by fetching user
      await fetchUser();
      console.log("[Auth] Auth validation completed");
    } catch (error) {
      console.error("[Auth] Auth validation failed:", error);
      clearTokens();
      setUser(null);
    } finally {
      setAuthReady(true);
      setLoading(false);
    }
  };

  const fetchUser = async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setUser(null);
        return;
      }
      
      const data = await apiCall<{ user: any }>(`${getApiBase()}/api/auth/me`);
      if (data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          firstName: data.user.firstName ?? "",
          lastName: data.user.lastName ?? "",
          name: `${data.user.firstName ?? ""} ${data.user.lastName ?? ""}`.trim(),
          role: data.user.role ?? "PATIENT",
          emailVerified: data.user.isVerified ?? false,
        });
      } else {
        clearTokens();
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to fetch user:", err);
      clearTokens();
      setUser(null);
      throw err;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      setError(null);
      setLoading(true);

      const data = await apiCall<any>(`${getApiBase()}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      saveTokens(data.accessToken, data.refreshToken);
      setUser({
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.firstName ?? "",
        lastName: data.user.lastName ?? "",
        name: `${data.user.firstName ?? ""} ${data.user.lastName ?? ""}`.trim(),
        role: data.user.role ?? "PATIENT",
        emailVerified: data.user.isVerified ?? false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    try {
      setError(null);
      // Use window.location.replace to force full page navigation, bypassing React Router
      window.location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: "777610666014-k511674q64a85633o8e633d772922115.apps.googleusercontent.com",
        redirect_uri: window.location.origin + "/api/auth/google/callback",
        response_type: "code",
        scope: "email profile openid",
        access_type: "offline",
        state: "google_login",
        prompt: "consent",
      }).toString();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google login failed";
      setError(message);
      throw err;
    }
  };

  const signup = async (email: string, password: string, name: string, role = "PATIENT") => {
    try {
      setError(null);
      setLoading(true);

      const parts = name.trim().split(" ");
      const firstName = parts[0] ?? name;
      const lastName = (parts.slice(1).join(" ") || parts[0]) ?? "";

      const data = await apiCall<any>(`${getApiBase()}/api/auth/register`, {
        method: "POST",
        body: JSON.stringify({ email, password, firstName, lastName, role }),
      });

      saveTokens(data.accessToken, data.refreshToken);
      setUser({
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.firstName ?? firstName,
        lastName: data.user.lastName ?? lastName,
        name: `${data.user.firstName ?? firstName} ${data.user.lastName ?? lastName}`.trim(),
        role: data.user.role ?? role,
        emailVerified: data.user.isVerified ?? false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setError(null);
      const refreshToken = localStorage.getItem("ahava_refresh_token");
      if (refreshToken) {
        await apiCall(`${getApiBase()}/api/auth/logout`, {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
      }
      clearTokens();
      setUser(null);
    } catch (err) {
      clearTokens();
      setUser(null);
    }
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authReady,
        error,
        login,
        loginWithGoogle,
        signup,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  
  return context;
}

/**
 * Protected route wrapper
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#004aad]"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}

