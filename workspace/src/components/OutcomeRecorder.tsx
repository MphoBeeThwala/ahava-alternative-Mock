'use client';

import { useState } from 'react';
import { isValidIcd10, researchApi, type ClinicianOutcomeType, type RecordOutcomeInput } from '../lib/api/research';

const TYPES: Array<{ value: ClinicianOutcomeType; label: string }> = [
  { value: 'HOSPITAL_ADMISSION', label: 'Hospital admission' },
  { value: 'CVD_EVENT', label: 'Cardiovascular event (heart attack, stroke, heart failure)' },
  { value: 'HYPERTENSION_DIAGNOSED', label: 'Hypertension diagnosed' },
  { value: 'DIABETES_DIAGNOSED', label: 'Diabetes diagnosed' },
  { value: 'ARRHYTHMIA_DIAGNOSED', label: 'Arrhythmia diagnosed' },
  { value: 'DEATH', label: 'Death' },
];

const BASES: Array<{ value: NonNullable<RecordOutcomeInput['basis']>; label: string }> = [
  { value: 'CLINICAL', label: 'Clinical examination' },
  { value: 'LAB', label: 'Laboratory result' },
  { value: 'IMAGING', label: 'Imaging' },
  { value: 'DISCHARGE_SUMMARY', label: 'Discharge summary' },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * For events the platform does not see happen: an admission, a diagnosis made
 * at a clinic, a death. These arrive weeks or months after any triage case and
 * are the most valuable labels there are. Doctors only, on a patient they
 * currently hold access to; the server checks both. Structured fields, no
 * free text.
 */
export default function OutcomeRecorder({ patientId }: { patientId: string }) {
  const [type, setType] = useState<ClinicianOutcomeType>('HOSPITAL_ADMISSION');
  const [day, setDay] = useState(today());
  const [icd10, setIcd10] = useState('');
  const [basis, setBasis] = useState<RecordOutcomeInput['basis']>('CLINICAL');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const badCode = icd10.trim() !== '' && !isValidIcd10(icd10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (badCode) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await researchApi.recordOutcome({
        patientId, outcomeType: type, outcomeDay: day, basis,
        ...(icd10.trim() ? { icd10: icd10.trim().toUpperCase() } : {}),
      });
      // The same message whatever happened to consent: a clinician is not told a patient's research choice.
      setMessage('Saved. Thank you.');
      setIcd10('');
    } catch (err) {
      const e2 = err as { response?: { data?: { error?: string } } };
      setError(e2.response?.data?.error ?? 'Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border px-3 py-2 text-sm';
  const border = { borderColor: 'var(--border)' } as const;
  return (
    <form onSubmit={submit} data-testid="outcome-recorder" className="space-y-3 text-sm">
      <p className="text-xs text-[var(--muted)]">
        Record something that happened to this patient that the platform may not have seen, such as an admission or a diagnosis made
        elsewhere. It takes about ten seconds and helps check the AI&apos;s accuracy. Use only what you have confirmed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">What happened</span>
          <select className={field} style={border} value={type} onChange={(e) => setType(e.target.value as ClinicianOutcomeType)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Date it happened</span>
          <input type="date" className={field} style={border} value={day} max={today()} onChange={(e) => setDay(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">ICD-10 code <span className="font-normal text-[var(--muted)]">(optional)</span></span>
          <input
            type="text" className={`${field} font-mono uppercase`} style={{ ...border, borderColor: badCode ? '#dc2626' : 'var(--border)' }}
            value={icd10} onChange={(e) => setIcd10(e.target.value)} maxLength={8} placeholder="e.g. I21.9" aria-invalid={badCode}
          />
          {badCode && <span className="mt-1 block text-xs text-red-600">Not a valid ICD-10 format. Fix it or leave it blank.</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Confirmed by</span>
          <select className={field} style={border} value={basis} onChange={(e) => setBasis(e.target.value as RecordOutcomeInput['basis'])}>
            {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
      </div>
      <button
        type="submit" disabled={busy || badCode}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: 'var(--role-doctor)' }}
      >
        {busy ? 'Saving…' : 'Record outcome'}
      </button>
      {message && <p role="status" className="text-xs text-green-700">{message}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
