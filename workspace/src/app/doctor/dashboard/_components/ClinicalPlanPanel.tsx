import type { ReactNode } from 'react';
import type { PlanActionItem, PlanCriterion, PlanTestItem, StructuredPlanRecord } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/ui/StatusBadge';

const CRITERION_LABEL: Record<PlanCriterion, string> = { met: 'met', not_met: 'not met', not_assessable: 'cannot be assessed' };
const DECISION_VARIANT = { continue: 'success', stop: 'danger', modify: 'warning' } as const;

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">{title}</summary>
      <div className="mt-2 space-y-2 text-sm text-[var(--foreground)]">{children}</div>
    </details>
  );
}

function Tests({ label, items }: { label: string; items: PlanTestItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <ul className="ml-4 list-disc">
        {items.map((t, i) => (
          <li key={i}><strong>{t.test}</strong>{t.rationale ? <span className="text-[var(--muted)]"> — {t.rationale}</span> : null}</li>
        ))}
      </ul>
    </div>
  );
}

function Actions({ label, items }: { label: string; items: PlanActionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <ul className="ml-4 list-disc">
        {items.map((a, i) => (
          <li key={i}>
            <strong>{a.action}</strong>
            {a.rationale ? <span className="text-[var(--muted)]"> — {a.rationale}</span> : null}
            {a.guidelineSource ? <span className="ml-1 text-xs text-[var(--ink-3)]">[{a.guidelineSource}]</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The tiered clinical plan from the AI pipeline, for the reviewing clinician only.
 * A draft: the reviewer flags come first because they say what the plan did NOT cover.
 * Drug doses are never shown here; the model does not write them.
 */
export function ClinicalPlanPanel({ record }: { record: StructuredPlanRecord }) {
  const { plan, checks, calibration, reviewerFlags } = record;
  const high = reviewerFlags.filter((f) => f.severity === 'high');
  const info = reviewerFlags.filter((f) => f.severity !== 'high');
  const d = calibration.diagnostic;

  return (
    <div className="space-y-3" data-testid="clinical-plan-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">AI clinical plan (draft for your review)</p>

      {high.length > 0 && (
        <div role="alert" className="rounded-[var(--radius)] border-2 p-3" style={{ borderColor: '#b91c1c', background: '#fef2f2', color: '#7f1d1d' }}>
          <p className="text-sm font-extrabold uppercase tracking-wide">Gaps in this plan: please cover these yourself</p>
          <ul className="mt-1 ml-4 list-disc text-sm">
            {high.map((f, i) => <li key={i}>{f.message}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
        <p>
          <strong>Leading diagnosis:</strong> {plan.leadingDiagnosis.name}{' '}
          <StatusBadge variant={d.confirmationStatus === 'clinical_only' ? 'warning' : 'success'} className="!px-2 !py-0.5 !text-xs">
            {d.confirmationStatus === 'clinical_only' ? 'unconfirmed' : d.confirmationStatus.replace(/_/g, ' ')}
          </StatusBadge>
        </p>
        <p className="mt-1 text-[var(--muted)]">{plan.leadingDiagnosis.rationale}</p>
        <p className="mt-2 text-xs text-[var(--muted)]" data-testid="confidence-line">
          Diagnostic confidence: <strong>{d.band}</strong> ({d.value.toFixed(2)})
          {d.modelValue !== d.value ? <> — model said {d.modelValue.toFixed(2)}, reduced: {d.appliedCaps.join('; ')}</> : null}
          {' · '}Urgency confidence: <strong>{calibration.triage.band}</strong> ({calibration.triage.value.toFixed(2)}).
          {' '}These are labels, not calibrated probabilities.
        </p>
      </div>

      <Section title="Calculated by code from the structured values" open>
        <ul className="ml-4 list-disc">
          <li>MAP: {checks.map === null ? 'cannot be assessed' : `${checks.map} mmHg`}</li>
          <li data-testid="septic-shock-line">Sepsis-3 septic shock: <strong>{CRITERION_LABEL[checks.septicShock.status]}</strong>. <span className="text-[var(--muted)]">{checks.septicShock.reason}</span></li>
          <li>HLH-2004: {checks.hlh2004.metCount}/8 criteria met{checks.hlh2004.notAssessableCount > 0 ? `, ${checks.hlh2004.notAssessableCount} not assessable` : ''} (threshold 5)</li>
          <li>HScore: {checks.hScore.scoreMin === checks.hScore.scoreMax ? checks.hScore.scoreMin : `${checks.hScore.scoreMin} to ${checks.hScore.scoreMax}`} (cut-off 169)</li>
          {checks.egfr !== null && <li>eGFR: {checks.egfr} mL/min/1.73m²</li>}
        </ul>
      </Section>

      {plan.questionAnswers.length > 0 && (
        <Section title="Answers to the questions asked" open>
          {plan.questionAnswers.map((q, i) => (
            <p key={i}><strong>{q.question}</strong><br />{q.answer}</p>
          ))}
        </Section>
      )}

      {plan.existingTreatmentDecisions.length > 0 && (
        <Section title="Existing treatment: continue / stop / modify" open>
          {plan.existingTreatmentDecisions.map((e, i) => (
            <p key={i}>
              <StatusBadge variant={DECISION_VARIANT[e.decision]} className="!px-2 !py-0.5 !text-xs">{e.decision.toUpperCase()}</StatusBadge>{' '}
              <strong>{e.treatment}</strong> — <span className="text-[var(--muted)]">{e.reason}</span>
            </p>
          ))}
        </Section>
      )}

      {plan.timingDecisions.length > 0 && (
        <Section title="Timing decisions" open>
          {plan.timingDecisions.map((t, i) => (
            <p key={i}><strong>{t.topic}:</strong> {t.recommendation}{t.reason ? <span className="text-[var(--muted)]"> ({t.reason})</span> : null}</p>
          ))}
        </Section>
      )}

      <Section title="Investigations" open>
        <Tests label="Bedside / stat" items={plan.investigations.bedsideStat} />
        <Tests label="First 24 hours" items={plan.investigations.first24h} />
        <Tests label="Definitive" items={plan.investigations.definitive} />
      </Section>

      <Section title="Management" open>
        <Actions label="Immediate" items={plan.management.immediate} />
        <Actions label="Targeted" items={plan.management.targeted} />
        <Actions label="Supportive" items={plan.management.supportive} />
        <p className="text-xs text-[var(--ink-3)]">No doses are generated. Use the current NDoH Standard Treatment Guidelines / EML or SA HIV Clinicians Society guideline.</p>
      </Section>

      {plan.prophylaxis.length > 0 && (
        <Section title="Prophylaxis">
          <ul className="ml-4 list-disc">{plan.prophylaxis.map((p, i) => <li key={i}><strong>{p.agent}</strong> — {p.indication}</li>)}</ul>
        </Section>
      )}

      <Section title="Differential (evidence for and against)">
        {plan.differential.map((x, i) => (
          <div key={i}>
            <p><strong>{x.name}</strong> <span className="text-xs text-[var(--muted)]">({Math.round(x.probability * 100)}%)</span></p>
            <p className="text-xs text-[var(--muted)]">For: {x.evidenceFor.join('; ') || '—'}</p>
            <p className="text-xs text-[var(--muted)]">Against: {x.evidenceAgainst.join('; ') || '—'}</p>
          </div>
        ))}
      </Section>

      {plan.mustNotMiss.length > 0 && (
        <Section title="Must not miss">
          {plan.mustNotMiss.map((m, i) => (
            <p key={i}><strong>{m.name}</strong> — {m.why}. <span className="text-[var(--muted)]">Exclude by: {m.howToExclude}</span></p>
          ))}
        </Section>
      )}

      <Section title="Escalation and red flags">
        {plan.escalation.escalateIf.length > 0 && <p><strong>Escalate if:</strong> {plan.escalation.escalateIf.join('; ')}</p>}
        {plan.escalation.redFlags.length > 0 && <p><strong>Red flags:</strong> {plan.escalation.redFlags.join('; ')}</p>}
        {plan.escalation.referral.length > 0 && <p><strong>Refer:</strong> {plan.escalation.referral.join('; ')}</p>}
      </Section>

      {info.length > 0 && (
        <Section title={`Notes on how this plan was produced (${info.length})`}>
          <ul className="ml-4 list-disc text-xs text-[var(--muted)]">
            {info.map((f, i) => <li key={i}>{f.message}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}
