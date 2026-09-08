'use client';

import { useState } from 'react';
import { authApi } from '../lib/api';

// AH-29: opt-in TOTP two-factor auth. Any authenticated user can turn this
// on for their own account; it is not mandatory for any role.
export default function TwoFactorSettings({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<'idle' | 'setup' | 'backup-codes' | 'disable'>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cardStyle: React.CSSProperties = {
    background: 'white', border: '1px solid #e7e5e4', borderRadius: 14,
    padding: '24px 28px', marginTop: 24,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1.5px solid #e7e5e4', fontSize: 14, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  };
  const primaryBtn: React.CSSProperties = {
    background: busy ? '#a8a29e' : 'linear-gradient(135deg,#0d9488,#059669)',
    color: 'white', border: 'none', borderRadius: 8, padding: '10px 18px',
    fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
  };
  const secondaryBtn: React.CSSProperties = {
    background: 'white', color: '#57534e', border: '1.5px solid #e7e5e4',
    borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  };

  const startSetup = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await authApi.setupTwoFactor();
      setSecret(res.secret);
      setOtpauthUrl(res.otpauthUrl);
      setStep('setup');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Could not start setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await authApi.verifyTwoFactorSetup(code.trim());
      setBackupCodes(res.backupCodes);
      setEnabled(true);
      setStep('backup-codes');
      setCode('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    setError('');
    setBusy(true);
    try {
      await authApi.disableTwoFactor(password, code.trim());
      setEnabled(false);
      setStep('idle');
      setPassword('');
      setCode('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Could not disable two-factor authentication');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>
        Two-factor authentication
      </h3>
      <p style={{ fontSize: 13, color: '#78716c', marginBottom: 16 }}>
        Adds a second step at login using an authenticator app (Google Authenticator, Authy, etc.). Optional — you can turn it off any time.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {step === 'idle' && (
        enabled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ background: '#dcfce7', color: '#166534', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99 }}>Enabled</span>
            <button type="button" style={secondaryBtn} onClick={() => setStep('disable')}>Turn off</button>
          </div>
        ) : (
          <button type="button" style={primaryBtn} disabled={busy} onClick={startSetup}>
            {busy ? 'Starting…' : 'Set up two-factor authentication'}
          </button>
        )
      )}

      {step === 'setup' && (
        <div>
          <p style={{ fontSize: 13, color: '#44403c', marginBottom: 10 }}>
            Scan this with your authenticator app, or enter the key manually, then confirm the 6-digit code it shows.
          </p>
          <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: 12, marginBottom: 12, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
            {secret}
          </div>
          <p style={{ fontSize: 11, color: '#a8a29e', marginBottom: 14 }}>
            <a href={otpauthUrl} style={{ color: '#0d9488' }}>{otpauthUrl}</a>
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <input
              type="text" inputMode="numeric" placeholder="123456" value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ ...inputStyle, maxWidth: 140, letterSpacing: 3, textAlign: 'center' }}
            />
            <button type="button" style={primaryBtn} disabled={busy || code.trim().length === 0} onClick={confirmSetup}>
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => { setStep('idle'); setCode(''); setError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'backup-codes' && (
        <div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#92400e', fontSize: 13 }}>
            Save these backup codes somewhere safe. Each works once, if you lose access to your authenticator app. They will not be shown again.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontFamily: 'monospace', fontSize: 14 }}>
            {backupCodes.map((c) => (
              <div key={c} style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>{c}</div>
            ))}
          </div>
          <button type="button" style={primaryBtn} onClick={() => { setStep('idle'); setBackupCodes([]); }}>
            Done
          </button>
        </div>
      )}

      {step === 'disable' && (
        <div>
          <p style={{ fontSize: 13, color: '#44403c', marginBottom: 10 }}>
            Enter your password and a current code (or a backup code) to turn this off.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, marginBottom: 14 }}>
            <input
              type="password" placeholder="Current password" value={password}
              onChange={(e) => setPassword(e.target.value)} style={inputStyle}
            />
            <input
              type="text" placeholder="6-digit or backup code" value={code}
              onChange={(e) => setCode(e.target.value)} style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={primaryBtn} disabled={busy || !password || !code} onClick={confirmDisable}>
              {busy ? 'Disabling…' : 'Turn off two-factor authentication'}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => { setStep('idle'); setPassword(''); setCode(''); setError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
