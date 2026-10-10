/**
 * Glue between the model's structured answer and the deterministic layers:
 * checks before, and after generation: dose stripping, blocked terms, the
 * completeness linter, calibration, and the flags a reviewing doctor sees.
 * Pure functions, no I/O, so the whole policy is unit-testable offline.
 */
import {
  evaluateClinicalChecks, findBlockedTerms, type BlockedTerm, type ClinicalChecks, type ClinicalFindings,
} from './clinicalChecks';
import { calibrateConfidence, type CalibratedConfidence } from './calibration';
import {
  deriveLegacyFields, extractCaseQuestions, stripDosesFromPlan, planText, type ClinicalPlan,
} from './clinicalPlan';
import { lintPlan, requiredElementsForCase, type LintContext, type LintFinding, type RequiredElement } from './completenessLinter';
import { cd4FromText, findingsFromVitals, hivFromText, mergeFindings } from './findingsFromInputs';
import { referenceVersions, selectTestLimitations, type TestLimitation } from './referenceData';
import { stripNegatedSpans, type TriageVitalsSnapshot } from '../triageSafety';

export interface ReviewerFlag {
  code: string;
  severity: 'high' | 'medium' | 'info';
  message: string;
}

export interface ClinicalContext {
  findings: ClinicalFindings;
  checks: ClinicalChecks;
  limitations: TestLimitation[];
  questions: string[];
  required: RequiredElement[];
  lintCtx: LintContext;
  cd4FromTextUsed: boolean;
}

export function prepareClinicalContext(input: {
  caseText: string;
  vitals?: TriageVitalsSnapshot | null;
  structured?: ClinicalFindings | null;
}): ClinicalContext {
  const scrubbed = stripNegatedSpans(input.caseText);
  // Structured values always win over text hints.
  const textHints: ClinicalFindings = {};
  const cd4Text = cd4FromText(input.caseText);
  if (cd4Text !== null) textHints.cd4Cells = cd4Text;
  const hiv = hivFromText(scrubbed);
  if (hiv !== null) textHints.hivPositive = hiv;
  const findings = mergeFindings(textHints, findingsFromVitals(input.vitals), input.structured);
  const cd4FromTextUsed = findings.cd4Cells !== undefined && findings.cd4Cells === textHints.cd4Cells
    && (input.structured?.cd4Cells === undefined || input.structured?.cd4Cells === null);

  const checks = evaluateClinicalChecks(findings);
  const lintCtx: LintContext = { caseText: input.caseText, findings, checks };
  return {
    findings, checks, lintCtx, cd4FromTextUsed,
    limitations: selectTestLimitations(input.caseText, findings.cd4Cells ?? null),
    questions: extractCaseQuestions(input.caseText),
    required: requiredElementsForCase(lintCtx),
  };
}

export interface PlanAssessment {
  plan: ClinicalPlan;
  lint: LintFinding[];
  blocked: BlockedTerm[];
  dosesRemoved: number;
  calibration: CalibratedConfidence;
  /** Everything wrong that a re-prompt could fix. */
  repairIssues: string[];
}

export function assessPlan(
  planIn: ClinicalPlan,
  schemaIssues: string[],
  ctx: ClinicalContext,
  caseText: string,
  opts: { noReferenceEvidence?: boolean } = {},
): PlanAssessment {
  const { plan, removed } = stripDosesFromPlan(planIn);
  const lint = lintPlan(plan, ctx.lintCtx);
  const blocked = findBlockedTerms(planText(plan), ctx.checks);
  const calibration = calibrateConfidence({
    modelTriageConfidence: plan.triageConfidence,
    modelDiagnosticConfidence: plan.leadingDiagnosis.probability,
    claimedConfirmation: plan.leadingDiagnosis.confirmationStatus,
    alternativeProbabilities: plan.differential.map((d) => d.probability),
    caseText,
    noReferenceEvidence: opts.noReferenceEvidence,
  });
  const repairIssues = [
    ...schemaIssues,
    ...lint.map((l) => `Missing (${l.ruleTitle}): ${l.description}.`),
    ...blocked.map((b) => `Unsupported term "${b.term}" ("...${b.excerpt}..."): ${b.reason}. Remove or rephrase it.`),
  ];
  return { plan, lint, blocked, dosesRemoved: removed, calibration, repairIssues };
}

export interface StructuredPlanRecord {
  schemaVersion: 1;
  /** The tiered plan contains drug names and clinical detail: clinician view only. */
  audience: 'clinician_only';
  plan: ClinicalPlan;
  checks: ClinicalChecks;
  calibration: CalibratedConfidence;
  lintRemaining: LintFinding[];
  blockedTermsRemaining: BlockedTerm[];
  reviewerFlags: ReviewerFlag[];
  references: ReturnType<typeof referenceVersions>;
  repairRounds: number;
  dosesRemoved: number;
}

export function buildRecord(
  a: PlanAssessment,
  ctx: ClinicalContext,
  extra: { schemaIssuesRemaining: string[]; repairRounds: number },
): StructuredPlanRecord {
  const flags: ReviewerFlag[] = [];
  if (extra.schemaIssuesRemaining.length > 0) {
    flags.push({ code: 'PLAN_SCHEMA_INCOMPLETE', severity: 'high', message: `The plan is missing required content: ${extra.schemaIssuesRemaining.join(' | ')}` });
  }
  for (const l of a.lint) {
    flags.push({ code: 'COMPLETENESS_GAP', severity: 'high', message: `${l.ruleTitle}: the plan does not address ${l.description}. Add it yourself.` });
  }
  for (const b of a.blocked) {
    flags.push({ code: 'UNSUPPORTED_TERM', severity: 'high', message: `"${b.term}" is used but ${b.reason}` });
  }
  if (a.dosesRemoved > 0) {
    flags.push({ code: 'DOSE_REMOVED', severity: 'info', message: `${a.dosesRemoved} model-written dose(s) were removed. Doses are not generated; use the guideline.` });
  }
  if (a.calibration.diagnostic.appliedCaps.length > 0) {
    flags.push({ code: 'CONFIDENCE_CAPPED', severity: 'info', message: `Diagnostic confidence reduced from ${a.calibration.diagnostic.modelValue} to ${a.calibration.diagnostic.value}: ${a.calibration.diagnostic.appliedCaps.join('; ')}` });
  }
  const c = ctx.checks;
  if (c.septicShock.status === 'not_assessable') {
    flags.push({ code: 'CHECK_NOT_ASSESSABLE', severity: 'info', message: `Septic-shock criteria could not be assessed (missing: ${c.septicShock.missing.join(', ')}).` });
  }
  if (ctx.cd4FromTextUsed) {
    flags.push({ code: 'CD4_FROM_TEXT', severity: 'info', message: `CD4 ${ctx.findings.cd4Cells} was read from the case text, not from a structured field. Check it.` });
  }
  const refs = referenceVersions();
  const pending = Object.entries(refs).filter(([, v]) => v.signoff !== 'signed_off').map(([k]) => k);
  if (pending.length > 0) {
    flags.push({ code: 'REFERENCE_PENDING_SIGNOFF', severity: 'info', message: `Not yet clinically signed off: ${pending.join(', ')}. Treat the checklists as drafts.` });
  }
  return {
    schemaVersion: 1, audience: 'clinician_only',
    plan: a.plan, checks: c, calibration: a.calibration,
    lintRemaining: a.lint, blockedTermsRemaining: a.blocked,
    reviewerFlags: flags, references: refs, repairRounds: extra.repairRounds, dosesRemoved: a.dosesRemoved,
  };
}

/** The single-string legacy fields, derived from the plan. */
export const legacyFromPlan = deriveLegacyFields;
