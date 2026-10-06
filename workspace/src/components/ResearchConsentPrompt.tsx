'use client';

import { useEffect, useState } from 'react';
import { consentApi } from '../lib/api';
import { RESEARCH_AGREE_TEXT, RESEARCH_CONSENT_VERSION, RESEARCH_TITLE, ResearchDetails, ResearchIntro } from './ResearchConsentCopy';

const SNOOZE_KEY = 'ahava.researchPrompt.snoozedUntil';
const SNOOZE_DAYS = 30;

type ConsentRow = { consentType: string; version: string; withdrawn: boolean };

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false; // storage blocked: just show it
  }
}

/**
 * One gentle question, on a patient's dashboard, for anyone who has not already
 * said yes: people who signed up with Google, accounts a nurse or administrator
 * created, and everyone who joined before the sign-up checkbox existed.
 *
 * It is a question, never a gate: "Not now" hides it for 30 days on this device,
 * the same choice is always available on the Profile page, and nothing about
 * their care depends on the answer. Saying no is recorded nowhere on the server.
 */
export default function ResearchConsentPrompt() {
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (snoozed()) return;
    consentApi
      .getAll()
      .then((r: { consents?: ConsentRow[] }) => {
        const already = (r.consents ?? []).some(
          (c) => c.consentType === 'RESEARCH_DATA' && c.version === RESEARCH_CONSENT_VERSION && !c.withdrawn,
        );
        // A withdrawal is an answer: don't ask again someone who said no. An agreement on older
        // wording is NOT current, so those people are asked again on the new wording.
        const withdrew = (r.consents ?? []).some((c) => c.consentType === 'RESEARCH_DATA' && c.withdrawn);
        setShow(!already && !withdrew);
      })
      .catch(() => setShow(false)); // can't tell: say nothing rather than ask someone who may have answered
  }, []);

  if (!show && !done) return null;

  const notNow = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      /* the prompt just comes back next visit */
    }
    setShow(false);
  };

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await consentApi.give('RESEARCH_DATA', RESEARCH_CONSENT_VERSION);
      setDone(true);
      setShow(false);
    } catch {
      setError('Could not save your choice. Please try again, or use the Profile page.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '14px 20px', margin: '16px 24px 0', fontSize: 13, color: '#166534' }}>
        Thank you. From now on, new readings are included. You can change your mind any time on your Profile page.
      </div>
    );
  }

  return (
    <div data-testid="research-prompt" style={{ background: 'white', border: '1px solid #e7e5e4', borderRadius: 14, padding: '20px 24px', margin: '16px 24px 0' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{RESEARCH_TITLE}</h3>
      <ResearchIntro />
      <ResearchDetails />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#0f172a', fontWeight: 600, marginBottom: 12 }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{RESEARCH_AGREE_TEXT}</span>
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={join} disabled={busy || !agree} style={{ background: busy || !agree ? '#94a3b8' : '#0f172a', color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: busy || !agree ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving…' : 'Take part'}
        </button>
        <button type="button" onClick={notNow} style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
          Not now
        </button>
      </div>
      {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
