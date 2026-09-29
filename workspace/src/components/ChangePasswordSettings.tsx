'use client';

import { useState } from 'react';
import { authApi } from '../lib/api';

/**
 * Change the password while signed in. Every other device is signed out
 * and the account holder gets an email, so an unexpected change is noticed.
 */
export default function ChangePasswordSettings() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
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
    fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
  };
  const secondaryBtn: React.CSSProperties = {
    background: 'white', color: '#44403c', border: '1.5px solid #e7e5e4', borderRadius: 8,
    padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  };

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(''); };

  const submit = async () => {
    setError('');
    setDone('');
    if (next !== confirm) {
      setError('The new passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.changePassword(current, next);
      setDone(res?.message || 'Password changed.');
      reset();
      setOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>Password</h3>
      <p style={{ fontSize: 13, color: '#78716c', marginBottom: 16 }}>
        Changing your password signs you out on every other device.
      </p>

      {done && (
        <div role="status" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#166534', fontSize: 13 }}>
          {done}
        </div>
      )}
      {error && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!open ? (
        <button type="button" style={primaryBtn} onClick={() => { setOpen(true); setDone(''); }}>Change password</button>
      ) : (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320, marginBottom: 14 }}>
            <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} style={inputStyle} />
            <input type="password" autoComplete="new-password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} style={inputStyle} />
            <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
            <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>At least 8 characters, with an uppercase letter, a number and a symbol.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={primaryBtn} disabled={busy || !current || !next || !confirm} onClick={submit}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => { reset(); setOpen(false); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
