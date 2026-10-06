'use client';

import { useEffect, useState } from 'react';
import { adminApi, type ResearchStatus } from '../lib/api/admin';

const OUTCOME_LABEL: Record<string, string> = {
  TRIAGE_REVIEWED: 'AI vs doctor triage reviews',
  EMERGENCY_REFERRAL: 'Emergency referrals',
  HYPERTENSION_DIAGNOSED: 'Hypertension diagnosed',
  DIABETES_DIAGNOSED: 'Diabetes diagnosed',
  CVD_EVENT: 'Cardiovascular events',
  ARRHYTHMIA_DIAGNOSED: 'Arrhythmia diagnosed',
  HOSPITAL_ADMISSION: 'Hospital admissions',
  DEATH: 'Deaths',
  ALERT_CONFIRMED: 'Alerts judged useful',
  ALERT_DISMISSED: 'Alerts judged false alarms',
};

/**
 * Admin dashboard: is the research dataset growing, are outcomes arriving, and
 * who is recording them. Counts only: no row-level data, and nothing that can
 * link a record to a person is ever sent here.
 */
export default function ResearchStatusCard() {
  const [s, setS] = useState<ResearchStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    adminApi.getResearchStatus().then(setS).catch(() => setFailed(true));
  }, []);

  if (!s && !failed) return null;
  const box: React.CSSProperties = { background: 'white', border: '1px solid #e7e5e4', borderRadius: 14, padding: '20px 24px', marginBottom: 20 };
  if (failed || !s) {
    return (
      <div style={box}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Research data</h3>
        <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>Could not load research status.</p>
      </div>
    );
  }

  const outcomes = Object.entries(s.outcomes).sort((a, b) => b[1] - a[1]);
  const small: React.CSSProperties = { margin: '0 0 6px', fontSize: 13, color: '#44403c' };
  return (
    <div style={box} data-testid="research-status">
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Research data</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#78716c' }}>Counts only. Nothing here identifies a patient.</p>
      <p style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, fontWeight: 700, fontSize: 14, background: s.captureEnabled ? '#f0fdf4' : '#fffbeb', color: s.captureEnabled ? '#166534' : '#92400e' }}>
        {s.captureEnabled ? 'Capture is on' : 'Capture is OFF: set RESEARCH_PSEUDONYM_KEY on the backend to start'}
      </p>
      <p style={small}><strong>{s.consentedPatients}</strong> patients have opted in · <strong>{s.subjectsWithSnapshots}</strong> have readings kept · <strong>{s.snapshots}</strong> readings in total</p>
      {s.firstObservedDay && <p style={small}>From {s.firstObservedDay} to {s.lastObservedDay}</p>}
      <p style={small} data-testid="research-retention">
        Retention: readings and outcomes kept for {s.retention.maxYears ?? 'an unlimited number of'} years
        {s.retention.inactiveMonths !== null ? `; people with nothing new for ${s.retention.inactiveMonths} months are removed` : ''}.
        {' '}Last run: {s.retention.lastRunAt ? new Date(s.retention.lastRunAt).toLocaleString('en-ZA') : 'not yet'}.
      </p>

      <h4 style={{ margin: '14px 0 6px', fontSize: 13, fontWeight: 800 }}>Outcomes recorded</h4>
      {outcomes.length === 0 ? <p style={small}>None yet.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {outcomes.map(([type, n]) => <li key={type} style={small}>{OUTCOME_LABEL[type] ?? type}: <strong>{n}</strong></li>)}
        </ul>
      )}

      <h4 style={{ margin: '14px 0 6px', fontSize: 13, fontWeight: 800 }}>Who recorded outcomes (last 90 days)</h4>
      {s.outcomesRecordedByClinicianLast90Days.length === 0 ? <p style={small}>No clinician has recorded one yet.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {s.outcomesRecordedByClinicianLast90Days.map((c) => <li key={c.clinicianId} style={small}>{c.name}: <strong>{c.count}</strong></li>)}
        </ul>
      )}

      {s.shadowPredictions.length > 0 && (
        <p style={{ ...small, marginTop: 12 }}>
          Experimental models scoring in the background: {s.shadowPredictions.map((p) => `${p.model} (${p.count})`).join(', ')}. Never shown to anyone.
        </p>
      )}
    </div>
  );
}
