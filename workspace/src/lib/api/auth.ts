import { apiClient, COOKIE_AUTH_HEADERS } from './client';

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  preferredLanguage?: string;
  // Patients only: the optional, unticked-by-default research opt-in on the sign-up form.
  researchConsent?: boolean;
  // Staff only: the token from the invite link an admin sent them.
  inviteToken?: string;
  sancRegistrationNumber?: string;
  hpcsaNumber?: string;
}

export interface StaffInviteDetails {
  email: string;
  role: 'NURSE' | 'DOCTOR' | 'ADMIN';
  firstName: string | null;
  lastName: string | null;
  expiresAt: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
    isActive: boolean;
    isVerified: boolean;
    preferredLanguage?: string;
  };
  accessToken?: string;
  refreshToken?: string;
}

// AH-29: an account with opt-in 2FA enabled gets this instead of AuthResponse
// from /auth/login — no session exists yet, only a 5-minute pendingToken.
export interface TwoFactorRequiredResponse {
  success: true;
  twoFactorRequired: true;
  pendingToken: string;
}

export function isTwoFactorRequired(
  response: AuthResponse | TwoFactorRequiredResponse | GoogleLinkRequiredResponse,
): response is TwoFactorRequiredResponse {
  return (response as TwoFactorRequiredResponse).twoFactorRequired === true;
}

// Sign in with Google (patients only). Either a session (AuthResponse), the 2FA
// step, or "this email already has a password account: confirm it to link".
export interface GoogleLinkRequiredResponse {
  success: false;
  linkRequired: true;
  linkToken: string;
  email: string;
  needsTwoFactorCode: boolean;
}

export function isGoogleLinkRequired(
  response: AuthResponse | TwoFactorRequiredResponse | GoogleLinkRequiredResponse,
): response is GoogleLinkRequiredResponse {
  return (response as GoogleLinkRequiredResponse).linkRequired === true;
}

export const authApi = {
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/register', data, {
      headers: COOKIE_AUTH_HEADERS,
    });
    return res.data;
  },
  getInvite: async (token: string): Promise<StaffInviteDetails> => {
    const res = await apiClient.get(`/auth/invites/${encodeURIComponent(token)}`);
    return res.data.invite;
  },
  login: async (data: LoginData): Promise<AuthResponse | TwoFactorRequiredResponse> => {
    const res = await apiClient.post('/auth/login', data, {
      headers: COOKIE_AUTH_HEADERS,
    });
    return res.data;
  },
  // AH-29: completes a login that returned twoFactorRequired.
  verifyTwoFactorLogin: async (pendingToken: string, code: string): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/2fa/login-verify', { pendingToken, code }, {
      headers: COOKIE_AUTH_HEADERS,
    });
    return res.data;
  },
  /** Returns the pending key (the same one until setup is confirmed) unless `regenerate` is set. */
  setupTwoFactor: async (regenerate = false): Promise<{ success: boolean; secret: string; otpauthUrl: string }> => {
    const res = await apiClient.post('/auth/2fa/setup', regenerate ? { regenerate: true } : {});
    return res.data;
  },
  verifyTwoFactorSetup: async (code: string): Promise<{ success: boolean; backupCodes: string[] }> => {
    const res = await apiClient.post('/auth/2fa/verify-setup', { code });
    return res.data;
  },
  disableTwoFactor: async (password: string, code: string): Promise<{ success: boolean }> => {
    const res = await apiClient.post('/auth/2fa/disable', { password, code });
    return res.data;
  },
  refreshToken: async (): Promise<AuthResponse> => {
    const res = await apiClient.post('/auth/refresh', {}, {
      headers: COOKIE_AUTH_HEADERS,
    });
    return res.data;
  },
  forgotPassword: async (email: string) => {
    const res = await apiClient.post('/auth/forgot-password', { email });
    return res.data;
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const res = await apiClient.post('/auth/change-password', { currentPassword, newPassword });
    return res.data;
  },
  resetPassword: async (token: string, password: string) => {
    const res = await apiClient.post('/auth/reset-password', { token, password });
    return res.data;
  },
  verifyEmail: async (token: string) => {
    const res = await apiClient.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    return res.data;
  },
  me: async () => {
    // Bust intermediary/browser caches so auth state (role/riskProfile) is always fresh.
    const res = await apiClient.get(`/auth/me?t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    return res.data;
  },
  logout: async () => {
    const res = await apiClient.post('/auth/logout', {});
    return res.data;
  },
  /** Prove a fresh second factor for a sensitive action (backend middleware/stepUp.ts). */
  stepUp: async (code: string): Promise<{ success: boolean; validForSeconds: number }> => {
    const res = await apiClient.post('/auth/2fa/step-up', { code });
    return res.data;
  },
  googleConfig: async (): Promise<{ enabled: boolean; clientId: string | null }> => {
    const res = await apiClient.get('/auth/google/config');
    return res.data;
  },
  googleNonce: async (): Promise<string> => {
    const res = await apiClient.post('/auth/google/nonce', {});
    return res.data.nonce;
  },
  googleSignIn: async (
    credential: string,
  ): Promise<AuthResponse | TwoFactorRequiredResponse | GoogleLinkRequiredResponse> => {
    const res = await apiClient.post('/auth/google', { credential }, { headers: COOKIE_AUTH_HEADERS });
    return res.data;
  },
  googleLink: async (linkToken: string, password: string, code?: string): Promise<AuthResponse> => {
    const res = await apiClient.post(
      '/auth/google/link',
      { linkToken, password, ...(code ? { code } : {}) },
      { headers: COOKIE_AUTH_HEADERS },
    );
    return res.data;
  },
  googleStatus: async (): Promise<{ enabled: boolean; linked: boolean; googleEmail: string | null; hasPassword: boolean }> => {
    const res = await apiClient.get('/auth/google/status');
    return res.data;
  },
  googleUnlink: async (password: string, code?: string) => {
    const res = await apiClient.delete('/auth/google', { data: { password, ...(code ? { code } : {}) } });
    return res.data;
  },
  getWebSocketTicket: async (): Promise<{ success: boolean; ticket: string }> => {
    const res = await apiClient.post('/auth/ws-ticket', {});
    return res.data;
  },
  resendVerification: async (email: string) => {
    const res = await apiClient.post('/auth/resend-verification', { email });
    return res.data;
  },
  manualVerify: async () => {
    const res = await apiClient.post('/auth/manual-verify');
    return res.data;
  },
  updateProfile: async (data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    preferredLanguage?: string | null;
    email?: string;
    /** Required (with `code` when 2FA is on) only when `email` is being changed. */
    currentPassword?: string;
    code?: string;
  }) => {
    const res = await apiClient.put('/auth/profile', data);
    return res.data;
  },
};
