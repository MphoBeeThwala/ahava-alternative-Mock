'use client';

import { useEffect, useState } from 'react';
import { consentApi, researchApi, type MyResearchData } from '../lib/api';
import { RESEARCH_AGREE_TEXT, RESEARCH_CONSENT_VERSION, RESEARCH_TITLE, ResearchDetails, ResearchIntro } from './ResearchConsentCopy';

// Re-exported so existing importers keep working.
export { RESEARCH_CONSENT_VERSION };

type ConsentRow = { consentType: string; version: string; withdrawn: boolean };

/**
 * Patients: optional, separate opt-in for using their pseudonymised readings
 * and clinician-confirmed outcomes to build and test future health tools for
 * South African patients. Off by default, never bundled with another consent,
 * and withdrawing it deletes what was captured. Also shows, to the patient
 * alone, exactly what has been kept (their right of access).
 *
 * The wording lives in ResearchConsentCopy.tsx (approved by legal and the
 * Information Officer).
 */
export default function ResearchConsentSettings() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    consentApi
      .getAll()
      .then((r: { consents?: ConsentRow[] }) =>
        setEnrolled(
          (r.consents ?? []).some((c) => c.consentType === 'RESEARCH_DATA' && c.version === RESEARCH_CONSENT_VERSION && !c.withdrawn),
        ),
      )
      .catch(() => setEnrolled(null));
  }, []);

  if (enrolled === null) return null;

  const join = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await consentApi.give('RESEARCH_DATA', RESEARCH_CONSENT_VERSION);
      setEnrolled(true);
      setAgree(false);
      setMessage('Thank you. From now on, new readings are included. Nothing recorded before this moment is used.');
    } catch {
      setError('Could not save your choice. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!confirm('Stop taking part? Everything already captured for research from your account will be deleted.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await consentApi.withdraw('RESEARCH_DATA');
      setEnrolled(false);
      setMessage(r?.message ?? 'You have stopped taking part.');
    } catch {
      setError('Could not withdraw. Please try again, or contact privacy@ahavaon88.co.za.');
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = { background: 'white', border: '1px solid #e7e5e4', borderRadius: 14, padding: '24px 28px', marginTop: 24 };
  const p: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, color: '#57534e', lineHeight: 1.55 };

  return (
    <div style={card} data-testid="research-consent">
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{RESEARCH_TITLE}</h3>
      <ResearchIntro />
      <ResearchDetails />
      {enrolled ? (
        <>
          <p style={{ ...p, color: '#166534', fontWeight: 600 }}>You are taking part.</p>
          <WhatHasBeenKept />
          <button type="button" onClick={leave} disabled={busy} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {busy ? 'Working…' : 'Stop taking part and delete my data'}
          </button>
        </>
      ) : (
        <>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#0f172a', fontWeight: 600, marginBottom: 12 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{RESEARCH_AGREE_TEXT}</span>
          </label>
          <button type="button" onClick={join} disabled={busy || !agree} style={{ background: busy || !agree ? '#94a3b8' : '#0f172a', color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: busy || !agree ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Saving…' : 'Take part'}
          </button>
        </>
      )}
      {message && <p role="status" style={{ ...p, marginTop: 12, color: '#166534' }}>{message}</p>}
      {error && <p role="alert" style={{ ...p, marginTop: 12, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}

/** What has been kept about this patient, shown to them alone. */
function WhatHasBeenKept() {
  const [data, setData] = useState<MyResearchData | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setOpen(true);
    try {
      setData(await researchApi.myData());
    } catch {
      setFailed(true);
    }
  };

  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-research-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const small: React.CSSProperties = { margin: '0 0 8px', fontSize: 13, color: '#57534e', lineHeight: 1.5 };
  return (
    <div style={{ marginBottom: 12 }}>
      {!open ? (
        <button type="button" onClick={load} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          See what has been kept about me
        </button>
      ) : failed ? (
        <p role="alert" style={{ ...small, color: '#dc2626' }}>Could not load this right now. Please try again later.</p>
      ) : !data ? (
        <p style={small}>Loading…</p>
      ) : (
        <div data-testid="my-research-data">
          <p style={small}>
            <strong>{data.readings.length}</strong> reading{data.readings.length === 1 ? '' : 's'} and{' '}
            <strong>{data.outcomes.length}</strong> clinician-confirmed outcome{data.outcomes.length === 1 ? '' : 's'} kept
            {data.since ? <> since {new Date(data.since).toLocaleDateString()}</> : null}.
          </p>
          {data.modelScoresComputed > 0 && (
            <p style={small}>
              {data.modelScoresComputed} automated check{data.modelScoresComputed === 1 ? ' was' : 's were'} run on this data while
              testing new tools. They are experimental, are not shown to you or your clinicians, and do not affect your care. To ask
              about them, contact privacy@ahavaon88.co.za.
            </p>
          )}
          {data.readings.length + data.outcomes.length > 0 && (
            <button type="button" onClick={download} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Download a copy
            </button>
          )}
        </div>
      )}
    </div>
  );
}

