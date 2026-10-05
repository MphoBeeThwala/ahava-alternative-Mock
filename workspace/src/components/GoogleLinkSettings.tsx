'use client';

import { useEffect, useState } from 'react';
import { authApi } from '../lib/api';

/**
 * Patients: shows whether Google sign-in is linked and lets them remove it.
 * Linking happens from the sign-in page ("Continue with Google" with the same
 * email), where the account's password is confirmed first.
 */
export default function GoogleLinkSettings() {
  const [status, setStatus] = useState<{ linked: boolean; googleEmail: string | null; hasPassword: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi.googleStatus().then((s) => setStatus(s.enabled ? s : null)).catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const unlink = async () => {
    setBusy(true);
    setError('');
    try {
      await authApi.googleUnlink(password, code.trim() || undefined);
      setStatus({ ...status, linked: false, googleEmail: null });
      setOpen(false);
      setPassword('');
      setCode('');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Could not unlink Google. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = { background: 'white', border: '1px solid #e7e5e4', borderRadius: 14, padding: '24px 28px', marginTop: 24 };
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e7e5e4', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Sign in with Google</h3>
      {status.linked ? (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#57534e' }}>
            Linked to <strong>{status.googleEmail}</strong>. You can sign in with Google or with your password.
          </p>
          {!status.hasPassword ? (
            <p style={{ margin: 0, fontSize: 13, color: '#92400e' }}>
              You don&apos;t have a password yet. To unlink Google, first set one with &ldquo;Forgot password?&rdquo; on the sign-in page.
            </p>
          ) : !open ? (
            <button type="button" onClick={() => setOpen(true)} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Unlink Google
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
              <input type="password" autoComplete="current-password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
              <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Authenticator code (if you use one)" value={code} onChange={(e) => setCode(e.target.value)} style={inp} />
              {error && <span role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy || !password} onClick={unlink} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {busy ? 'Unlinking…' : 'Unlink'}
                </button>
                <button type="button" onClick={() => { setOpen(false); setError(''); }} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: '#57534e' }}>
          Not linked. To link, sign out and choose <strong>Continue with Google</strong> on the sign-in page using the same email as this account.
        </p>
      )}
    </div>
  );
}
