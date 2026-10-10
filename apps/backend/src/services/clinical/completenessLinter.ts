/**
 * Completeness linter: after generation (and, for the triggers that need only
 * the case, BEFORE generation so the model is told what the plan must cover).
 *
 * The rules file says "when X is true, the plan must address Y". It never says
 * what the answer to Y is. A missing element triggers one targeted re-prompt;
 * anything still missing is flagged for the reviewing doctor.
 */
import rulesFile from './reference/completenessRules.json';
import { stripNegatedSpans } from '../triageSafety';
import type { ClinicalChecks, ClinicalFindings } from './clinicalChecks';
import { planText, sectionText, type ClinicalPlan, type PlanSection } from './clinicalPlan';

type Condition =
  | { type: 'cd4Below'; value: number }
  | { type: 'text'; patterns: string[] }
  | { type: 'plan'; patterns: string[] }
  | { type: 'predicate'; name: string };

interface Requirement {
  id: string;
  section: PlanSection | 'any';
  description: string;
  anyOf?: string[];
  /** For existingTreatmentDecisions: a decision (continue/stop/modify) must exist for a treatment matching this. */
  decisionFor?: string;
}

interface Rule {
  id: string;
  title: string;
  when: { all?: Condition[]; any?: Condition[] };
  sources: string[];
  requires: Requirement[];
}

const RULES = (rulesFile as unknown as { rules: Rule[] }).rules;
export const COMPLETENESS_RULES_VERSION = (rulesFile as { version: string }).version;
export const COMPLETENESS_RULES_SIGNOFF = (rulesFile as { signoff: string }).signoff;

export interface LintContext {
  caseText: string;
  findings: ClinicalFindings;
  checks: ClinicalChecks;
}

const re = (p: string) => new RegExp(p, 'i');
const anyMatch = (patterns: string[], text: string) => patterns.some((p) => re(p).test(text));

// ---- text predicates ----------------------------------------------------------

const TB_TREATMENT = [
  '\\b(?:empirical|empiric)\\s+(?:TB|anti-?TB|antituberculous)',
  '\\b(?:RHZE|HRZE|rifafour|rifater)\\b',
  '\\bTB (?:treatment|therapy|regimen)\\b',
  '\\banti-?TB\\b',
];

const HLH_TEXT = ['\\bHLH\\b', 'ha?emophagocyt', 'ha?emophagocytic lymphohistiocytosis', 'macrophage activation'];
const CONFUSION_TEXT = [
  '\\bconfus', '\\bdisorient', '\\bdrows', '\\bsomnolen', '\\blethar', '\\bobtund', '\\bdelirium', '\\bdelirious',
  'altered (?:mental|consciousness|sensorium|level of consciousness)', 'reduced (?:consciousness|level of consciousness|GCS)',
  'decreased (?:consciousness|GCS)', '\\bstupor', '\\bcomatose\\b', '\\bunrousable\\b',
];
const HYPOTENSION_TEXT = ['\\bhypotensi', 'low blood pressure', 'BP (?:of )?(?:[0-8]\\d|9\\d)\\s*/'];
const HYPONATRAEMIA_TEXT = ['hyponatr', 'low sodium', 'sodium (?:of |is |was |:)?\\s*1[0-2]\\d\\b(?!\\.)'];
const SEPSIS_TEXT = ['\\bsepsis\\b', '\\bseptic\\b', 'suspected infection with'];

export function evaluatePredicate(name: string, ctx: LintContext, scrubbed: string): boolean {
  const { checks, findings } = ctx;
  switch (name) {
    case 'onTbTreatment':
      return findings.onTbTreatment === true || anyMatch(TB_TREATMENT, scrubbed);
    case 'hlhSuspected':
      return (
        anyMatch(HLH_TEXT, scrubbed) ||
        checks.hlh2004.metCount >= 3
      );
    case 'alteredConsciousness':
      return (
        findings.alteredMentation === true ||
        (typeof findings.gcs === 'number' && findings.gcs < 15) ||
        anyMatch(CONFUSION_TEXT, scrubbed)
      );
    case 'hypotension':
      return (
        checks.septicShock.hypotensive === 'met' ||
        (typeof findings.sbp === 'number' && findings.sbp < 100) ||
        anyMatch(HYPOTENSION_TEXT, scrubbed)
      );
    case 'hyponatraemia':
      return (
        (typeof findings.sodiumMmol === 'number' && findings.sodiumMmol < 135) ||
        anyMatch(HYPONATRAEMIA_TEXT, scrubbed)
      );
    case 'suspectedSepsis':
      return checks.qsofa.status === 'met' || findings.suspectedInfection === true || anyMatch(SEPSIS_TEXT, scrubbed);
    default:
      return false;
  }
}

function conditionHolds(c: Condition, ctx: LintContext, scrubbed: string, plan: ClinicalPlan | null, phase: 'pre' | 'post'): boolean | null {
  switch (c.type) {
    case 'cd4Below':
      return typeof ctx.findings.cd4Cells === 'number' && ctx.findings.hivPositive !== false && ctx.findings.cd4Cells < c.value;
    case 'text':
      return anyMatch(c.patterns, scrubbed);
    case 'plan':
      // Can only be judged once there is a plan.
      if (phase === 'pre' || !plan) return null;
      return anyMatch(c.patterns, planText(plan));
    case 'predicate':
      return evaluatePredicate(c.name, ctx, scrubbed);
  }
}

function ruleFires(rule: Rule, ctx: LintContext, scrubbed: string, plan: ClinicalPlan | null, phase: 'pre' | 'post'): boolean {
  const all = rule.when.all ?? [];
  const any = rule.when.any ?? [];
  const allResults = all.map((c) => conditionHolds(c, ctx, scrubbed, plan, phase));
  if (allResults.some((r) => r === null)) return false; // depends on the plan, which does not exist yet
  if (!allResults.every(Boolean)) return false;
  if (any.length > 0) return any.some((c) => conditionHolds(c, ctx, scrubbed, plan, phase) === true);
  return all.length > 0 || any.length > 0;
}

export interface RequiredElement { ruleId: string; ruleTitle: string; elementId: string; description: string }

/** Elements the plan must cover, known from the case alone. Used to brief the model before it writes. */
export function requiredElementsForCase(ctx: LintContext): RequiredElement[] {
  const scrubbed = stripNegatedSpans(ctx.caseText.toLowerCase());
  const out: RequiredElement[] = [];
  for (const rule of RULES) {
    if (!ruleFires(rule, ctx, scrubbed, null, 'pre')) continue;
    for (const r of rule.requires) out.push({ ruleId: rule.id, ruleTitle: rule.title, elementId: r.id, description: r.description });
  }
  return out;
}

export interface LintFinding extends RequiredElement { sources: string[] }

function satisfied(req: Requirement, plan: ClinicalPlan): boolean {
  if (req.decisionFor) {
    const target = re(req.decisionFor);
    return plan.existingTreatmentDecisions.some((d) => target.test(d.treatment) && !!d.reason);
  }
  const text = req.section === 'any' ? planText(plan) : sectionText(plan, req.section);
  return anyMatch(req.anyOf ?? [], text);
}

/** Missing required elements, for the case and the finished plan together (so `plan` triggers fire too). */
export function lintPlan(plan: ClinicalPlan, ctx: LintContext): LintFinding[] {
  const scrubbed = stripNegatedSpans(ctx.caseText.toLowerCase());
  const findings: LintFinding[] = [];
  for (const rule of RULES) {
    if (!ruleFires(rule, ctx, scrubbed, plan, 'post')) continue;
    for (const req of rule.requires) {
      if (!satisfied(req, plan)) {
        findings.push({ ruleId: rule.id, ruleTitle: rule.title, elementId: req.id, description: req.description, sources: rule.sources });
      }
    }
  }
  return findings;
}

export const ALL_RULE_IDS = RULES.map((r) => r.id);
