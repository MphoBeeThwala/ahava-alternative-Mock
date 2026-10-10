/**
 * Confidence calibration. Rules are documented in docs/CONFIDENCE_CALIBRATION.md;
 * keep that file in step with the constants below.
 *
 * Two different questions used to share one number:
 *   - triage confidence:     "how sure are we about HOW URGENT this is?"
 *   - diagnostic confidence: "how sure are we about WHAT this is?"
 * A patient can be clearly critically ill (triage confidence high) with the
 * cause unproven (diagnostic confidence moderate). The model's self-reported
 * figure is not a calibrated probability, so code caps it. Caps only ever
 * lower a value, never raise it.
 */
import { stripNegatedSpans } from '../triageSafety';

export type ConfirmationStatus = 'microbiologically_confirmed' | 'tissue_confirmed' | 'clinical_only';

/** Without microbiological or tissue confirmation, diagnostic confidence never exceeds this. */
export const UNCONFIRMED_CAP = 0.7;
/** A differential at or above this probability counts as still plausible. */
export const PLAUSIBLE_PROBABILITY = 0.15;
/** Cap when exactly two alternatives remain plausible / three or more do. */
export const TWO_PLAUSIBLE_CAP = 0.55;
export const MANY_PLAUSIBLE_CAP = 0.45;
/** Even a confirmed diagnosis is never reported as certain. */
export const CONFIRMED_CAP = 0.95;

export type ConfidenceBand = 'low' | 'moderate' | 'probable' | 'high';

export function bandFor(value: number): ConfidenceBand {
  return value < 0.4 ? 'low' : value < 0.6 ? 'moderate' : value < 0.8 ? 'probable' : 'high';
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// Positive confirmatory findings stated in the case. Deliberately narrow: this
// check can only DOWNGRADE a claimed confirmation, never grant one.
const CONFIRMATORY_PATTERNS: RegExp[] = [
  /\b(?:blood|csf|urine|sputum|tissue|marrow|pus|wound)?\s*cultures?\s+(?:grew|isolated|yielded|positive)\b/,
  /\b(?:genexpert|xpert(?: mtb\/rif)?|tb[- ]?lam|lf-?lam|urine lam|crag|cryptococcal antigen|histoplasma(?: urine)? antigen|urine histoplasma|pcr|afb smear|sputum smear|india ink|malaria (?:rdt|smear)|gram stain)\b[^.\n]{0,40}\b(?:positive|detected|reactive|seen|identified|grew)\b/,
  /\bpositive\s+(?:for\s+)?(?:genexpert|xpert|tb[- ]?lam|crag|cryptococcal antigen|histoplasma|pcr|culture|smear|afb)\b/,
  /\b(?:biopsy|histology|histopatholog\w*|cytology|bone marrow|trephine|aspirate)\b[^.\n]{0,80}\b(?:shows?|showed|confirm\w*|demonstrat\w*|reveal\w*|diagnostic of|consistent with|yeast|granuloma\w*|haemophagocyt\w*|hemophagocyt\w*|organisms?)\b/,
  /\b(?:confirmed|proven)\s+(?:by|on|with)\s+(?:culture|biopsy|histology|pcr|microscopy)\b/,
];

/** True when the supplied case text states a positive microbiological or tissue result. */
export function caseHasConfirmatoryEvidence(caseText: string): boolean {
  const text = stripNegatedSpans(caseText.toLowerCase());
  return CONFIRMATORY_PATTERNS.some((p) => p.test(text));
}

export interface CalibrationInput {
  /** The model's own triage-urgency confidence (0-1). */
  modelTriageConfidence: number;
  /** The model's own diagnostic confidence in the leading diagnosis (0-1). */
  modelDiagnosticConfidence: number;
  /** What the model says confirms the leading diagnosis. */
  claimedConfirmation: ConfirmationStatus;
  /** Probability of every differential other than the leading one; null/undefined when not given. */
  alternativeProbabilities: Array<number | null | undefined>;
  /** The supplied case text, used to check a claimed confirmation. */
  caseText: string;
  /** Evidence providers returned nothing: the existing 0.5 ceiling. */
  noReferenceEvidence?: boolean;
}

export interface CalibratedConfidence {
  triage: { value: number; band: ConfidenceBand };
  diagnostic: {
    value: number;
    band: ConfidenceBand;
    modelValue: number;
    confirmationStatus: ConfirmationStatus;
    plausibleAlternatives: number;
    appliedCaps: string[];
  };
}

export function calibrateConfidence(input: CalibrationInput): CalibratedConfidence {
  const triage = clamp01(finite(input.modelTriageConfidence) ? input.modelTriageConfidence : 0.45);
  const modelValue = clamp01(finite(input.modelDiagnosticConfidence) ? input.modelDiagnosticConfidence : 0.45);
  const appliedCaps: string[] = [];

  let confirmation = input.claimedConfirmation;
  if (confirmation !== 'clinical_only' && !caseHasConfirmatoryEvidence(input.caseText)) {
    appliedCaps.push('claimed confirmation not found in the case text: treated as unconfirmed');
    confirmation = 'clinical_only';
  }

  let value = modelValue;
  const capTo = (cap: number, why: string) => {
    if (value > cap) { value = cap; appliedCaps.push(why); }
  };

  if (confirmation === 'clinical_only') {
    capTo(UNCONFIRMED_CAP, `no microbiological or tissue confirmation: capped at ${UNCONFIRMED_CAP}`);
  } else {
    capTo(CONFIRMED_CAP, `capped at ${CONFIRMED_CAP}`);
  }

  const plausible = input.alternativeProbabilities.filter((p) => finite(p) && p >= PLAUSIBLE_PROBABILITY).length;
  if (plausible >= 3) capTo(MANY_PLAUSIBLE_CAP, `${plausible} plausible alternative diagnoses remain: capped at ${MANY_PLAUSIBLE_CAP}`);
  else if (plausible === 2) capTo(TWO_PLAUSIBLE_CAP, `2 plausible alternative diagnoses remain: capped at ${TWO_PLAUSIBLE_CAP}`);

  if (input.noReferenceEvidence) capTo(0.5, 'no reference evidence was available: capped at 0.5');

  value = Math.round(value * 100) / 100;
  return {
    triage: { value: Math.round(triage * 100) / 100, band: bandFor(triage) },
    diagnostic: {
      value, band: bandFor(value), modelValue, confirmationStatus: confirmation,
      plausibleAlternatives: plausible, appliedCaps,
    },
  };
}
