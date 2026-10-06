'use client';

import { useState } from 'react';
import { researchApi } from '../lib/api/research';

/**
 * One click inside the monitoring card a doctor is already reading: was this
 * alert a real concern or a false alarm? It is the cheapest honest label the
 * early-warning engine can get. A passive "doctor looked at it" is NOT recorded:
 * only an explicit answer is, and a changed answer replaces the earlier one.
 */
export default function AlertFeedback({ patientId, alertLevel }: { patientId: string; alertLevel: string }) {
  const [answer, setAnswer] = useState<'useful' | 'false' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (kind: 'useful' | 'false') => {
    setBusy(true);
    setError('');
    try {
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await researchApi.recordOutcome({
        patientId,
        outcomeType: kind === 'useful' ? 'ALERT_CONFIRMED' : 'ALERT_DISMISSED',
        outcomeDay: day,
        ...(alertLevel === 'RED' || alertLevel === 'YELLOW' ? { alertLevel } : {}),
      });
      setAnswer(kind);
    } catch {
      setError('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const btn = (kind: 'useful' | 'false', label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => send(kind)}
      aria-pressed={answer === kind}
      className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-60"
      style={{
        borderColor: answer === kind ? 'var(--primary)' : 'var(--border)',
        background: answer === kind ? 'var(--primary)' : 'transparent',
        color: answer === kind ? 'white' : 'var(--foreground)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" data-testid="alert-feedback">
      <span className="text-xs text-[var(--muted)]">Was this alert useful?</span>
      {btn('useful', 'Real concern')}
      {btn('false', 'False alarm')}
      {answer && <span role="status" className="text-xs text-[var(--muted)]">Thanks, noted.</span>}
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
