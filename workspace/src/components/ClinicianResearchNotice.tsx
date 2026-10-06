/**
 * Transparency for doctors, not a request for their agreement. Staff are not
 * asked to consent and cannot opt patients in or out; they are told, plainly,
 * what happens to their triage decisions. Shown on the doctor pages where those
 * decisions are made.
 */
export default function ClinicianResearchNotice() {
  return (
    <details
      data-testid="clinician-research-notice"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface,#fafaf9)] px-4 py-2 text-xs text-[var(--muted)]"
    >
      <summary className="cursor-pointer font-semibold text-[var(--foreground)]">
        How your decisions are used for research and AI evaluation
      </summary>
      <div className="mt-2 space-y-1.5 leading-relaxed">
        <p>
          For patients who have chosen to take part in Ahava&apos;s research programme, the AI&apos;s suggestion and your final decision on
          a triage case (the urgency level, and any ICD-10 code you enter) are recorded in the background, in coded form, to measure how
          well the AI agrees with doctors and to help build better early-warning tools for African patients.
        </p>
        <p>
          Only your <strong>role</strong> is recorded, not your name. Nothing extra is asked of you, and your decision is not changed or
          second-guessed by it. It is never shown to patients. You do not need to agree to this and you cannot opt a patient in or out;
          each patient chooses for themselves, and can withdraw, which deletes their data.
        </p>
        <p>
          Outcomes you record (for example an alert judged useful, or a later diagnosis) go to the same place. Questions:
          privacy@ahavaon88.co.za.
        </p>
      </div>
    </details>
  );
}
