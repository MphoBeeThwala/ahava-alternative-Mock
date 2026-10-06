'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AiHealth } from '../lib/api/admin';

const LABEL: Record<AiHealth['status'], { text: string; color: string; bg: string }> = {
  ok: { text: 'Working', color: '#166534', bg: '#f0fdf4' },
  degraded: { text: 'Degraded: one provider failing', color: '#92400e', bg: '#fffbeb' },
  down: { text: 'DOWN: cases are going to doctors without AI analysis', color: '#991b1b', bg: '#fef2f2' },
  unconfigured: { text: 'Not configured', color: '#991b1b', bg: '#fef2f2' },
};

const NAME = { claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' } as const;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-ZA') : 'never');

/** Admin dashboard: is AI triage actually running, and if not, why. */
export default function AiHealthCard() {
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (probe: boolean) => {
    setBusy(true);
    setError('');
    try {
      setHealth(probe ? await adminApi.probeAiHealth() : await adminApi.getAiHealth());
    } catch {
      setError('Could not load AI status.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!health && !error) return null;
  const badge = health ? LABEL[health.status] : null;

  return (
    <div style={{ background: 'white', border: '1px solid #e7e5e4', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>AI triage status</h3>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={busy}
          style={{ background: 'white', border: '1.5px solid #e7e5e4', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {health && badge && (
        <>
          <p style={{ margin: '12px 0', padding: '8px 12px', borderRadius: 8, background: badge.bg, color: badge.color, fontWeight: 700, fontSize: 14 }}>
            {badge.text}
          </p>
          {health.providers.filter((p) => p.configured).map((p) => (
            <div key={p.provider} style={{ borderTop: '1px solid #f1f5f9', padding: '10px 0', fontSize: 13, color: '#44403c' }}>
              <strong>{NAME[p.provider]}</strong>
              {p.workingModel && <span> · last worked on <code>{p.workingModel}</code></span>}
              <div>Last success: {when(p.lastSuccessAt)} · Last failure: {when(p.lastFailureAt)}</div>
              {p.lastFailure && (
                <div style={{ color: p.consecutiveFailures > 0 ? '#991b1b' : '#78716c' }}>
                  Last error: {p.lastFailure.kind}{p.lastFailure.status ? ` (${p.lastFailure.status})` : ''} on <code>{p.lastFailure.model}</code>: {p.lastFailure.message}
                </div>
              )}
              {p.lastProbeOk === false && <div style={{ color: '#991b1b' }}>Model-list check failed: {p.lastProbeError}</div>}
            </div>
          ))}
          {health.status === 'unconfigured' && (
            <p style={{ fontSize: 13, color: '#991b1b' }}>
              Set <code>ANTHROPIC_API_KEY</code> (and optionally <code>GEMINI_API_KEY</code>) on the backend service.
            </p>
          )}
        </>
      )}
    </div>
  );
}
