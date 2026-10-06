'use client';

import { useEffect, useState } from 'react';
import { consentApi } from '../lib/api';

// Must match RESEARCH_CONSENT_VERSION in the backend (services/research/pseudonym.ts).
// Change both together when the wording below changes materially, so earlier
// agreements stop counting and people are asked again on the new wording.
export const RESEARCH_CONSENT_VERSION = '1.0';

type ConsentRow = { consentType: string; version: string; withdrawn: boolean };

/**
 * Patients: optional, separate opt-in for using their pseudonymised readings
 * and clinician-confirmed outcomes to build and test future health tools for
 * South African patients. Off by default, never bundled with another consent,
 * and withdrawing it deletes what was captured.
 *
 * The wording here describes what the code does (services/research/*). It still
 * needs legal / ethics-committee sign-off before real patients are shown it.
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
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Help build better early warning for African patients (optional)</h3>
      <p style={p}>
        Most health prediction tools were built on data from other parts of the world and work less well for us. If you agree, Ahava will
        keep a coded copy of your readings and the outcomes your clinicians confirm, to help build and test future tools that are accurate
        for South African and African patients.
      </p>
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Exactly what this means</summary>
        <ul style={{ ...p, paddingLeft: 18, marginTop: 8 }}>
          <li><strong>What is kept:</strong> your age group (5-year band), sex, the health history you entered (for example smoker or diabetes), your readings (heart rate, blood pressure, oxygen and similar), the date (not the time), and clinician-confirmed outcomes such as a diagnosis or hospital admission.</li>
          <li><strong>What is not kept:</strong> your name, contact details, ID number, address, location, messages, or anything you typed in your own words.</li>
          <li><strong>Coded, not anonymous:</strong> your data is stored under a code that only Ahava can link back to you, so that we can delete it if you withdraw. Because of that, it is still personal information under POPIA.</li>
          <li><strong>Only from now:</strong> readings recorded before you agree are never included.</li>
          <li><strong>No effect on your care:</strong> your care, alerts and results do not change, and nothing from this is shown to you or to a clinician. It is used to build and check tools in the background.</li>
          <li><strong>You can leave at any time:</strong> withdrawing stops new data and deletes what was captured.</li>
        </ul>
      </details>
      {enrolled ? (
        <>
          <p style={{ ...p, color: '#166534', fontWeight: 600 }}>You are taking part.</p>
          <button type="button" onClick={leave} disabled={busy} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {busy ? 'Working…' : 'Stop taking part and delete my data'}
          </button>
        </>
      ) : (
        <>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#0f172a', fontWeight: 600, marginBottom: 12 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I agree that Ahava may keep a coded copy of my readings and clinician-confirmed outcomes from now on, for developing and testing health tools, as described above. I understand I can withdraw at any time.</span>
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
