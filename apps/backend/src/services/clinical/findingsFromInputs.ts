/**
 * Build ClinicalFindings from values that are ALREADY structured: the triage
 * vitals snapshot, and lab rows (name, value, unit) as the diagnostic pack
 * stores them. There is no free-text extraction here by design. A value that
 * is absent, ambiguous or in a unit we do not recognise stays unknown, and the
 * checks report "not assessable" for it.
 */
import type { TriageVitalsSnapshot } from '../triageSafety';
import type { ClinicalFindings } from './clinicalChecks';

export interface LabRow { name: string; value: string | number; unit?: string }

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // "<5" or ">1000" are limits, not values: leave unknown.
  if (/^\s*[<>]/.test(v)) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(v);
  return m ? Number(m[1].replace(',', '.')) : null;
};

const norm = (u?: string) => (u ?? '').toLowerCase().replace(/\s+/g, '').replace('µ', 'u').replace('μ', 'u');

/** Cells per uL / mm3 / x10^9/L / x10^3/uL  ->  x10^9/L. Unknown unit -> null. */
function cellsToE9(value: number, unit?: string): number | null {
  const u = norm(unit);
  // 10^3/uL is the same quantity as 10^9/L.
  if (['x10^9/l', '10^9/l', 'x10e9/l', 'x10^3/ul', '10^3/ul'].includes(u)) return value;
  if (['/ul', '/mm3', 'cells/ul', 'cells/mm3'].includes(u)) return value / 1000;
  return null;
}

function glucoseToMmol(v: number, unit?: string): number | null {
  const u = norm(unit);
  if (u === 'mmol/l') return v;
  if (u === 'mg/dl') return Math.round((v / 18.016) * 10) / 10;
  return null;
}

function creatinineToUmol(v: number, unit?: string): number | null {
  const u = norm(unit);
  if (u === 'umol/l') return v;
  if (u === 'mg/dl') return Math.round(v * 88.4);
  return null;
}

function triglyceridesToMmol(v: number, unit?: string): number | null {
  const u = norm(unit);
  if (u === 'mmol/l') return v;
  if (u === 'mg/dl') return Math.round((v / 88.57) * 100) / 100;
  return null;
}

function fibrinogenToGL(v: number, unit?: string): number | null {
  const u = norm(unit);
  if (u === 'g/l') return v;
  if (u === 'mg/dl') return v / 100;
  return null;
}

function haemoglobinToGdl(v: number, unit?: string): number | null {
  const u = norm(unit);
  if (u === 'g/dl') return v;
  if (u === 'g/l') return v / 10;
  return null;
}

type Setter = (f: ClinicalFindings, value: number, unit?: string) => void;

// Exact (anchored) names only. Combined rows such as "AST / ALT" or "Sodium /
// Potassium / Chloride" are deliberately NOT matched: one value cannot be
// assigned to one analyte safely.
const LAB_RULES: Array<[RegExp, Setter]> = [
  [/^(?:serum |plasma )?sodium$/i, (f, v, u) => { if (!u || norm(u) === 'mmol/l' || norm(u) === 'meq/l') f.sodiumMmol = v; }],
  [/^(?:serum |plasma )?potassium$/i, (f, v, u) => { if (!u || norm(u) === 'mmol/l' || norm(u) === 'meq/l') f.potassiumMmol = v; }],
  [/^(?:random |serum |plasma |blood )?glucose$/i, (f, v, u) => { const g = glucoseToMmol(v, u); if (g !== null) f.glucoseMmol = g; }],
  [/^(?:serum |plasma )?creatinine$/i, (f, v, u) => { const c = creatinineToUmol(v, u); if (c !== null) f.creatinineUmol = c; }],
  [/^(?:serum |plasma |blood |arterial |venous )?lactate$/i, (f, v, u) => { if (!u || norm(u) === 'mmol/l') f.lactateMmol = v; }],
  [/^cd4(?: count| cell count)?$/i, (f, v) => { f.cd4Cells = v; }],
  [/^ha?emoglobin$/i, (f, v, u) => { const h = haemoglobinToGdl(v, u); if (h !== null) f.haemoglobinGdl = h; }],
  [/^(?:white (?:cell|blood cell) count|wbc|leuc?ocytes)$/i, (f, v, u) => { const w = cellsToE9(v, u); if (w !== null) f.wbcX10e9 = w; }],
  [/^platelets?(?: count)?$/i, (f, v, u) => { const p = cellsToE9(v, u); if (p !== null) f.plateletsX10e9 = p; }],
  [/^(?:absolute )?neutrophils?(?: count)?$|^absolute neutrophil count$|^anc$/i, (f, v, u) => { const n = cellsToE9(v, u); if (n !== null) f.neutrophilsX10e9 = n; }],
  [/^ferritin$/i, (f, v, u) => { if (!u || ['ng/ml', 'ug/l', 'mcg/l'].includes(norm(u))) f.ferritinUgL = v; }],
  [/^triglycerides?$/i, (f, v, u) => { const t = triglyceridesToMmol(v, u); if (t !== null) f.triglyceridesMmol = t; }],
  [/^fibrinogen$/i, (f, v, u) => { const x = fibrinogenToGL(v, u); if (x !== null) f.fibrinogenGL = x; }],
  [/^ast$/i, (f, v, u) => { if (!u || ['u/l', 'iu/l'].includes(norm(u))) f.astUL = v; }],
  [/^(?:soluble cd25|sil-?2r|soluble il-?2 receptor)$/i, (f, v, u) => { if (!u || norm(u) === 'u/ml') f.solubleCd25UmL = v; }],
];

export function findingsFromLabs(labs: LabRow[]): ClinicalFindings {
  const f: ClinicalFindings = {};
  for (const lab of labs) {
    const value = num(lab.value);
    if (value === null) continue;
    for (const [re, set] of LAB_RULES) {
      if (re.test(lab.name.trim())) { set(f, value, lab.unit); break; }
    }
  }
  return f;
}

export function findingsFromVitals(
  v: TriageVitalsSnapshot | null | undefined,
  extra?: { gcs?: number | null },
): ClinicalFindings {
  const f: ClinicalFindings = {};
  if (v) {
    const take = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    f.sbp = take(v.bloodPressureSystolic);
    f.dbp = take(v.bloodPressureDiastolic);
    f.hr = take(v.heartRateResting);
    f.rr = take(v.respiratoryRate);
    f.tempC = take(v.temperature);
    f.spo2 = take(v.oxygenSaturation);
    // AVPU other than "A" is altered mentation; "A" is alert. Absent stays unknown.
    if (v.avpu) f.alteredMentation = v.avpu !== 'alert';
  }
  if (typeof extra?.gcs === 'number') f.gcs = extra.gcs;
  return f;
}

/** Merge, preferring defined values from later arguments. */
export function mergeFindings(...parts: Array<ClinicalFindings | null | undefined>): ClinicalFindings {
  const out: Record<string, unknown> = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, val] of Object.entries(p)) if (val !== null && val !== undefined) out[k] = val;
  }
  return out as ClinicalFindings;
}

// ---- minimal, verifiable text hints -------------------------------------------
// NOT the Stage 2 extraction step. These are literal pattern matches where the
// value must appear verbatim in the case text, used so the CD4-based rules can
// fire on free-text cases. A structured value always wins over these, and any
// ambiguity (two different CD4 values) yields "unknown".

/** "CD4 9", "CD4 count: 9 cells/uL", "CD4 of 9". Several different values -> null. */
export function cd4FromText(text: string): number | null {
  const values = new Set<number>();
  const re = /\bCD4(?:\+)?(?:\s+(?:T[- ]?cell\s+)?(?:count|cell count|cells?))?\s*(?:of|is|was|=|:|-)?\s*(\d{1,4})\b(?!\s*%)(?!\s*\/\s*mm)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) values.add(Number(m[1]));
  return values.size === 1 ? [...values][0] : null;
}

/** HIV status from explicit wording only; "HIV negative" -> false; absent -> null. */
export function hivFromText(text: string): boolean | null {
  const t = text.toLowerCase();
  if (/\bhiv[- ]?(?:negative|neg\b|non-?reactive)|\bhiv[: ]+(?:negative|non-?reactive)/.test(t)) return false;
  if (/\bhiv[- ]?(?:positive|infected|reactive)|\bhiv[: ]+(?:positive|reactive)|\bliving with hiv\b|\bplhiv\b|\badvanced hiv\b|\bhiv disease\b|\bretroviral\b|\bon art\b|\baids\b|\bcd4\b/.test(t)) return true;
  return null;
}
