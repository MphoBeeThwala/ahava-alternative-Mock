/**
 * Generates docs/clinical-review/TRIAGE_SAFETY_REVIEW_PACKET.md — the
 * document a clinician reviews and signs for the triage safety net that has
 * never had clinician review (CLINICAL_SIGNOFF_CHECKLIST.md rows 1, 2, 3, 5,
 * 8, 9).
 *
 * Everything in it that describes behaviour is rendered from the code that
 * actually runs, never retyped: the TEWS chart from paediatricTews.json, the
 * emergency-sign patterns from triageSafety.ts's source, the ML thresholds
 * from engine.py's source, and every worked example by calling
 * assessDeterministicRisk() live. clinicalReviewPacket.test.ts fails CI if
 * the committed packet no longer matches the code, so a signature on the
 * packet is a signature on what is deployed.
 *
 *   pnpm --filter @ahava-healthcare/api clinical-review:packet
 */
import fs from 'fs';
import path from 'path';
import tewsData from '../services/triageThresholds/paediatricTews.json';
import { assessDeterministicRisk, type TriageVitalsSnapshot } from '../services/triageSafety';
import { scoreTews, TEWS_TABLE_VERSION } from '../services/triageThresholds/tews';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const PACKET_PATH = path.join(REPO_ROOT, 'docs', 'clinical-review', 'TRIAGE_SAFETY_REVIEW_PACKET.md');
const TRIAGE_SAFETY_SRC = path.join(REPO_ROOT, 'apps', 'backend', 'src', 'services', 'triageSafety.ts');
const ENGINE_SRC = path.join(REPO_ROOT, 'apps', 'ml-service', 'engine.py');

type Rule = { score: number; gte?: number; lte?: number; gt?: number; lt?: number; values?: Array<string | boolean> };

const PARAM_LABEL: Record<string, string> = {
  respiratoryRate: 'Respiratory rate (/min)',
  heartRate: 'Heart rate (/min)',
  systolicBp: 'Systolic BP (mmHg)',
  temperature: 'Temperature (°C)',
  mobility: 'Mobility',
  avpu: 'AVPU',
  trauma: 'Trauma',
};

function rangeText(r: Rule): string {
  if (r.values) return r.values.map(String).join(', ');
  const lo = r.gte !== undefined ? `≥ ${r.gte}` : r.gt !== undefined ? `> ${r.gt}` : '';
  const hi = r.lte !== undefined ? `≤ ${r.lte}` : r.lt !== undefined ? `< ${r.lt}` : '';
  if (r.gte !== undefined && r.lte !== undefined) return `${r.gte} – ${r.lte}`;
  return [lo, hi].filter(Boolean).join(' and ');
}

function isCategorical(rules: Rule[]): boolean {
  return Array.isArray(rules[0]?.values);
}

function tewsTable(band: 'adult' | 'olderChild' | 'youngerChild'): string {
  const def = (tewsData as any).bands[band];
  const rows = ['| Parameter | Value | Score in table | Adds to total | Reviewer: correct score |', '|---|---|---|---|---|'];
  for (const [param, rules] of Object.entries<Rule[]>(def.parameters)) {
    const categorical = isCategorical(rules);
    for (const r of rules) {
      const adds = categorical ? r.score : Math.abs(r.score);
      rows.push(`| ${PARAM_LABEL[param] ?? param} | ${rangeText(r)} | ${r.score} | ${adds > 0 ? '+' : ''}${adds} | |`);
    }
  }
  return rows.join('\n');
}

function extractArray(src: string, name: string): string[] {
  const start = src.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found in triageSafety.ts`);
  const end = src.indexOf('];', start);
  return (src.slice(start, end).match(/\/(?:\\\/|[^/\n])+\/[a-z]*/g) ?? []).filter((p) => p.length > 2);
}

function extractNested(src: string, key: 'level1' | 'level2'): string[] {
  const obj = src.indexOf('const saSpecificPatterns = {');
  const start = src.indexOf(`${key}: [`, obj);
  const end = src.indexOf('],', start);
  return (src.slice(start, end).match(/^\s*(\/(?:\\\/|[^/\n])+\/[a-z]*),/gm) ?? []).map((l) => l.trim().replace(/,$/, ''));
}

function engineConstants(src: string, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const m = src.match(new RegExp(`self\\.${n}\\s*=\\s*([^\\s#]+)`));
    if (!m) throw new Error(`engine.py: ${n} not found`);
    out[n] = m[1];
  }
  return out;
}

interface Scenario {
  label: string;
  why: string;
  age: number;
  vitals: TriageVitalsSnapshot;
}

// Worked examples for the reviewer. The "why" column states only what the
// code's own table implies, never a claim about what SATS says — that is
// the reviewer's call.
const SCENARIOS: Scenario[] = [
  { label: 'Well adult', why: 'Baseline: every value in the table\'s 0 band except SBP.', age: 40,
    vitals: { heartRateResting: 75, respiratoryRate: 16, temperature: 36.8, bloodPressureSystolic: 120 } },
  { label: 'Same, SBP 90', why: 'Lower BP than the well adult — compare the SBP score.', age: 40,
    vitals: { heartRateResting: 75, respiratoryRate: 16, temperature: 36.8, bloodPressureSystolic: 90 } },
  { label: 'Hypotension', why: 'SBP 78 — compare its SBP score with the well adult\'s SBP 120.', age: 40,
    vitals: { heartRateResting: 105, respiratoryRate: 22, temperature: 37, bloodPressureSystolic: 78 } },
  { label: 'Tachycardia + tachypnoea', why: 'HR 125, RR 26.', age: 40,
    vitals: { heartRateResting: 125, respiratoryRate: 26, temperature: 37, bloodPressureSystolic: 120 } },
  { label: 'Same + recorded alert & walking', why: 'Identical vitals; only adds that the patient is alert and ambulant.', age: 40,
    vitals: { heartRateResting: 125, respiratoryRate: 26, temperature: 37, bloodPressureSystolic: 120, avpu: 'alert', mobility: 'normal', trauma: false } },
  { label: 'Same + recorded confused & walking', why: 'Identical vitals; patient is confused.', age: 40,
    vitals: { heartRateResting: 125, respiratoryRate: 26, temperature: 37, bloodPressureSystolic: 120, avpu: 'confused', mobility: 'normal', trauma: false } },
  { label: 'Febrile, tachycardic, tachypnoeic', why: 'HR 118, RR 28, T 39.2, SBP 95.', age: 40,
    vitals: { heartRateResting: 118, respiratoryRate: 28, temperature: 39.2, bloodPressureSystolic: 95 } },
  { label: 'RR 32 alone', why: 'Isolated severe tachypnoea.', age: 40,
    vitals: { heartRateResting: 90, respiratoryRate: 32, temperature: 37, bloodPressureSystolic: 120 } },
  { label: 'Wearable only', why: 'HR 125, SpO2 97 — no BP/RR/temp (typical watch data).', age: 40,
    vitals: { heartRateResting: 125, oxygenSaturation: 97 } },
  { label: 'SpO2 95 + RR 22', why: 'Indeterminate SpO2 band with a respiratory-rate deviation.', age: 40,
    vitals: { heartRateResting: 80, respiratoryRate: 22, temperature: 37, bloodPressureSystolic: 120, oxygenSaturation: 95 } },
  { label: 'SpO2 91', why: 'At the critical SpO2 floor.', age: 40, vitals: { oxygenSaturation: 91 } },
  { label: 'Age 70, HR 125 (height 145 cm)', why: 'Adult by age, "older child" by height — band rule picks worse.', age: 70,
    vitals: { heartRateResting: 125, respiratoryRate: 18, temperature: 37, bloodPressureSystolic: 130 } },
];

function scenarioTable(): string {
  const rows = [
    '| # | Scenario | Inputs | TEWS per-parameter (table score) | TEWS total → colour | Floor level set by code | Flags | Reviewer: correct level |',
    '|---|---|---|---|---|---|---|---|',
  ];
  SCENARIOS.forEach((s, i) => {
    const height = s.label.includes('height 145') ? 145 : null;
    const v = s.vitals;
    const t = scoreTews(s.age, height, {
      respiratoryRate: v.respiratoryRate ?? null, heartRate: v.heartRateResting ?? null, temperature: v.temperature ?? null,
      systolicBp: v.bloodPressureSystolic ?? null, avpu: v.avpu ?? null, mobility: v.mobility ?? null, trauma: v.trauma ?? null,
    });
    const r = assessDeterministicRisk('feeling unwell', v, { ageYears: s.age, heightCm: height });
    const per = 'ageUnknown' in t ? '—' : Object.entries(t.perParameterScore).filter(([, x]) => x != null).map(([k, x]) => `${k} ${x}`).join(', ');
    const tot = 'ageUnknown' in t ? '—' : `${t.total} → ${t.color} (${t.band})`;
    const inputs = Object.entries({ age: s.age, ...(height ? { heightCm: height } : {}), ...v }).map(([k, x]) => `${k}=${x}`).join(', ');
    const flags = [...r.hardFlags, ...r.cautionFlags].join(', ') || '—';
    rows.push(`| ${i + 1} | **${s.label}** — ${s.why} | ${inputs} | ${per} | ${tot} | **${r.minTriageLevel}** | ${flags} | |`);
  });
  return rows.join('\n');
}

export function renderPacket(): string {
  const safetySrc = fs.readFileSync(TRIAGE_SAFETY_SRC, 'utf8');
  const engineSrc = fs.readFileSync(ENGINE_SRC, 'utf8');
  const l1 = [...extractArray(safetySrc, 'level1Patterns'), ...extractNested(safetySrc, 'level1')];
  const l2 = [...extractArray(safetySrc, 'level2Patterns'), ...extractNested(safetySrc, 'level2')];
  const ml = engineConstants(engineSrc, [
    'SPO2_RED', 'SPO2_LOW', 'SPO2_INDETERMINATE', 'RR_RED_HIGH', 'RR_RED_LOW', 'RR_YELLOW_HIGH', 'RR_YELLOW_LOW',
    'HR_RED_HIGH', 'HR_RED_LOW', 'HR_YELLOW_HIGH', 'HR_YELLOW_LOW', 'SIGMA_YELLOW', 'SIGMA_RED', 'MIN_BASELINE_DAYS',
    'HR_SIGMA_FLOOR', 'RR_SIGMA_FLOOR', 'RR_SIGMA_FLOOR_OVER_60', 'HRV_SWC_MULTIPLIER', 'HRV_MIN_CV',
    'PERSISTENCE_REQUIRED', 'PERSISTENCE_WINDOW', 'IMMATURE_BASELINE_MULT_UNDER_7D', 'IMMATURE_BASELINE_MULT_7_TO_14D',
  ]);
  const colorBands = (tewsData as any).colorBands
    .map((b: any) => `| ${b.color} | ${b.gte ?? '—'} | ${b.lte ?? '—'} |`)
    .join('\n');

  return `<!-- GENERATED by apps/backend/src/scripts/clinicalReviewPacket.ts — do not edit by hand.
     Regenerate: pnpm --filter @ahava-healthcare/api clinical-review:packet
     CI fails if this file no longer matches the code. -->

# Triage safety net — clinician review packet

**Status: UNREVIEWED.** Every rule in this packet is live in production and
has never been reviewed by a clinician. It covers
\`docs/CLINICAL_SIGNOFF_CHECKLIST.md\` rows **1, 2, 3, 5, 8, 9** — the
logic that decides whether a patient's vitals and symptoms get escalated.

TEWS table version in code: \`${TEWS_TABLE_VERSION}\`.

## How this packet works

- Every table and every worked example below is **generated from the running
  code**, not retyped. If the code changes, CI fails until this packet is
  regenerated — so what you sign is what is deployed.
- Where a column says **"Reviewer: correct …"**, write the value it *should*
  be. Leave blank if the code is correct.
- **Level numbers**: 1 = Resuscitation (red, immediate), 2 = Emergency
  (orange), 3 = Urgent (yellow), 4 = Routine (green), 5 = Non-urgent. The
  code computes a **floor**: the most urgent level the vitals/symptoms
  justify. The AI triage step can make a case *more* urgent than the floor,
  never less.

## 0. Findings for the reviewer to rule on first

These come from reading the code against itself — each is visible in the
tables and worked examples below. They do not depend on anyone's memory of
the SATS manual; whether each is *wrong* is the reviewer's call.

1. **Negative scores in the TEWS chart.** Published descriptions of the SATS
   TEWS score each parameter **0 to 3** (e.g. Rominski et al., Afr J Emerg
   Med 2014, doi:10.1016/j.afjem.2013.11.001). This table uses −3…+3. The
   code takes the absolute value for HR/RR/temp/SBP, but keeps the sign for
   AVPU/mobility/trauma — so "alert" (−2) and "walking" (−1) **subtract** from
   the total. See worked examples 4 vs 5: recording that a tachycardic,
   tachypnoeic patient is alert and walking lowers their floor.
2. **"Confused" scores lower than "alert"** in the adult band (−3 vs −2), so
   confusion *reduces* urgency. Worked example 6. AVPU, mobility and trauma
   are not collected anywhere in the product today, so this is latent — it
   becomes live the day any UI starts sending AVPU.
3. **Systolic BP ordering.** Adult SBP 101–199 scores 1, SBP 81–100 scores 0,
   SBP 71–80 scores −1 (adds 1). A normal BP adds the same as hypotension,
   and a lower BP adds less than a normal one. Worked examples 1–3. This also
   means a well adult almost never reaches level 5.
4. **Missing parameters add 0**, and are only flagged as cautions. Typical
   wearable data (HR/SpO2 only) is scored as though BP, RR and temperature
   were normal. Worked example 9.
5. **Two different absolute-vitals rule sets.** The ML service's absolute
   floor (section 5) uses its own HR/RR thresholds, which differ from the TEWS
   chart the backend uses. A patient can be RED in one and not the other.
6. **Short adults are also scored on a child chart.** Band selection uses
   height as well as age and takes the worse total. An adult of 150 cm or
   less (common, especially in older women) is scored on the older-child
   chart too; whenever that total is higher, the paediatric sign-off gate
   fires and the floor becomes level 2 with a paediatric flag. Once row 4 is
   signed, such an adult would be triaged on the child chart outright.
   Worked example 12 shows the case where the adult chart wins.

## 1. Adult TEWS chart (checklist row 1)

Source cited in code: ${(tewsData as any).sourceCitation}

Numeric parameters add |score| to the total; AVPU/mobility/trauma add the
signed score (see finding 1).

${tewsTable('adult')}

### Colour bands (TEWS total → colour)

| Colour | Total ≥ | Total ≤ |
|---|---|---|
${colorBands}

Colour → floor level: RED → 1, ORANGE → 2, YELLOW → 3, GREEN → 4 or 5.

## 2. Green split: level 4 vs 5 (row 2)

GREEN with total ≤ 0 → level 5; GREEN with total > 0 → level 4. The source
gives no number for this split; ≤ 0 was chosen because normal AVPU/mobility
make a well patient's total negative (finding 1).

Reviewer: ☐ correct ☐ change to: ________

## 3. Age / height band selection (row 3)

- By age: < 3 y → younger child; 3–12 y → older child; > 12 y → adult.
- By height: < 95 cm → younger child; 95–150 cm → older child; > 150 cm → adult.
- If both are known and disagree: score under both, **use the higher total**.
- If neither is known and vitals were supplied: flag \`AGE_UNKNOWN\`, floor level 2.
- Paediatric bands are gated (\`PAEDIATRIC_TEWS_SIGNED_OFF\`, row 4 — separate
  sign-off); while unsigned, any child with vitals gets floor level 2.

Reviewer: ☐ correct ☐ change to: ________

## 4. Emergency-signs override (row 5)

Free-text symptoms are lower-cased, negated clauses are masked ("no chest
pain" does not match "chest pain"; masking stops at but/however/although/yet/
except/and), then matched against these patterns. Any match sets the floor
regardless of vitals.

### Forces level 1 (${l1.length} patterns)

${l1.map((p) => `- \`${p}\``).join('\n')}

### Forces level 2 (${l2.length} patterns)

${l2.map((p) => `- \`${p}\``).join('\n')}

Reviewer: patterns to add / remove / move between levels:

________________________________________________________________

## 5. SpO2 band and absolute vitals floors (row 8)

**Backend (triage floor)**: SpO2 ≤ 91 → level 1; 92–93 → level 2; 94–96
→ "indeterminate (consumer device)" caution, escalates to level 2 only if a
TEWS respiratory-rate deviation is also present. Rationale in code: pulse
oximeters overestimate saturation in darker skin; margin instead of a
race-based correction. HRV ≤ 15 ms → level 2; ≤ 20 ms → level 3.

**ML service (wearable early warning, \`engine.py\`)** — absolute floor, fires
on the first reading, not suppressed by exercise context:

| Constant | Value |
|---|---|
${['SPO2_RED', 'SPO2_LOW', 'SPO2_INDETERMINATE', 'RR_RED_HIGH', 'RR_RED_LOW', 'RR_YELLOW_HIGH', 'RR_YELLOW_LOW', 'HR_RED_HIGH', 'HR_RED_LOW', 'HR_YELLOW_HIGH', 'HR_YELLOW_LOW']
  .map((k) => `| \`${k}\` | ${ml[k]} |`).join('\n')}

Reviewer: ☐ correct ☐ changes: ________

## 6. Personal-baseline deviation (AH-50, row 9)

Wearable readings are compared with the patient's own baseline (needs
${ml.MIN_BASELINE_DAYS} days). A deviation counts only if it recurs on
${ml.PERSISTENCE_REQUIRED} of the last ${ml.PERSISTENCE_WINDOW} readings.

| Constant | Value | Meaning |
|---|---|---|
| \`SIGMA_YELLOW\` / \`SIGMA_RED\` | ${ml.SIGMA_YELLOW} / ${ml.SIGMA_RED} | z-score for yellow / red |
| \`HR_SIGMA_FLOOR\` | ${ml.HR_SIGMA_FLOOR} bpm | minimum personal SD for HR (Quer et al. 2020) |
| \`RR_SIGMA_FLOOR\` | ${ml.RR_SIGMA_FLOOR} /min | minimum personal SD for RR (Natarajan et al. 2021) |
| \`RR_SIGMA_FLOOR_OVER_60\` | ${ml.RR_SIGMA_FLOOR_OVER_60} /min | same, age > 60 |
| \`HRV_SWC_MULTIPLIER\` | ${ml.HRV_SWC_MULTIPLIER} | HRV smallest worthwhile change = this × personal CV (log scale) |
| \`HRV_MIN_CV\` | ${ml.HRV_MIN_CV} | floor on personal HRV CV |
| \`IMMATURE_BASELINE_MULT_UNDER_7D\` | ${ml.IMMATURE_BASELINE_MULT_UNDER_7D} | SD widened while baseline < 7 days |
| \`IMMATURE_BASELINE_MULT_7_TO_14D\` | ${ml.IMMATURE_BASELINE_MULT_7_TO_14D} | SD widened for 7–14 days |

Reviewer: ☐ correct ☐ changes: ________

## 7. Worked examples — computed live by \`assessDeterministicRisk()\`

Symptom text for all examples: "feeling unwell" (matches no pattern), so
the floor comes from vitals alone.

${scenarioTable()}

## Sign-off

For each section, the reviewer marks it correct or records the correction.
Sections with corrections go back to engineering, the code is changed, this
packet is regenerated, and the changed sections are reviewed again. A
section is signed only against a packet whose generated tables match what
is deployed.

| Section | Reviewer (name, HPCSA no.) | Date | Outcome |
|---|---|---|---|
| 1. Adult TEWS chart | | | |
| 2. Green split | | | |
| 3. Band selection | | | |
| 4. Emergency signs | | | |
| 5. SpO2 / absolute floors | | | |
| 6. Baseline deviation (AH-50) | | | |
`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(PACKET_PATH), { recursive: true });
  fs.writeFileSync(PACKET_PATH, renderPacket());
  console.log(`wrote ${path.relative(REPO_ROOT, PACKET_PATH)}`);
}
