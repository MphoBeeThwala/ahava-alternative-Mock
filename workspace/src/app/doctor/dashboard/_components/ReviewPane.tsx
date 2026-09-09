import { useEffect, useRef } from 'react';
import type { TriageCase } from '../../../../lib/api';
import { AcuityRow } from '../../../../components/ui/AcuityRow';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Icon } from '../../../../components/ui/Icon';
import { triageLevelToAcuity, ageFromDateOfBirth } from '../_lib';

function KbdChip({ children }: { children: string }) {
  return (
    <kbd
      className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold"
      style={{ background: 'rgba(255,255,255,0.25)' }}
    >
      {children}
    </kbd>
  );
}

export function ReviewPane({
  triageCase,
  releasing,
  onClaim,
  onOpenReview,
  onOpenFollowUp,
  onRelease,
  onOpenPrescription,
  onOpenReferral,
}: {
  triageCase: TriageCase | null;
  releasing: string | null;
  onClaim: (caseId: string) => void;
  onOpenReview: (tc: TriageCase) => void;
  onOpenFollowUp: (tc: TriageCase) => void;
  onRelease: (caseId: string) => void;
  onOpenPrescription: (tc: TriageCase) => void;
  onOpenReferral: (tc: TriageCase) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (triageCase) paneRef.current?.focus({ preventScroll: true });
  }, [triageCase]);

  if (!triageCase) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon="stethoscope" message="Select a case from the worklist to review" />
      </div>
    );
  }

  const tc = triageCase;
  const age = ageFromDateOfBirth(tc.patient?.dateOfBirth);
  const canReview = tc.status === 'ASSIGNED' || tc.status === 'REVIEWED';
  const canRelease = tc.status === 'REVIEWED';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Never swallow typing, modifier combos, or browser shortcuts.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (!canRelease && !canReview) return;

    const key = e.key.toLowerCase();
    if (key === 'e' && canRelease) {
      e.preventDefault();
      onOpenReferral(tc);
    } else if (key === 'p' && canRelease) {
      e.preventDefault();
      onOpenPrescription(tc);
    } else if (key === 'm' && canReview) {
      e.preventDefault();
      onOpenFollowUp(tc);
    }
  };

  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex-1 overflow-y-auto outline-none"
    >
      {/* Case header */}
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              {tc.patient?.firstName} {tc.patient?.lastName}
              {age != null && <span className="font-normal text-[var(--muted)]"> · {age}y{tc.patient?.gender ? ` · ${tc.patient.gender.charAt(0).toUpperCase()}` : ''}</span>}
            </h2>
            <div className="mt-1.5">
              <StatusBadge variant="neutral">{tc.status.replace(/_/g, ' ')}</StatusBadge>
            </div>
          </div>
          <AcuityRow level={triageLevelToAcuity(tc.finalTriageLevel ?? tc.aiTriageLevel)} className="max-w-[220px]">
            <span className="text-xs font-medium text-[var(--muted)]">SATS {tc.finalTriageLevel ?? tc.aiTriageLevel}</span>
          </AcuityRow>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        {/* Left: AI draft + patient's own words */}
        <div className="space-y-4">
          <div className="rounded-[var(--radius)] border p-4" style={{ borderColor: 'var(--acuity-urgent)', background: 'var(--acuity-urgent-bg)' }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--acuity-urgent)', color: 'white' }}>
                <Icon name="alert-square" size={12} /> UNSIGNED DRAFT
              </span>
            </div>
            <p className="text-sm text-[var(--foreground)]">{tc.aiReasoning}</p>
            <p className="mt-2 text-sm text-[var(--foreground)]"><strong>Recommendation:</strong> {tc.aiRecommendedAction}</p>
            {tc.aiPossibleConditions.length > 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]"><strong>Possible conditions:</strong> {tc.aiPossibleConditions.join(', ')}</p>
            )}
            <div className="mt-3 border-t pt-3 text-xs text-[var(--muted)]" style={{ borderColor: 'var(--border-strong)' }}>
              <p className="mb-1 font-semibold uppercase tracking-wide" style={{ fontSize: 'var(--text-eyebrow)' }}>What the model used</p>
              <ul className="space-y-0.5">
                <li>• Symptoms described (patient text)</li>
                {(tc.medicalPassport?.chronicConditions?.length || tc.medicalPassport?.allergies?.length) ? (
                  <li>• Chronic conditions / allergies on file (medical passport)</li>
                ) : null}
              </ul>
            </div>
            {tc.aiModel && <p className="mt-2 text-[10px] text-[var(--ink-3)]">Model: {tc.aiModel}</p>}
          </div>

          <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">In the patient&apos;s own words</p>
            <p className="text-sm text-[var(--foreground)]">&ldquo;{tc.symptoms}&rdquo;</p>
          </div>

          {tc.attachments && tc.attachments.length > 0 && (
            <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">Clinical attachments</p>
              <div className="flex flex-wrap gap-2">
                {tc.attachments.map((a) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] hover:border-[var(--primary)]">
                    <Icon name="phone" size={12} /> {a.fileName}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: vitals (omitted — no structured vitals data exists for
            patient-submitted AI triage cases; see commit notes) + decision panel */}
        <div className="space-y-4">
          {tc.reviewSafety && (tc.reviewSafety.warnings.length > 0 || tc.reviewSafety.blockers.length > 0) && (
            <div className="rounded-[var(--radius)] border p-4" style={{ borderColor: 'var(--acuity-urgent)', background: 'var(--acuity-urgent-bg)' }}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--acuity-urgent-ink)' }}>Safety review</p>
              <ul className="space-y-1 text-xs" style={{ color: 'var(--acuity-urgent-ink)' }}>
                {[...tc.reviewSafety.blockers, ...tc.reviewSafety.warnings].map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}

          <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">Your decision</p>
            <div className="flex flex-col gap-2">
              {tc.status === 'PENDING_REVIEW' && (
                <button type="button" onClick={() => onClaim(tc.id)} className="rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--role-doctor)', minHeight: 'var(--tap-min)' }}>
                  Claim case
                </button>
              )}
              {canReview && (
                <button type="button" onClick={() => onOpenReview(tc)} className="rounded-lg border py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}>
                  ✎ Write review
                </button>
              )}
              {canRelease && (
                <button
                  type="button"
                  onClick={() => onOpenReferral(tc)}
                  className="flex items-center justify-center rounded-lg py-2.5 text-sm font-semibold text-white"
                  style={{ background: 'var(--acuity-emergency)', minHeight: 'var(--tap-min)' }}
                >
                  Refer as emergency<KbdChip>E</KbdChip>
                </button>
              )}
              {canRelease && (
                <button type="button" onClick={() => onOpenPrescription(tc)} className="flex items-center justify-center rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--role-nurse)', minHeight: 'var(--tap-min)' }}>
                  Prescribe<KbdChip>P</KbdChip>
                </button>
              )}
              {canReview && (
                <button type="button" onClick={() => onOpenFollowUp(tc)} className="flex items-center justify-center rounded-lg border py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}>
                  Ask more<KbdChip>M</KbdChip>
                </button>
              )}
              {canRelease && (
                <button
                  type="button"
                  onClick={() => onRelease(tc.id)}
                  disabled={releasing === tc.id}
                  className="btn-primary rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
                  style={{ minHeight: 'var(--tap-primary)' }}
                >
                  {releasing === tc.id ? 'Releasing…' : '✅ Release result'}
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Nothing reaches the patient until you sign. Your name and the review timestamp are attached to this decision.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
