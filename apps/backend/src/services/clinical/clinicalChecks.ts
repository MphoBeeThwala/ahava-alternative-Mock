/**
 * Deterministic clinical checks: computed in code from structured values
 * BEFORE the model reasons, then handed to it as facts. The model does not
 * get to decide whether, say, a patient is in septic shock; the criteria are
 * either met, not met, or NOT ASSESSABLE because an input is missing.
 *
 * The third state is the whole point. A missing lactate is not a normal
 * lactate. Every check returns `not_assessable` rather than guessing, and
 * where a score can still move (HScore, HLH-2004) it reports the range the
 * missing inputs leave open.
 *
 * NEEDS CLINICAL SIGN-OFF (docs/CLINICAL_SIGNOFF_CHECKLIST.md): every
 * threshold below is from the cited publication, and has not yet been
 * reviewed by a clinician for this product.
 */

export type Criterion = 'met' | 'not_met' | 'not_assessable';

/** Structured inputs. Anything unknown is null/undefined, never assumed normal. */
export interface ClinicalFindings {
  ageYears?: number | null;
  sex?: 'M' | 'F' | null;
  // vitals
  sbp?: number | null;
  dbp?: number | null;
  hr?: number | null;
  rr?: number | null;
  tempC?: number | null;
  spo2?: number | null;
  gcs?: number | null;
  // bedside / chemistry (SI units: mmol/L unless stated)
  lactateMmol?: number | null;
  sodiumMmol?: number | null;
  glucoseMmol?: number | null;
  potassiumMmol?: number | null;
  creatinineUmol?: number | null;
  // haematology
  haemoglobinGdl?: number | null;
  wbcX10e9?: number | null;
  plateletsX10e9?: number | null;
  neutrophilsX10e9?: number | null;
  // HLH-related
  ferritinUgL?: number | null; // ug/L == ng/mL
  triglyceridesMmol?: number | null;
  fibrinogenGL?: number | null;
  astUL?: number | null;
  solubleCd25UmL?: number | null;
  // immunology
  cd4Cells?: number | null;
  hivPositive?: boolean | null;
  // examination / status (tri-state: true, false, or unknown)
  alteredMentation?: boolean | null;
  vasopressorsRequired?: boolean | null;
  fluidResuscitated?: boolean | null;
  splenomegaly?: boolean | null;
  hepatomegaly?: boolean | null;
  marrowHaemophagocytosis?: boolean | null;
  lowNkActivity?: boolean | null;
  suspectedInfection?: boolean | null;
  onTbTreatment?: boolean | null;
}

const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- MAP -------------------------------------------------------------------

export function computeMap(sbp?: number | null, dbp?: number | null): number | null {
  if (!has(sbp) || !has(dbp)) return null;
  return round1((sbp + 2 * dbp) / 3);
}

// ---- qSOFA -----------------------------------------------------------------

export interface QSofaResult {
  score: number;
  assessedComponents: number;
  /** met = score >= 2 (a screening flag, not a diagnosis). */
  status: Criterion;
  components: { rrGe22: Criterion; sbpLe100: Criterion; alteredMentation: Criterion };
}

export function computeQSofa(f: ClinicalFindings): QSofaResult {
  const mentation: Criterion =
    f.alteredMentation === true || (has(f.gcs) && f.gcs < 15) ? 'met'
      : f.alteredMentation === false || (has(f.gcs) && f.gcs >= 15) ? 'not_met'
        : 'not_assessable';
  const components = {
    rrGe22: (has(f.rr) ? (f.rr >= 22 ? 'met' : 'not_met') : 'not_assessable') as Criterion,
    sbpLe100: (has(f.sbp) ? (f.sbp <= 100 ? 'met' : 'not_met') : 'not_assessable') as Criterion,
    alteredMentation: mentation,
  };
  const values = Object.values(components);
  const score = values.filter((v) => v === 'met').length;
  const unknown = values.filter((v) => v === 'not_assessable').length;
  const status: Criterion = score >= 2 ? 'met' : score + unknown >= 2 ? 'not_assessable' : 'not_met';
  return { score, assessedComponents: 3 - unknown, status, components };
}

// ---- Sepsis-3 septic shock ---------------------------------------------------

export interface SepticShockResult {
  status: Criterion;
  map: number | null;
  hypotensive: Criterion; // MAP < 65
  /** What is missing for the criteria to be judged. */
  missing: string[];
  reason: string;
}

/**
 * Sepsis-3 (Singer et al., JAMA 2016): septic shock = sepsis with a vasopressor
 * requirement to keep MAP >= 65 mmHg AND lactate > 2 mmol/L despite adequate
 * fluid resuscitation. Hypotension alone, or a high lactate alone, is not it.
 */
export function evaluateSepticShock(f: ClinicalFindings): SepticShockResult {
  const map = computeMap(f.sbp, f.dbp);
  const hypotensive: Criterion = map === null ? 'not_assessable' : map < 65 ? 'met' : 'not_met';
  const missing: string[] = [];
  if (!has(f.lactateMmol)) missing.push('lactate');
  if (f.vasopressorsRequired === null || f.vasopressorsRequired === undefined) missing.push('vasopressor requirement');

  const lactateHigh = has(f.lactateMmol) ? f.lactateMmol > 2 : null;
  if (f.vasopressorsRequired === false) {
    return { status: 'not_met', map, hypotensive, missing: [], reason: 'No vasopressor requirement, so Sepsis-3 septic-shock criteria are not met.' };
  }
  if (lactateHigh === false) {
    return { status: 'not_met', map, hypotensive, missing: [], reason: `Lactate ${f.lactateMmol} mmol/L is not above 2, so Sepsis-3 septic-shock criteria are not met.` };
  }
  if (f.vasopressorsRequired === true && lactateHigh === true) {
    return {
      status: 'met', map, hypotensive, missing: [],
      reason: `Vasopressors required and lactate ${f.lactateMmol} mmol/L > 2${f.fluidResuscitated === false ? ' (adequacy of fluid resuscitation not confirmed)' : ''}: Sepsis-3 septic-shock criteria met.`,
    };
  }
  return {
    status: 'not_assessable', map, hypotensive, missing,
    reason: `Septic-shock criteria cannot be judged: missing ${missing.join(' and ') || 'inputs'}. ` +
      (map !== null ? `MAP is ${map} mmHg${map >= 65 ? ' (>= 65: not hypotensive by MAP)' : ' (< 65)'}. ` : '') +
      'Do not label the patient as being in septic shock unless a clinician documents the criteria.',
  };
}

// ---- Corrected sodium -------------------------------------------------------

export interface CorrectedSodium {
  measured: number;
  corrected: number;
  /** Katz factor 1.6 mmol/L per 5.6 mmol/L glucose above normal. Hillier (2.4) gives a larger correction. */
  factor: 1.6;
  hyponatraemia: Criterion;
  note: string;
}

export function computeCorrectedSodium(f: ClinicalFindings): CorrectedSodium | null {
  if (!has(f.sodiumMmol) || !has(f.glucoseMmol)) return null;
  const excess = Math.max(0, f.glucoseMmol - 5.6);
  const corrected = round1(f.sodiumMmol + (1.6 * excess) / 5.6);
  return {
    measured: f.sodiumMmol,
    corrected,
    factor: 1.6,
    hyponatraemia: corrected < 135 ? 'met' : 'not_met',
    note: excess > 0
      ? `Glucose ${f.glucoseMmol} mmol/L raises the measured sodium's apparent value; corrected sodium ${corrected} mmol/L.`
      : 'Glucose is not elevated, so no correction applied.',
  };
}

// ---- eGFR (CKD-EPI 2021, race-free) -------------------------------------------

export function computeEgfr(f: ClinicalFindings): number | null {
  if (!has(f.creatinineUmol) || !has(f.ageYears) || !f.sex) return null;
  const scr = f.creatinineUmol / 88.4;
  const female = f.sex === 'F';
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const egfr = 142 * Math.pow(Math.min(scr / kappa, 1), alpha) * Math.pow(Math.max(scr / kappa, 1), -1.2)
    * Math.pow(0.9938, f.ageYears) * (female ? 1.012 : 1);
  return Math.round(egfr);
}

// ---- HLH-2004 ---------------------------------------------------------------

export interface CriterionLine { name: string; status: Criterion; detail: string }
export interface Hlh2004Result {
  metCount: number;
  notAssessableCount: number;
  /** Most criteria that could be met if every missing input came back positive. */
  maxPossible: number;
  /** >= 5 of 8 criteria. */
  status: Criterion;
  criteria: CriterionLine[];
}

/** HLH-2004 (Henter et al., Pediatr Blood Cancer 2007): 5 of 8 criteria. The molecular-diagnosis route is not computed. */
export function evaluateHlh2004(f: ClinicalFindings): Hlh2004Result {
  const tri = (v: boolean | null | undefined): Criterion => (v === true ? 'met' : v === false ? 'not_met' : 'not_assessable');
  const lineages = [
    has(f.haemoglobinGdl) ? f.haemoglobinGdl < 9 : null,
    has(f.plateletsX10e9) ? f.plateletsX10e9 < 100 : null,
    has(f.neutrophilsX10e9) ? f.neutrophilsX10e9 < 1.0 : null,
  ];
  const cytMet = lineages.filter((v) => v === true).length;
  const cytUnknown = lineages.filter((v) => v === null).length;
  const cytopenias: Criterion = cytMet >= 2 ? 'met' : cytMet + cytUnknown >= 2 ? 'not_assessable' : 'not_met';

  const tgHigh = has(f.triglyceridesMmol) ? f.triglyceridesMmol >= 3.0 : null;
  const fibLow = has(f.fibrinogenGL) ? f.fibrinogenGL <= 1.5 : null;
  const lipid: Criterion = tgHigh === true || fibLow === true ? 'met' : tgHigh === false && fibLow === false ? 'not_met' : 'not_assessable';

  const criteria: CriterionLine[] = [
    { name: 'Fever >= 38.5 C', status: has(f.tempC) ? (f.tempC >= 38.5 ? 'met' : 'not_met') : 'not_assessable', detail: has(f.tempC) ? `${f.tempC} C` : 'temperature not recorded' },
    { name: 'Splenomegaly', status: tri(f.splenomegaly), detail: 'examination/imaging' },
    { name: 'Cytopenias in >= 2 of 3 lineages (Hb < 9 g/dL, platelets < 100, neutrophils < 1.0 x10^9/L)', status: cytopenias, detail: `${cytMet} lineage(s) met, ${cytUnknown} unknown` },
    { name: 'Triglycerides >= 3.0 mmol/L (fasting) and/or fibrinogen <= 1.5 g/L', status: lipid, detail: `TG ${has(f.triglyceridesMmol) ? f.triglyceridesMmol : '?'}, fibrinogen ${has(f.fibrinogenGL) ? f.fibrinogenGL : '?'}` },
    { name: 'Haemophagocytosis in marrow, spleen, node or liver', status: tri(f.marrowHaemophagocytosis), detail: 'needs tissue' },
    { name: 'Low or absent NK-cell activity', status: tri(f.lowNkActivity), detail: 'specialist assay' },
    { name: 'Ferritin >= 500 ug/L', status: has(f.ferritinUgL) ? (f.ferritinUgL >= 500 ? 'met' : 'not_met') : 'not_assessable', detail: has(f.ferritinUgL) ? `${f.ferritinUgL} ug/L` : 'ferritin not available' },
    { name: 'Soluble CD25 (sIL-2R) >= 2400 U/mL', status: has(f.solubleCd25UmL) ? (f.solubleCd25UmL >= 2400 ? 'met' : 'not_met') : 'not_assessable', detail: has(f.solubleCd25UmL) ? `${f.solubleCd25UmL} U/mL` : 'not available' },
  ];
  const metCount = criteria.filter((c) => c.status === 'met').length;
  const notAssessableCount = criteria.filter((c) => c.status === 'not_assessable').length;
  const maxPossible = metCount + notAssessableCount;
  return {
    metCount, notAssessableCount, maxPossible, criteria,
    status: metCount >= 5 ? 'met' : maxPossible >= 5 ? 'not_assessable' : 'not_met',
  };
}

// ---- HScore (Fardet et al., Arthritis Rheumatol 2014) ------------------------

export interface HScoreResult {
  scoreMin: number;
  scoreMax: number;
  missing: string[];
  /** HScore >= 169 is the published cut-off (sensitivity 93%, specificity 86%). */
  status: Criterion;
}

export function computeHScore(f: ClinicalFindings): HScoreResult {
  let min = 0;
  let max = 0;
  const missing: string[] = [];
  const add = (known: number | null, ifUnknownMax: number, name: string) => {
    if (known === null) { max += ifUnknownMax; missing.push(name); } else { min += known; max += known; }
  };

  // HIV-negative does not exclude other immunosuppression (steroids etc.), so only a positive result is scored.
  add(f.hivPositive === true ? 18 : null, 18, 'known immunosuppression');
  add(has(f.tempC) ? (f.tempC < 38.4 ? 0 : f.tempC <= 39.4 ? 33 : 49) : null, 49, 'temperature');

  // Organomegaly: none 0, hepatomegaly OR splenomegaly 23, both 38
  const organTrue = (f.hepatomegaly === true ? 1 : 0) + (f.splenomegaly === true ? 1 : 0);
  const organUnknown = (f.hepatomegaly == null ? 1 : 0) + (f.splenomegaly == null ? 1 : 0);
  const organPts = (n: number) => (n >= 2 ? 38 : n === 1 ? 23 : 0);
  min += organPts(organTrue);
  max += organPts(organTrue + organUnknown);
  if (organUnknown > 0) missing.push('organomegaly');

  // Cytopenias: Hb <= 9.2 g/dL, WBC <= 5.0, platelets <= 110; 2 lineages 24, 3 lineages 34
  const cyt = [
    has(f.haemoglobinGdl) ? f.haemoglobinGdl <= 9.2 : null,
    has(f.wbcX10e9) ? f.wbcX10e9 <= 5.0 : null,
    has(f.plateletsX10e9) ? f.plateletsX10e9 <= 110 : null,
  ];
  const cm = cyt.filter((v) => v === true).length;
  const cu = cyt.filter((v) => v === null).length;
  const pts = (n: number) => (n >= 3 ? 34 : n === 2 ? 24 : 0);
  min += pts(cm);
  max += pts(cm + cu);
  if (cu > 0) missing.push('full blood count');

  add(has(f.ferritinUgL) ? (f.ferritinUgL < 2000 ? 0 : f.ferritinUgL <= 6000 ? 35 : 50) : null, 50, 'ferritin');
  add(has(f.triglyceridesMmol) ? (f.triglyceridesMmol < 1.5 ? 0 : f.triglyceridesMmol <= 4 ? 44 : 64) : null, 64, 'triglycerides');
  add(has(f.fibrinogenGL) ? (f.fibrinogenGL > 2.5 ? 0 : 30) : null, 30, 'fibrinogen');
  add(has(f.astUL) ? (f.astUL < 30 ? 0 : 19) : null, 19, 'AST');
  add(f.marrowHaemophagocytosis === true ? 35 : f.marrowHaemophagocytosis === false ? 0 : null, 35, 'bone marrow haemophagocytosis');

  return { scoreMin: min, scoreMax: max, missing, status: min >= 169 ? 'met' : max < 169 ? 'not_met' : 'not_assessable' };
}

// ---- CD4-based triggers ---------------------------------------------------------

export interface Cd4Triggers {
  cd4: number;
  advancedHivDisease: boolean; // < 200 (WHO definition)
  crAgScreeningIndicated: boolean;
  tbLamIndicated: boolean;
  cotrimoxazoleProphylaxisIndicated: boolean;
  /** < 100: highest risk of disseminated opportunistic infection. */
  veryAdvanced: boolean;
  /** < 50: add MAC/CMV considerations. */
  profound: boolean;
  notes: string[];
}

/** Thresholds are from cd4Thresholds in rules/completenessRules.json's source guidelines; see sign-off status there. */
export function computeCd4Triggers(f: ClinicalFindings): Cd4Triggers | null {
  if (!has(f.cd4Cells) || f.hivPositive === false) return null;
  const cd4 = f.cd4Cells;
  const advanced = cd4 < 200;
  const notes: string[] = [];
  if (advanced) notes.push('CD4 < 200: advanced HIV disease package (screen for TB and cryptococcus, cotrimoxazole prophylaxis, plan ART timing).');
  if (cd4 < 100) notes.push('CD4 < 100: highest risk of disseminated opportunistic infection (cryptococcus, histoplasma, TB, PJP); a negative single test does not rule these out.');
  if (cd4 < 50) notes.push('CD4 < 50: also consider disseminated MAC and CMV disease.');
  return {
    cd4, advancedHivDisease: advanced,
    crAgScreeningIndicated: advanced, tbLamIndicated: advanced, cotrimoxazoleProphylaxisIndicated: advanced,
    veryAdvanced: cd4 < 100, profound: cd4 < 50, notes,
  };
}

// ---- Aggregate ----------------------------------------------------------------

export interface ClinicalChecks {
  map: number | null;
  qsofa: QSofaResult;
  septicShock: SepticShockResult;
  hlh2004: Hlh2004Result;
  hScore: HScoreResult;
  correctedSodium: CorrectedSodium | null;
  egfr: number | null;
  cd4: Cd4Triggers | null;
  /** Inputs that were available. Lets the prompt and the doctor see how much the checks rest on. */
  inputsAvailable: string[];
}

export function evaluateClinicalChecks(f: ClinicalFindings): ClinicalChecks {
  const inputsAvailable = Object.entries(f)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => k);
  return {
    map: computeMap(f.sbp, f.dbp),
    qsofa: computeQSofa(f),
    septicShock: evaluateSepticShock(f),
    hlh2004: evaluateHlh2004(f),
    hScore: computeHScore(f),
    correctedSodium: computeCorrectedSodium(f),
    egfr: computeEgfr(f),
    cd4: computeCd4Triggers(f),
    inputsAvailable,
  };
}

/** Plain-text block for the prompt. States what is known, and equally what could not be assessed. */
export function renderChecksForPrompt(c: ClinicalChecks): string {
  const lines: string[] = [];
  lines.push(`- MAP: ${c.map === null ? 'not assessable (BP incomplete)' : `${c.map} mmHg`}`);
  lines.push(`- qSOFA: ${c.qsofa.status === 'not_assessable' ? `not assessable (score so far ${c.qsofa.score}, ${3 - c.qsofa.assessedComponents} component(s) unknown)` : `${c.qsofa.score}/3 (${c.qsofa.status === 'met' ? 'positive screen' : 'negative screen'})`}`);
  lines.push(`- Sepsis-3 septic shock: ${c.septicShock.status.toUpperCase().replace('_', ' ')}. ${c.septicShock.reason}`);
  const h = c.hlh2004;
  lines.push(`- HLH-2004: ${h.metCount}/8 criteria met, ${h.notAssessableCount} not assessable (could reach ${h.maxPossible}); diagnostic threshold is 5. Status: ${h.status.toUpperCase().replace('_', ' ')}.`);
  const s = c.hScore;
  lines.push(`- HScore: ${s.scoreMin === s.scoreMax ? s.scoreMin : `${s.scoreMin} to ${s.scoreMax}`} (cut-off 169)${s.missing.length ? `; missing: ${s.missing.join(', ')}` : ''}. Status: ${s.status.toUpperCase().replace('_', ' ')}.`);
  if (c.correctedSodium) lines.push(`- Sodium: measured ${c.correctedSodium.measured}, corrected for glucose ${c.correctedSodium.corrected} mmol/L. ${c.correctedSodium.note}`);
  if (c.egfr !== null) lines.push(`- eGFR (CKD-EPI 2021): ${c.egfr} mL/min/1.73m2`);
  if (c.cd4) lines.push(`- CD4 ${c.cd4.cd4} cells/uL. ${c.cd4.notes.join(' ')}`);
  return lines.join('\n');
}

// Wording AFTER the term that makes it a statement about criteria, not a claim:
// "septic shock criteria are not met", "... cannot be assessed", "... excluded", "... unlikely".
const NON_ASSERTION_AFTER = /\b(?:not|never)\s+(?:met|present|established|confirmed|assessable|applicable)|\bcriteria\b[^.;\n]{0,60}\b(?:not|cannot|can't|unable|unclear|pending|unmet|absent|unknown)\b|\b(?:cannot|can't|unable to|not possible to)\s+(?:be\s+)?(?:assess|judg|determin|confirm|establish)|\bexcluded\b|\bunlikely\b|\bnot assessable\b/i;

export interface BlockedTerm { term: string; reason: string; excerpt: string }

// Words that make a mention a non-assertion ("no septic shock", "not in septic shock",
// "risk of septic shock", "to prevent progression to septic shock").
const NON_ASSERTION = /\b(?:no|not|without|nor|never|neither|absence of|exclude[sd]?|rule[sd]? out|unlikely|n't|risk of|at risk|impending|evolving|progress(?:ion|es|ing)? to|develop(?:ing)? into|prevent(?:ing)?|avoid(?:ing)?|if|unless|should .{0,20}develop|criteria for|screen(?:ing)? for)\b/i;

/**
 * Terms the model may not assert unless the deterministic criteria are met.
 * Returns the offending mentions so the caller can re-prompt or flag them.
 */
export function findBlockedTerms(text: string, c: ClinicalChecks): BlockedTerm[] {
  const found: BlockedTerm[] = [];
  if (c.septicShock.status !== 'met') {
    const re = /septic shock/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      const after = text.slice(m.index, m.index + 70);
      // A negation or hedge in the same clause makes this a non-assertion.
      const clauseBefore = before.split(/[.;:\n]/).pop() ?? '';
      const clauseAfter = after.split(/[.;\n]/)[0] ?? '';
      if (NON_ASSERTION.test(clauseBefore) || NON_ASSERTION_AFTER.test(clauseAfter)) continue;
      found.push({
        term: 'septic shock',
        reason: `Sepsis-3 septic-shock criteria are ${c.septicShock.status.replace('_', ' ')} (${c.septicShock.reason})`,
        excerpt: text.slice(Math.max(0, m.index - 40), m.index + 50).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return found;
}
