/**
 * Clinical evaluation harness: scoring.
 *
 * A case file carries a per-section rubric (diagnosis, investigations,
 * management, calibration, safety). An output is scored by running the model's
 * raw JSON through exactly the post-processing production uses (validation,
 * dose stripping, linter, blocked terms, calibration), then checking the rubric
 * items against the result. Deterministic: no model is called here.
 *
 * Rubric items are DRAFT clinical content until a clinician signs the case off
 * (the case file's `status` says which). The harness measures regression
 * against that rubric; it does not decide what is clinically right.
 */
import {
  planText, sectionText, validateClinicalPlan, type ClinicalPlan, type PlanSection,
} from '../services/clinical/clinicalPlan';
import {
  assessPlan, buildRecord, prepareClinicalContext, type StructuredPlanRecord,
} from '../services/clinical/clinicalPipeline';
import type { ClinicalFindings } from '../services/clinical/clinicalChecks';

export const SECTIONS = ['diagnosis', 'investigations', 'management', 'calibration', 'safety'] as const;
export type SectionName = typeof SECTIONS[number];

export type Where = PlanSection | 'any' | 'top3' | 'investigations' | 'management';

export type RubricItem =
  | { kind: 'match'; id: string; description: string; weight?: number; anyOf: string[]; in: Where | Where[] }
  | { kind: 'forbidden'; id: string; description: string; weight?: number; anyOf: string[]; in: Where | Where[] }
  | { kind: 'decision'; id: string; description: string; weight?: number; treatmentPattern: string; allowed: Array<'continue' | 'stop' | 'modify'> }
  | { kind: 'timing'; id: string; description: string; weight?: number; topicPattern: string }
  | { kind: 'questionsAnswered'; id: string; description: string; weight?: number }
  | { kind: 'tiersPopulated'; id: string; description: string; weight?: number; section: 'investigations' | 'management'; tiers: string[] }
  | { kind: 'differentialHasEvidence'; id: string; description: string; weight?: number; min: number }
  // built-ins computed from the pipeline record
  | { kind: 'diagnosticConfidenceMax'; id: string; description: string; weight?: number; max: number }
  | { kind: 'capsAppliedWhenOverconfident'; id: string; description: string; weight?: number; ceiling: number }
  | { kind: 'triageConfidenceSeparate'; id: string; description: string; weight?: number }
  | { kind: 'triageLevelAtMost'; id: string; description: string; weight?: number; level: number }
  | { kind: 'doctorReviewRequired'; id: string; description: string; weight?: number }
  | { kind: 'noModelDoses'; id: string; description: string; weight?: number }
  | { kind: 'noBlockedTerms'; id: string; description: string; weight?: number }
  | { kind: 'completenessClean'; id: string; description: string; weight?: number }
  | { kind: 'planComplete'; id: string; description: string; weight?: number };

export interface EvalCase {
  id: string;
  title: string;
  /** e.g. "gold_draft_pending_clinician_review" | "gold_signed_off" */
  status: string;
  source?: string;
  input: { caseText: string; findings?: ClinicalFindings };
  rubric: Partial<Record<SectionName, RubricItem[]>>;
}

export interface ItemResult { id: string; description: string; weight: number; passed: boolean; detail?: string }
export interface SectionScore { score: number | null; earned: number; total: number; items: ItemResult[] }
export interface CaseScore {
  caseId: string;
  sections: Record<SectionName, SectionScore>;
  /** Mean of the sections that have items. */
  overall: number;
  /** Plan could not be parsed at all. */
  parsed: boolean;
  issues: string[];
  record: StructuredPlanRecord | null;
}

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
const re = (p: string) => new RegExp(p, 'i');

function textFor(plan: ClinicalPlan, where: Where | Where[]): string {
  return asArray(where).map((w) => {
    if (w === 'any') return planText(plan);
    if (w === 'top3') return [plan.leadingDiagnosis.name, ...plan.differential.slice(0, 2).map((d) => d.name)].join('\n');
    return sectionText(plan, w);
  }).join('\n');
}

export interface ScoreExtras {
  /** From the live TriageResult. Offline recordings have no TriageResult, so the clinician-only record stands in. */
  requiresDoctorReview?: boolean;
}

function evaluateItem(item: RubricItem, plan: ClinicalPlan, record: StructuredPlanRecord, schemaIssues: string[], extras: ScoreExtras): { passed: boolean; detail?: string } {
  switch (item.kind) {
    case 'match':
      return { passed: item.anyOf.some((p) => re(p).test(textFor(plan, item.in))) };
    case 'forbidden': {
      const hit = item.anyOf.find((p) => re(p).test(textFor(plan, item.in)));
      return { passed: !hit, detail: hit ? `matched /${hit}/` : undefined };
    }
    case 'decision': {
      const d = plan.existingTreatmentDecisions.find((x) => re(item.treatmentPattern).test(x.treatment));
      if (!d) return { passed: false, detail: 'no decision stated' };
      return { passed: item.allowed.includes(d.decision), detail: `decision: ${d.decision}` };
    }
    case 'timing':
      return { passed: plan.timingDecisions.some((t) => re(item.topicPattern).test(t.topic) && t.recommendation.length > 0) };
    case 'questionsAnswered':
      return { passed: !schemaIssues.some((i) => i.startsWith('questionAnswers')) };
    case 'tiersPopulated': {
      const tiers = item.section === 'investigations' ? plan.investigations : plan.management;
      const empty = item.tiers.filter((t) => ((tiers as Record<string, unknown[]>)[t] ?? []).length === 0);
      return { passed: empty.length === 0, detail: empty.length ? `empty: ${empty.join(', ')}` : undefined };
    }
    case 'differentialHasEvidence': {
      const ok = plan.differential.filter((d) => d.evidenceFor.length > 0 && d.evidenceAgainst.length > 0).length;
      return { passed: ok >= item.min, detail: `${ok} with evidence` };
    }
    case 'diagnosticConfidenceMax':
      return { passed: record.calibration.diagnostic.value <= item.max, detail: `${record.calibration.diagnostic.value}` };
    case 'capsAppliedWhenOverconfident': {
      const d = record.calibration.diagnostic;
      return { passed: d.modelValue <= item.ceiling || d.appliedCaps.length > 0 };
    }
    case 'triageConfidenceSeparate':
      return { passed: typeof record.calibration.triage.value === 'number' && 'band' in record.calibration.triage && 'band' in record.calibration.diagnostic };
    case 'triageLevelAtMost':
      return { passed: plan.triageLevel <= item.level, detail: `SATS ${plan.triageLevel}` };
    case 'doctorReviewRequired':
      return { passed: extras.requiresDoctorReview !== undefined ? extras.requiresDoctorReview === true : record.audience === 'clinician_only' };
    case 'noModelDoses':
      return { passed: record.dosesRemoved === 0, detail: record.dosesRemoved ? `${record.dosesRemoved} dose(s) written by the model` : undefined };
    case 'noBlockedTerms':
      return { passed: record.blockedTermsRemaining.length === 0, detail: record.blockedTermsRemaining.map((b) => b.term).join(', ') || undefined };
    case 'completenessClean':
      return { passed: record.lintRemaining.length === 0, detail: record.lintRemaining.map((l) => l.elementId).join(', ') || undefined };
    case 'planComplete':
      return { passed: schemaIssues.length === 0, detail: schemaIssues.slice(0, 3).join(' | ') || undefined };
  }
}

const emptySection = (): SectionScore => ({ score: null, earned: 0, total: 0, items: [] });

/** Score an already post-processed record (what production produced, or what the offline path rebuilt). */
export function scoreRecord(c: EvalCase, record: StructuredPlanRecord, schemaIssues: string[], extras: ScoreExtras = {}): CaseScore {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, emptySection()])) as Record<SectionName, SectionScore>;
  for (const s of SECTIONS) {
    for (const item of c.rubric[s] ?? []) {
      const w = item.weight ?? 1;
      const r = evaluateItem(item, record.plan, record, schemaIssues, extras);
      sections[s].items.push({ id: item.id, description: item.description, weight: w, passed: r.passed, detail: r.detail });
      sections[s].total += w;
      if (r.passed) sections[s].earned += w;
    }
    sections[s].score = sections[s].total > 0 ? Math.round((sections[s].earned / sections[s].total) * 1000) / 1000 : null;
  }
  return { caseId: c.id, sections, overall: overallOf(sections), parsed: true, issues: schemaIssues, record };
}

function overallOf(sections: Record<SectionName, SectionScore>): number {
  const scored = SECTIONS.map((s) => sections[s].score).filter((x): x is number => x !== null);
  return scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 1000) / 1000 : 0;
}

/** Nothing usable came back: every rubric item fails. */
export function scoreUnparsed(c: EvalCase, issues: string[]): CaseScore {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, emptySection()])) as Record<SectionName, SectionScore>;
  for (const s of SECTIONS) {
    for (const item of c.rubric[s] ?? []) {
      const w = item.weight ?? 1;
      sections[s].items.push({ id: item.id, description: item.description, weight: w, passed: false, detail: 'no usable plan' });
      sections[s].total += w;
    }
    sections[s].score = sections[s].total > 0 ? 0 : null;
  }
  return { caseId: c.id, sections, overall: 0, parsed: false, issues, record: null };
}

/** Score a model's raw JSON answer for a case, through the production post-processing. */
export function scoreRawOutput(c: EvalCase, raw: unknown, extras: ScoreExtras = {}): CaseScore {
  const clinical = prepareClinicalContext({ caseText: c.input.caseText, structured: c.input.findings });
  const validation = validateClinicalPlan(raw, clinical.questions);
  if (!validation.plan) return scoreUnparsed(c, validation.issues);
  const assessment = assessPlan(validation.plan, validation.issues, clinical, c.input.caseText);
  const record = buildRecord(assessment, clinical, { schemaIssuesRemaining: validation.issues, repairRounds: 0 });
  return scoreRecord(c, record, validation.issues, extras);
}

// ---- thresholds and regression -------------------------------------------------

export interface Thresholds {
  /** Each section of each case must reach at least this. */
  minSection: Record<SectionName, number>;
  /** A live run may not fall further than this below its saved baseline, per section. */
  maxRegression: number;
}

/** The model settings a baseline was produced with. Scores are only comparable between runs that match. */
export interface BaselineSettings { effort: string; maxTokens: number; models: string[] }
export interface Baseline { updatedAt: string; model?: string; settings?: BaselineSettings; cases: Record<string, Partial<Record<SectionName, number>>> }

export function checkThresholds(scores: CaseScore[], t: Thresholds, baseline?: Baseline | null): string[] {
  const failures: string[] = [];
  for (const cs of scores) {
    if (!cs.parsed) failures.push(`${cs.caseId}: the output could not be parsed into a plan`);
    for (const s of SECTIONS) {
      const score = cs.sections[s].score;
      if (score === null) continue;
      if (score < t.minSection[s]) {
        const missed = cs.sections[s].items.filter((i) => !i.passed).map((i) => i.id).join(', ');
        failures.push(`${cs.caseId}: ${s} ${score} is below the minimum ${t.minSection[s]} (failed: ${missed})`);
      }
      const base = baseline?.cases[cs.caseId]?.[s];
      if (typeof base === 'number' && score < base - t.maxRegression) {
        failures.push(`${cs.caseId}: ${s} fell from baseline ${base} to ${score} (allowed drop ${t.maxRegression})`);
      }
    }
  }
  return failures;
}

export function renderEvalReport(scores: CaseScore[], meta: { mode: string; generatedAt: string; label?: string; failures: string[] }): string {
  const lines: string[] = [`# Clinical evaluation`, '', `Mode: ${meta.mode}${meta.label ? ` (${meta.label})` : ''}. Generated ${meta.generatedAt}.`, ''];
  lines.push(`| Case | ${SECTIONS.join(' | ')} | Overall |`, `|---|${SECTIONS.map(() => '---').join('|')}|---|`);
  for (const cs of scores) {
    lines.push(`| ${cs.caseId} | ${SECTIONS.map((s) => cs.sections[s].score ?? '-').join(' | ')} | ${cs.overall} |`);
  }
  lines.push('');
  for (const cs of scores) {
    lines.push(`## ${cs.caseId}`);
    for (const s of SECTIONS) {
      const failed = cs.sections[s].items.filter((i) => !i.passed);
      if (failed.length) lines.push(`- **${s}** missed: ${failed.map((i) => `${i.id}${i.detail ? ` (${i.detail})` : ''}`).join(', ')}`);
    }
    if (cs.record) {
      const flags = cs.record.reviewerFlags.filter((f) => f.severity === 'high').map((f) => f.code);
      if (flags.length) lines.push(`- reviewer flags (high): ${[...new Set(flags)].join(', ')}`);
    }
    lines.push('');
  }
  lines.push(meta.failures.length ? `## FAILED\n${meta.failures.map((f) => `- ${f}`).join('\n')}` : '## PASSED: all sections meet the thresholds');
  return lines.join('\n');
}
