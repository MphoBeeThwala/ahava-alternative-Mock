import { isValidIcd10 } from '../lib/api/research';

/**
 * Optional coded diagnosis for the doctor's own form. One field, no extra
 * screen: leaving it blank costs nothing. When filled in it is saved with the
 * prescription or referral, and (for patients who opted in to research) helps
 * check the AI's accuracy against what doctors actually diagnose.
 */
export function Icd10Field({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const invalid = value.trim() !== '' && !isValidIcd10(value);
  return (
    <div>
      <label htmlFor="icd10-field" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
        ICD-10 code <span className="text-xs font-normal text-[var(--muted)]">(optional)</span>
      </label>
      <input
        id="icd10-field"
        type="text"
        autoComplete="off"
        maxLength={8}
        className="w-40 rounded-lg border px-4 py-2.5 font-mono uppercase"
        style={{ borderColor: invalid ? '#dc2626' : 'var(--border)' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. I10"
        aria-invalid={invalid}
        aria-describedby="icd10-help"
      />
      <p id="icd10-help" className="mt-1 text-xs" style={{ color: invalid ? '#dc2626' : 'var(--muted)' }}>
        {invalid
          ? 'That is not a valid ICD-10 format (for example I10 or E11.9). Fix it or leave it blank.'
          : 'Leave blank if unsure. A code lets the platform check its AI against real diagnoses; nothing else changes.'}
      </p>
    </div>
  );
}
