/**
 * The structured clinical plan the model must return, and its validator.
 *
 * Hand-written validation (no schema library) so the backend's dependency
 * lockfile does not change. The validator never throws: it returns the plan if
 * the shape is usable plus a list of human-readable issues, because the caller
 * re-prompts the model with exactly those issues.
 */
import type { ConfirmationStatus } from './calibration';

export interface TestItem { test: string; rationale: string }
export interface ActionItem { action: string; rationale: string; guidelineSource?: string }

export interface ClinicalPlan {
  triageLevel: 1 | 2 | 3 | 4 | 5;
  /** Model's own confidence in the urgency level (0-1). */
  triageConfidence: number;
  severity: { summary: string; redFlags: string[] };
  leadingDiagnosis: {
    name: string;
    /** Model's own probability for this diagnosis (0-1); calibrated by code afterwards. */
    probability: number;
    confirmationStatus: ConfirmationStatus;
    rationale: string;
  };
  differential: Array<{ name: string; probability: number; evidenceFor: string[]; evidenceAgainst: string[] }>;
  mustNotMiss: Array<{ name: string; why: string; howToExclude: string }>;
  investigations: { bedsideStat: TestItem[]; first24h: TestItem[]; definitive: TestItem[] };
  management: { immediate: ActionItem[]; targeted: ActionItem[]; supportive: ActionItem[] };
  existingTreatmentDecisions: Array<{ treatment: string; decision: 'continue' | 'stop' | 'modify'; reason: string }>;
  timingDecisions: Array<{ topic: string; recommendation: string; reason: string }>;
  prophylaxis: Array<{ agent: string; indication: string }>;
  escalation: { escalateIf: string[]; redFlags: string[]; referral: string[] };
  questionAnswers: Array<{ question: string; answer: string }>;
  evidenceSources: string[];
  uncertaintyFlags: string[];
}

export const CONFIRMATION_VALUES: ConfirmationStatus[] = ['microbiologically_confirmed', 'tissue_confirmed', 'clinical_only'];
export const DECISION_VALUES = ['continue', 'stop', 'modify'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : null;
const prob = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

export interface PlanValidation {
  /** Present when the object was usable. May still carry `issues`. */
  plan: ClinicalPlan | null;
  issues: string[];
}

/** Minimal question list the case poses, so every one gets an answer. */
export function extractCaseQuestions(caseText: string, max = 8): string[] {
  const parts = caseText.replace(/\s+/g, ' ').match(/[^.?!\n]*\?/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const q = p.trim().replace(/^["'(\s]+/, '');
    if (q.length < 12 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

const tests = (v: unknown, where: string, issues: string[]): TestItem[] => {
  if (!Array.isArray(v)) { issues.push(`${where} must be an array of {test, rationale}`); return []; }
  const out: TestItem[] = [];
  v.forEach((x, i) => {
    if (isObj(x) && str(x.test)) out.push({ test: str(x.test), rationale: str(x.rationale) });
    else issues.push(`${where}[${i}] needs a non-empty "test"`);
  });
  return out;
};

const actions = (v: unknown, where: string, issues: string[]): ActionItem[] => {
  if (!Array.isArray(v)) { issues.push(`${where} must be an array of {action, rationale, guidelineSource}`); return []; }
  const out: ActionItem[] = [];
  v.forEach((x, i) => {
    if (isObj(x) && str(x.action)) {
      out.push({ action: str(x.action), rationale: str(x.rationale), ...(str(x.guidelineSource) ? { guidelineSource: str(x.guidelineSource) } : {}) });
    } else issues.push(`${where}[${i}] needs a non-empty "action"`);
  });
  return out;
};

export function validateClinicalPlan(raw: unknown, questions: string[] = []): PlanValidation {
  const issues: string[] = [];
  if (!isObj(raw)) return { plan: null, issues: ['the answer is not a JSON object'] };

  const level = Number(raw.triageLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) issues.push('triageLevel must be an integer 1-5');

  const triageConfidence = prob(raw.triageConfidence);
  if (triageConfidence === null) issues.push('triageConfidence must be a number between 0 and 1');

  const sev = isObj(raw.severity) ? raw.severity : null;
  if (!sev || !str(sev.summary)) issues.push('severity.summary is required (severity/triage)');
  const redFlags = strList(sev?.redFlags) ?? [];

  const ld = isObj(raw.leadingDiagnosis) ? raw.leadingDiagnosis : null;
  if (!ld || !str(ld.name)) issues.push('leadingDiagnosis.name is required');
  const ldProb = prob(ld?.probability);
  if (ld && ldProb === null) issues.push('leadingDiagnosis.probability must be a number between 0 and 1');
  const confirmation = CONFIRMATION_VALUES.includes(ld?.confirmationStatus as ConfirmationStatus)
    ? (ld!.confirmationStatus as ConfirmationStatus)
    : null;
  if (ld && confirmation === null) issues.push(`leadingDiagnosis.confirmationStatus must be one of ${CONFIRMATION_VALUES.join(' | ')}`);
  if (ld && !str(ld.rationale)) issues.push('leadingDiagnosis.rationale is required');

  const differential: ClinicalPlan['differential'] = [];
  if (!Array.isArray(raw.differential) || raw.differential.length === 0) {
    issues.push('differential must list at least one alternative diagnosis with evidenceFor and evidenceAgainst');
  } else {
    raw.differential.forEach((d, i) => {
      if (!isObj(d) || !str(d.name)) { issues.push(`differential[${i}] needs a name`); return; }
      const p = prob(d.probability);
      const ef = strList(d.evidenceFor);
      const ea = strList(d.evidenceAgainst);
      if (p === null) issues.push(`differential[${i}].probability must be a number between 0 and 1`);
      if (!ef || ef.length === 0) issues.push(`differential[${i}] ("${str(d.name)}") needs evidenceFor`);
      if (!ea || ea.length === 0) issues.push(`differential[${i}] ("${str(d.name)}") needs evidenceAgainst (or state "none identified")`);
      differential.push({ name: str(d.name), probability: p ?? 0, evidenceFor: ef ?? [], evidenceAgainst: ea ?? [] });
    });
  }

  const mustNotMiss: ClinicalPlan['mustNotMiss'] = [];
  if (!Array.isArray(raw.mustNotMiss)) issues.push('mustNotMiss must be an array (may be empty only if there is genuinely none)');
  else raw.mustNotMiss.forEach((m, i) => {
    if (isObj(m) && str(m.name)) mustNotMiss.push({ name: str(m.name), why: str(m.why), howToExclude: str(m.howToExclude) });
    else issues.push(`mustNotMiss[${i}] needs a name`);
  });

  const inv = isObj(raw.investigations) ? raw.investigations : null;
  if (!inv) issues.push('investigations must be {bedsideStat, first24h, definitive}');
  const investigations = {
    bedsideStat: tests(inv?.bedsideStat, 'investigations.bedsideStat', issues),
    first24h: tests(inv?.first24h, 'investigations.first24h', issues),
    definitive: tests(inv?.definitive, 'investigations.definitive', issues),
  };
  if (inv && investigations.bedsideStat.length + investigations.first24h.length + investigations.definitive.length === 0) {
    issues.push('investigations is empty: list the tests needed');
  }

  const mg = isObj(raw.management) ? raw.management : null;
  if (!mg) issues.push('management must be {immediate, targeted, supportive}');
  const management = {
    immediate: actions(mg?.immediate, 'management.immediate', issues),
    targeted: actions(mg?.targeted, 'management.targeted', issues),
    supportive: actions(mg?.supportive, 'management.supportive', issues),
  };
  if (mg && management.immediate.length + management.targeted.length + management.supportive.length === 0) {
    issues.push('management is empty: list the actions needed');
  }

  const existing: ClinicalPlan['existingTreatmentDecisions'] = [];
  if (!Array.isArray(raw.existingTreatmentDecisions)) issues.push('existingTreatmentDecisions must be an array (empty if the patient is on no relevant treatment)');
  else raw.existingTreatmentDecisions.forEach((e, i) => {
    const decision = isObj(e) ? String(e.decision ?? '').toLowerCase() : '';
    if (isObj(e) && str(e.treatment) && (DECISION_VALUES as readonly string[]).includes(decision) && str(e.reason)) {
      existing.push({ treatment: str(e.treatment), decision: decision as 'continue' | 'stop' | 'modify', reason: str(e.reason) });
    } else issues.push(`existingTreatmentDecisions[${i}] needs treatment, decision (continue | stop | modify) and reason`);
  });

  const timing: ClinicalPlan['timingDecisions'] = [];
  if (!Array.isArray(raw.timingDecisions)) issues.push('timingDecisions must be an array (for example ART timing)');
  else raw.timingDecisions.forEach((t, i) => {
    if (isObj(t) && str(t.topic) && str(t.recommendation)) timing.push({ topic: str(t.topic), recommendation: str(t.recommendation), reason: str(t.reason) });
    else issues.push(`timingDecisions[${i}] needs topic and recommendation`);
  });

  const prophylaxis: ClinicalPlan['prophylaxis'] = [];
  if (!Array.isArray(raw.prophylaxis)) issues.push('prophylaxis must be an array (empty only if none is indicated)');
  else raw.prophylaxis.forEach((p, i) => {
    if (isObj(p) && str(p.agent)) prophylaxis.push({ agent: str(p.agent), indication: str(p.indication) });
    else issues.push(`prophylaxis[${i}] needs an agent`);
  });

  const esc = isObj(raw.escalation) ? raw.escalation : null;
  if (!esc) issues.push('escalation must be {escalateIf, redFlags, referral}');
  const escalation = { escalateIf: strList(esc?.escalateIf) ?? [], redFlags: strList(esc?.redFlags) ?? [], referral: strList(esc?.referral) ?? [] };
  if (esc && escalation.escalateIf.length + escalation.redFlags.length === 0) issues.push('escalation needs at least one escalateIf trigger or red flag');

  const qa: ClinicalPlan['questionAnswers'] = [];
  if (Array.isArray(raw.questionAnswers)) {
    raw.questionAnswers.forEach((q) => {
      if (isObj(q) && str(q.question) && str(q.answer)) qa.push({ question: str(q.question), answer: str(q.answer) });
    });
  }
  if (questions.length > 0) {
    const unanswered = questions.filter((q, i) => {
      const a = qa[i];
      return !a || !a.answer;
    });
    if (unanswered.length > 0) {
      issues.push(`questionAnswers must answer every question the case asks, in order. Unanswered: ${unanswered.map((q) => `"${q}"`).join('; ')}`);
    }
  }

  const evidenceSources = strList(raw.evidenceSources) ?? [];
  const uncertaintyFlags = strList(raw.uncertaintyFlags) ?? [];

  const usable = ld && str(ld.name) && Number.isInteger(level) && level >= 1 && level <= 5 && sev && str(sev.summary);
  if (!usable) return { plan: null, issues };

  return {
    issues,
    plan: {
      triageLevel: level as ClinicalPlan['triageLevel'],
      triageConfidence: triageConfidence ?? 0.45,
      severity: { summary: str(sev!.summary), redFlags },
      leadingDiagnosis: {
        name: str(ld!.name),
        probability: ldProb ?? 0.45,
        confirmationStatus: confirmation ?? 'clinical_only',
        rationale: str(ld!.rationale),
      },
      differential, mustNotMiss, investigations, management,
      existingTreatmentDecisions: existing, timingDecisions: timing, prophylaxis, escalation,
      questionAnswers: qa, evidenceSources, uncertaintyFlags,
    },
  };
}

// ---- text helpers -----------------------------------------------------------

export type PlanSection =
  | 'differential' | 'mustNotMiss' | 'investigations' | 'management' | 'existingTreatmentDecisions'
  | 'timingDecisions' | 'prophylaxis' | 'escalation' | 'questionAnswers' | 'leadingDiagnosis' | 'severity';

const flatten = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (isObj(v)) return Object.values(v).flatMap(flatten);
  return [];
};

export function sectionText(plan: ClinicalPlan, section: PlanSection): string {
  return flatten(plan[section]).join('\n');
}

/** Everything the plan says, for searching. */
export function planText(plan: ClinicalPlan): string {
  return flatten(plan).join('\n');
}

// ---- no model-generated doses --------------------------------------------------

// A number followed by a dose unit. Laboratory units (mg/dL, g/L, mmol/L, mIU/L ...) are not doses.
const DOSE_PATTERN =
  /\b\d+(?:[.,]\d+)?\s?(?:-|–|to)?\s?(?:\d+(?:[.,]\d+)?\s?)?(?:mg|mcg|µg|μg|g|iu|units?|ml|mls)\b(?!\s*\/\s*(?:d?l|l)\b)(?:\s*\/\s*(?:kg|m2|m²|day|d|dose|h|hr|hour|min))*/gi;

export const DOSE_REMOVED_MARKER = '[dose omitted: see guideline]';

export function stripDoses(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(DOSE_PATTERN, () => { removed += 1; return DOSE_REMOVED_MARKER; });
  return { text: out, removed };
}

/** Remove any dose the model wrote, anywhere in the plan. Doses come only from the cited dose table. */
export function stripDosesFromPlan(plan: ClinicalPlan): { plan: ClinicalPlan; removed: number } {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') { const r = stripDoses(v); removed += r.removed; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { plan: walk(plan) as ClinicalPlan, removed };
}

// ---- legacy fields ------------------------------------------------------------------

/** The older single-string fields every downstream consumer already reads, derived from the plan. */
export function deriveLegacyFields(plan: ClinicalPlan): { possibleConditions: string[]; recommendedAction: string; reasoning: string } {
  const possibleConditions = [plan.leadingDiagnosis.name, ...plan.differential.map((d) => d.name)];
  // Deliberately free of drug names, decisions and tests: this legacy field can be
  // shown to the patient before a doctor has reviewed the case. The tiered
  // clinical plan, with treatments and tests, is clinician-only (aiStructuredPlan).
  const lines: string[] = ['A doctor will review the full assessment.'];
  if (plan.escalation.redFlags.length) {
    lines.push(`Go to the nearest emergency department immediately if: ${plan.escalation.redFlags.join('; ')}.`);
  }

  const reasoning = [
    `${plan.severity.summary}`,
    `Leading diagnosis: ${plan.leadingDiagnosis.name}. ${plan.leadingDiagnosis.rationale}`,
    ...plan.differential.slice(0, 4).map((d) => `${d.name}: for (${d.evidenceFor.join('; ')}); against (${d.evidenceAgainst.join('; ')}).`),
  ].join(' ');
  return { possibleConditions, recommendedAction: lines.join(' '), reasoning };
}
