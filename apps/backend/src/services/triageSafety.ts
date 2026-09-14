import { scoreTews, tewsColorToSatsLevel, tewsFlagName, type Avpu, type Mobility } from './triageThresholds/tews';

export interface TriageVitalsSnapshot {
    heartRateResting?: number | null;
    oxygenSaturation?: number | null;
    respiratoryRate?: number | null;
    temperature?: number | null;
    bloodPressureSystolic?: number | null;
    bloodPressureDiastolic?: number | null;
    hrvRmssd?: number | null;
    // AH-47: SATS TEWS parameters not carried by any existing wearable or
    // manual-entry field. Optional because nothing in the product collects
    // them yet — when absent, that TEWS parameter scores as "not assessed"
    // (contributes 0, flagged TEWS_MISSING_*), not assumed normal.
    avpu?: Avpu | null;
    mobility?: Mobility | null;
    trauma?: boolean | null;
}

export interface DeterministicRiskPatient {
    ageYears?: number | null;
    heightCm?: number | null;
}

export interface DeterministicRiskAssessment {
    minTriageLevel: 1 | 2 | 3 | 4 | 5;
    hardFlags: string[];
    cautionFlags: string[];
}

function hasAnyPattern(input: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(input));
}

// AH-48 gap report: the patterns below are plain substring/regex matches with
// no negation awareness, so "no numbness, no problems passing urine" matched
// identically to "numbness" and "problems passing urine" being present. This
// masks the clause following a negation trigger (up to the next clause
// boundary) before any red-flag pattern runs against it — a lightweight,
// NegEx-style approach, not a full parse. It has the same known blind spot
// every simple negation detector has: a phrase like "not able to move my arm"
// negates ability, not a symptom, and can be masked along with genuine
// denials. That tradeoff is accepted here because the alternative — no
// negation handling at all — is strictly worse (a plain denial escalating a
// case identically to the real symptom).
// "not breathing" and "no pulse" are themselves red-flag phrases below (the
// negation word IS the symptom, not a denial of one) — excluded so this
// doesn't mask the very phrase it's meant to protect.
const NEGATION_TRIGGER = /\b(?:no(?!\s+pulse\b)|not(?!\s+breathing\b)|denies|denied|without|negative for|ruled out|absence of)\b[^,.;!?]*/gi;

function stripNegatedSpans(text: string): string {
    return text.replace(NEGATION_TRIGGER, (match) => ' '.repeat(match.length));
}

export function assessDeterministicRisk(
    symptoms: string,
    vitals?: TriageVitalsSnapshot | null,
    patient?: DeterministicRiskPatient | null
): DeterministicRiskAssessment {
    const normalizedSymptoms = symptoms.toLowerCase();
    const negationScrubbedSymptoms = stripNegatedSpans(normalizedSymptoms);
    const hardFlags: string[] = [];
    const cautionFlags: string[] = [];
    let minTriageLevel: 1 | 2 | 3 | 4 | 5 = 5;

    // Level 1 (Resuscitation) - Immediate life-threatening conditions
    //
    // AH-24: these were singular- and \b-anchored, so a patient writing
    // "he is having seizures" or "she collapsed" (vs. "is collapsing") was
    // never escalated. Every countable-noun / verb-tense pattern below now
    // accepts the plural or the other common inflection.
    //
    // AH-47 §47.4: this list (plus saSpecificPatterns.level1 below) IS the
    // SATS "emergency signs" (ABCccD) override — any match here already
    // forces level 1 unconditionally, ahead of any vital-sign scoring, which
    // is exactly the override architecture SATS specifies. Added stridor and
    // severe respiratory distress, named explicitly in the gap report as
    // signs this list was missing (a TEWS score alone can under-triage a
    // child with stridor — the override is what catches it instead).
    const level1Patterns = [
        /\bunconscious\b/,
        /\bunresponsive\b/,
        /\bseizures?\b/,
        /\bstrokes?\b/,
        /\bone[-\s]?sided weakness\b/,
        /\bblue lips\b/,
        /\bsevere bleeding\b/,
        /\bnot breathing\b/,
        /\bcardiac arrest\b/,
        /\boverdos(?:e|es|ed|ing)\b/,
        /\bsuicid(al|e|es)\b/,
        /\banaphylaxis\b/,
        /\banaphylactic shock\b/,
        /\bcannot speak\b/,
        /\bchok(?:ing|ed)\b/,
        /\bcollaps(?:ed|ing)\b/,
        /\bno pulse\b/,
        /\bstridor\b/,
        /\bsevere respiratory distress\b/,
    ];

    // Level 2 (Emergency) - High-risk conditions requiring urgent care
    const level2Patterns = [
        /\bchest pains?\b/,
        /\bshort(ness)? of breath\b/,
        /\bdifficulty breathing\b/,
        /\bconfusion\b/,
        /\bhigh fevers?\b/,
        /\bblood in (stool|urine|vomit|sputum|cough)\b/,
        /\bpregnan(t|cy).*(bleed|pain|vaginal bleeding)\b/,
        /\bsevere abdominal pains?\b/,
        /\bsevere headaches?\b/,
        /\bvision changes?\b/,
        /\bspeech difficult(?:y|ies)\b/,
        /\bweakness on one side\b/,
        /\bdrooping face\b/,
        /\bnumbs?ness\b/,
        /\bparalysis\b/,
    ];

    // South Africa-specific patterns (TB, HIV, Malaria endemic regions)
    const saSpecificPatterns = {
        level1: [
            /\bsevere immunodeficiency\b/,
            /\bopportunistic infections?\b/,
        ],
        level2: [
            // TB symptoms (endemic in SA - high burden globally)
            /\bcough.*(blood|bloody)\b/,
            /\bcoughing up blood\b/,
            /\bhaemoptysis\b/,
            /\bnight sweats?\b/,
            /\bweight loss.*(unintentional|unexplained)\b/,
            /\bpersistent cough\b/,
            /\bcough for (more than|over) (2|three) weeks\b/,
            // HIV/AIDS related (13% prevalence in SA adults)
            /\bfever.*night sweats?\b/,
            // AH-24: accept both the British ("diarrhoea") and American
            // ("diarrhea") spelling — either is plausible from a patient.
            /\bchronic diarrh(?:o)?ea\b/,
            /\boral thrush\b/,
            /\bwhite patch(?:es)?.*mouth\b/,
            /\bpersistent fevers?\b/,
            /\bunexplained weight loss\b/,
            // Malaria (endemic in Limpopo, KwaZulu-Natal low-lying areas)
            /\bfever.*chills?\b/,
            /\bcyclic fevers?\b/,
            /\bmalaria\b/,
            /\btravel.*(limpopo|kwazulu|mozambique|zimbabwe)\b/,
            // Diabetes complications (high prevalence in SA)
            /\bdiabetic.*ketoacidosis\b/,
            // AH-24: `normalizedSymptoms` is lower-cased before matching
            // (see above), so the literal-uppercase /\bDKA\b/ that shipped
            // here could never match anything — fixed to lower-case.
            /\bdka\b/,
            /\bfruity breath\b/,
            /\bexcessive thirst\b/,
            /\bfrequent urination.*excessive\b/,
            // Hypertension complications
            /\bsevere hypertension\b/,
            /\bheadaches?.*blurred vision\b/,
            // Pediatric emergencies (accept British "paediatric" too)
            /\bchild(?:ren)?.*high fevers?\b/,
            /\bbab(?:y|ies).*fevers?\b/,
            /\b(?:pediatric|paediatric).*dehydration\b/,
            /\bchild(?:ren)?.*difficulty breathing\b/,
            // Obstetric emergencies
            /\bpregnan(t|cy).*severe headaches?\b/,
            /\bpregnan(t|cy).*visual disturbances?\b/,
            /\bpregnan(t|cy).*abdominal pains?\b/,
            /\bpregnan(t|cy).*decreased f(?:e|oe)tal movements?\b/,
            /\bwaters? broke\b/,
            /\blabou?r.*pains?\b/,
            // Trauma
            /\bhead.*injur(?:y|ies)\b/,
            /\bfractures?\b/,
            /\bbroken bones?\b/,
            /\bsevere pains?.*injur(?:y|ies)\b/,
        ],
    };

    // Check Level 1 patterns first (highest priority)
    if (hasAnyPattern(negationScrubbedSymptoms, level1Patterns)) {
        hardFlags.push('CRITICAL_SYMPTOM_PATTERN');
        minTriageLevel = 1;
    }

    // Check SA-specific Level 1 patterns
    if (hasAnyPattern(negationScrubbedSymptoms, saSpecificPatterns.level1 || [])) {
        hardFlags.push('SA_CRITICAL_CONDITION');
        minTriageLevel = 1;
    }

    // Check Level 2 patterns
    if (minTriageLevel > 2 && hasAnyPattern(negationScrubbedSymptoms, level2Patterns)) {
        cautionFlags.push('HIGH_RISK_SYMPTOM_PATTERN');
        minTriageLevel = 2;
    }

    // Check SA-specific Level 2 patterns
    if (minTriageLevel > 2 && hasAnyPattern(negationScrubbedSymptoms, saSpecificPatterns.level2 || [])) {
        cautionFlags.push('SA_HIGH_RISK_CONDITION');
        minTriageLevel = 2;
    }

    // Vital signs assessment — AH-47/AH-44: replaced the old independent,
    // adult-only if/elif thresholds with a scored TEWS (the actual SATS
    // composite score), selected by age/height band. See
    // triageThresholds/tews.ts and paediatricTews.json — NOT YET
    // clinician-signed (that file's reviewedBy/reviewedOn are null).
    if (vitals) {
        const ageYears = patient?.ageYears ?? null;
        const heightCm = patient?.heightCm ?? null;

        // §47.1: an unknown-age patient is an incomplete assessment, not an
        // adult — never silently apply the adult chart. Only applies when
        // there are vitals to score in the first place; a symptom-only
        // submission with no age isn't misapplying any chart.
        if (ageYears == null && heightCm == null) {
            hardFlags.push('AGE_UNKNOWN');
            if (minTriageLevel > 2) minTriageLevel = 2;
        } else {
            const tewsResult = scoreTews(ageYears, heightCm, {
                respiratoryRate: vitals.respiratoryRate ?? null,
                heartRate: vitals.heartRateResting ?? null,
                temperature: vitals.temperature ?? null,
                systolicBp: vitals.bloodPressureSystolic ?? null,
                avpu: vitals.avpu ?? null,
                mobility: vitals.mobility ?? null,
                trauma: vitals.trauma ?? null,
            });

            if (!('ageUnknown' in tewsResult)) {
                const tewsLevel = tewsColorToSatsLevel(tewsResult.color, tewsResult.total);
                if (tewsLevel < minTriageLevel) minTriageLevel = tewsLevel;

                if (tewsResult.color === 'RED' || tewsResult.color === 'ORANGE') {
                    hardFlags.push(`TEWS_${tewsResult.color}_${tewsResult.band.toUpperCase()}`);
                } else if (tewsResult.color === 'YELLOW') {
                    cautionFlags.push(`TEWS_${tewsResult.color}_${tewsResult.band.toUpperCase()}`);
                }

                for (const [param, score] of Object.entries(tewsResult.perParameterScore)) {
                    if (score == null || score === 0) continue;
                    // Physiological parameters (HR/RR/temp/SBP) score both
                    // directions of abnormality, so any nonzero score is
                    // worth flagging. AVPU/mobility/trauma are ordinal with
                    // one canonical best-possible value each ("alert",
                    // "normal", no trauma) that can still land on a negative
                    // score by design (see contributionOf in tews.ts) — that
                    // specific best value is a reassuring finding, not a
                    // discriminator, so it's the only categorical case
                    // excluded here. A non-floor value that happens to still
                    // be negative (e.g. AVPU "voice") is still flagged: it's
                    // worse than the best state even though its score isn't
                    // positive.
                    const isBestPossibleOrdinal =
                        (param === 'avpu' && vitals.avpu === 'alert') ||
                        (param === 'mobility' && vitals.mobility === 'normal') ||
                        (param === 'trauma' && vitals.trauma === false);
                    if (isBestPossibleOrdinal) continue;
                    (Math.abs(score) >= 3 ? hardFlags : cautionFlags).push(tewsFlagName(param, score));
                }
                for (const missingParam of tewsResult.missingParameters) {
                    cautionFlags.push(`TEWS_MISSING_${missingParam.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
                }
            }
        }

        // SpO2 — AH-50 §50.4: NEWS2 Scale 1, absolute only, no baseline or
        // band dependence. A 42-study review found pulse oximeters
        // consistently overestimate saturation in darker skin tones, worst
        // at low readings — the bias runs in the dangerous direction for
        // this population — but self-reported race is not a valid proxy for
        // skin colour, so this builds in margin instead of a race-based
        // correction. A 92–96% reading from a consumer device is treated as
        // indeterminate, not reassuring: it escalates alongside any
        // respiratory-rate deviation already flagged by TEWS, rather than
        // being cleared on its own.
        const spo2 = Number(vitals.oxygenSaturation ?? NaN);
        if (!Number.isNaN(spo2)) {
            if (spo2 <= 91) {
                hardFlags.push('NEWS2_SPO2_CRITICAL');
                if (minTriageLevel > 1) minTriageLevel = 1;
            } else if (spo2 <= 93) {
                cautionFlags.push('NEWS2_SPO2_LOW');
                if (minTriageLevel > 2) minTriageLevel = 2;
            } else if (spo2 <= 96) {
                cautionFlags.push('SPO2_INDETERMINATE_CONSUMER_DEVICE');
                const hasRespiratoryDeviation = [...hardFlags, ...cautionFlags].some((f) =>
                    f.startsWith('TEWS_RESPIRATORY_RATE_SCORE_')
                );
                if (hasRespiratoryDeviation && minTriageLevel > 2) minTriageLevel = 2;
            }
        }

        // HRV — not a TEWS parameter; kept as a supplementary caution signal
        // exactly as before (unchanged by AH-47/AH-44/AH-50).
        const hrv = Number(vitals.hrvRmssd ?? NaN);
        if (!Number.isNaN(hrv)) {
            if (hrv <= 15 && minTriageLevel > 2) {
                cautionFlags.push('LOW_HRV');
                minTriageLevel = 2;
            } else if (hrv <= 20 && minTriageLevel > 3) {
                cautionFlags.push('REDUCED_HRV');
                minTriageLevel = 3;
            }
        }
    }

    return { minTriageLevel, hardFlags, cautionFlags };
}

/**
 * Check if image evidence forces doctor review
 * When an image is submitted but VisualDx is not enabled, force review
 */
export function checkImageEvidence(imageSubmitted: boolean, visualDxEnabled: boolean = false): { forceReview: boolean; flag?: string } {
  if (imageSubmitted && !visualDxEnabled) {
    return { forceReview: true, flag: 'IMAGE_EVIDENCE_MISSING' };
  }
  return { forceReview: false };
}
