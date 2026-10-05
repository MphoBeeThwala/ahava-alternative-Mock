'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '../lib/api';
import { GoogleLinkRequiredError, TwoFactorRequiredError, useAuth } from '../contexts/AuthContext';

/**
 * "Continue with Google" for patients. Renders nothing unless the backend has
 * Google configured, so the button appears the moment GOOGLE_CLIENT_ID is set
 * and never before. Staff can't use it: the backend refuses staff accounts.
 *
 * If the Google account's email already belongs to a password account, the
 * patient is asked for that account's password (and authenticator code, if
 * they use one) before anything is linked.
 */

type GoogleAccounts = {
  accounts: {
    id: {
      initialize: (config: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded')));
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export default function GoogleSignInButton({
  mode = 'signin',
  onSignedIn,
  onTwoFactor,
  onError,
}: {
  mode?: 'signin' | 'signup';
  onSignedIn: () => void;
  /** The patient has 2FA on: hand over to the page's code step. */
  onTwoFactor?: (pendingToken: string) => void;
  onError?: (message: string) => void;
}) {
  const { loginWithGoogle, completeGoogleLink } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientIdRef = useRef<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [link, setLink] = useState<GoogleLinkRequiredError | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState('');

  const handlers = useRef({ onSignedIn, onTwoFactor, onError, loginWithGoogle });
  handlers.current = { onSignedIn, onTwoFactor, onError, loginWithGoogle };

  // Each attempt uses up its nonce, so every (re)initialisation fetches a new one.
  const prepare = useCallback(async () => {
    const clientId = clientIdRef.current;
    if (!clientId || !window.google || !buttonRef.current) return;
    const nonce = await authApi.googleNonce();
    window.google.accounts.id.initialize({
      client_id: clientId,
      nonce,
      auto_select: false,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) return;
        try {
          await handlers.current.loginWithGoogle(response.credential);
          handlers.current.onSignedIn();
        } catch (err) {
          if (err instanceof GoogleLinkRequiredError) {
            setLink(err);
          } else if (err instanceof TwoFactorRequiredError && handlers.current.onTwoFactor) {
            handlers.current.onTwoFactor(err.pendingToken);
          } else {
            const e = err as { response?: { data?: { error?: string } }; message?: string };
            handlers.current.onError?.(e.response?.data?.error || e.message || 'Google sign-in failed. Please try again.');
          }
          void prepare().catch(() => {});
        }
      },
    });
    buttonRef.current.innerHTML = '';
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: mode === 'signup' ? 'signup_with' : 'continue_with',
      width: 320,
    });
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await authApi.googleConfig();
        if (cancelled || !config.enabled || !config.clientId) return;
        clientIdRef.current = config.clientId;
        setEnabled(true);
        await loadGsi();
      } catch {
        setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (enabled && !link) void prepare().catch(() => setEnabled(false));
  }, [enabled, link, prepare]);

  if (!enabled) return null;

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link) return;
    setBusy(true);
    setLinkError('');
    try {
      await completeGoogleLink(link.linkToken, password, code.trim() || undefined);
      onSignedIn();
    } catch (err) {
      const e2 = err as { response?: { data?: { error?: string; code?: string } } };
      if (e2.response?.data?.code === 'GOOGLE_LINK_EXPIRED') {
        setLink(null);
        setPassword('');
        setCode('');
        onError?.('That took too long. Please choose Continue with Google again.');
      } else {
        setLinkError(e2.response?.data?.error || 'Could not link your Google account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '11px 13px', borderRadius: 10, border: '1.5px solid #e7e5e4',
    fontSize: 14, fontFamily: 'inherit', outline: 'none', background: '#fafaf9', boxSizing: 'border-box',
  };

  if (link) {
    return (
      <form onSubmit={submitLink} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
        <p style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5, margin: 0 }}>
          There&apos;s already an Ahava account for <strong>{link.email}</strong>. Enter its password to connect Google
          sign-in to it. Nothing is linked until you do.
        </p>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Your Ahava password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inp}
        />
        {link.needsTwoFactorCode && (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Authenticator code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            style={inp}
          />
        )}
        {linkError && <span role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{linkError}</span>}
        <button
          type="submit"
          disabled={busy || !password}
          style={{ background: busy ? '#a8a29e' : 'linear-gradient(135deg,#0d9488,#059669)', color: 'white', border: 'none', borderRadius: 10, padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'Linking…' : 'Link Google and sign in'}
        </button>
        <button
          type="button"
          onClick={() => { setLink(null); setPassword(''); setCode(''); setLinkError(''); }}
          style={{ background: 'none', border: 'none', color: '#57534e', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', color: '#a8a29e', fontSize: 12 }}>
        <span style={{ flex: 1, height: 1, background: '#e7e5e4' }} />
        or
        <span style={{ flex: 1, height: 1, background: '#e7e5e4' }} />
      </div>
      <div ref={buttonRef} />
      <span style={{ fontSize: 11, color: '#a8a29e', textAlign: 'center' }}>
        For patients. Doctors, nurses and administrators sign in with their email, password and authenticator.
      </span>
    </div>
  );
}
