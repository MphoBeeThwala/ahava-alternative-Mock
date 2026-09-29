'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { authApi } from '../lib/api';

// AH-29: TOTP two-factor auth. Optional for patients; mandatory for
// nurses, doctors and admins (`required`), who can't turn it off.
export default function TwoFactorSettings({
  initiallyEnabled,
  required = false,
  onEnabled,
}: {
  initiallyEnabled: boolean;
  /** Mandatory for this account (staff): no "turn off", different wording. */
  required?: boolean;
  /** Called once the user has seen their backup codes and pressed Done. */
  onEnabled?: () => void;
}) {
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

  // QR image made in the browser from the otpauth:// link — the key never
  // goes to a third-party QR service.
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!otpauthUrl) { setQrDataUrl(''); return; }
    let cancelled = false;
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [otpauthUrl]);

  const groupedSecret = secret.replace(/(.{4})/g, '$1 ').trim();

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the key is still shown to type */ }
  };

  const startSetup = async (regenerate = false) => {
    setError('');
    setCode('');
    setBusy(true);
    try {
      const res = await authApi.setupTwoFactor(regenerate);
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
      const res = await authApi.verifyTwoFactorSetup(code.replace(/\s/g, ''));
      setBackupCodes(res.backupCodes);
      setEnabled(true);
      setStep('backup-codes');
      setCode('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e.response?.data?.error || 'Invalid code';
      setError(msg === 'Invalid code'
        ? 'That code wasn\u2019t accepted. Check you\u2019re reading the code under \u201cAhava Healthcare\u201d for this account. If you added this account to your app more than once, use \u201cGet a new key\u201d below.'
        : msg);
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
        Adds a second step at login using an authenticator app (Google Authenticator, Authy, etc.).
        {required
          ? ' Required for nurse, doctor and administrator accounts. If you lose your phone, an administrator can reset it.'
          : ' Optional — you can turn it off any time.'}
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
            {!required && <button type="button" style={secondaryBtn} onClick={() => setStep('disable')}>Turn off</button>}
          </div>
        ) : (
          <button type="button" style={primaryBtn} disabled={busy} onClick={() => startSetup()}>
            {busy ? 'Starting…' : 'Set up two-factor authentication'}
          </button>
        )
      )}

      {step === 'setup' && (
        <div>
          <ol style={{ fontSize: 13, color: '#44403c', margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Open your authenticator app (e.g. Google Authenticator) and tap <strong>+</strong>.</li>
            <li>Choose <strong>Scan a QR code</strong> and scan the code below — or choose <strong>Enter a setup key</strong>, type the key, and pick <strong>Time based</strong>.</li>
            <li>Enter the 6-digit code the app shows for <strong>Ahava Healthcare</strong>.</li>
          </ol>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 14 }}>
            <div style={{ width: 200, height: 200, border: '1px solid #e7e5e4', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white' }}>
              {qrDataUrl
                // A data: URL made in the browser; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={qrDataUrl} alt="QR code to add Ahava Healthcare to your authenticator app" width={200} height={200} style={{ borderRadius: 8 }} />
                : <span style={{ fontSize: 12, color: '#a8a29e' }}>Preparing QR code…</span>}
            </div>
            <div style={{ minWidth: 200 }}>
              <p style={{ fontSize: 12, color: '#78716c', margin: '0 0 4px' }}>Setup key (if you can&apos;t scan)</p>
              <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 15, letterSpacing: 1, marginBottom: 6 }}>
                {groupedSecret}
              </div>
              <button type="button" style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }} onClick={copySecret}>
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <p style={{ fontSize: 12, color: '#78716c', margin: '8px 0 0' }}>
                On this phone? <a href={otpauthUrl} style={{ color: '#0d9488' }}>Open in authenticator app</a>
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code}
              maxLength={7}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
              style={{ ...inputStyle, maxWidth: 140, letterSpacing: 3, textAlign: 'center' }}
            />
            <button type="button" style={primaryBtn} disabled={busy || code.replace(/\s/g, '').length !== 6} onClick={confirmSetup}>
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => { setStep('idle'); setCode(''); setError(''); }}>
              Cancel
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>
            Codes not accepted? Delete any existing &ldquo;Ahava Healthcare&rdquo; entries from your app, then{' '}
            <button type="button" onClick={() => startSetup(true)} disabled={busy}
              style={{ background: 'none', border: 'none', padding: 0, color: '#0d9488', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
              get a new key
            </button>{' '}and add it once.
          </p>
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
          <button type="button" style={primaryBtn} onClick={() => { setStep('idle'); setBackupCodes([]); onEnabled?.(); }}>
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
