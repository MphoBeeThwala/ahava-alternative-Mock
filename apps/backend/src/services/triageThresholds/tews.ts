/**
 * AH-47 / AH-44 gap report: SATS's Triage Early Warning Score (TEWS) — an
 * additive score across three age/height-banded charts, not the independent
 * adult-only thresholds this file used to encode. Chart values live in
 * ./paediatricTews.json, not here, so a clinician who doesn't read
 * TypeScript can review and diff them directly. See that file's
 * reviewedBy/reviewedOn/sourceCitation fields — until those are filled in,
 * treat this as an unsigned, evidence-assembled specification, not a
 * clinically authorized threshold table.
 */
import tewsDataRaw from './paediatricTews.json';

export type TewsBandName = 'youngerChild' | 'olderChild' | 'adult';
export type TewsColor = 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN';
export type Avpu = 'alert' | 'voice' | 'pain' | 'unresponsive' | 'confused';
export type Mobility = 'normal' | 'withHelp' | 'immobile' | 'notMovingNormally';

export interface TewsVitals {
    respiratoryRate?: number | null;
    heartRate?: number | null;
    temperature?: number | null;
    systolicBp?: number | null; // adult band only — no row for the two child bands
    avpu?: Avpu | null;
    mobility?: Mobility | null;
    trauma?: boolean | null;
}

interface NumericRule {
    score: number;
    gte?: number;
    lte?: number;
    gt?: number;
    lt?: number;
}
interface CategoricalRule {
    score: number;
    values: Array<string | boolean>;
}
type ParamRule = NumericRule | CategoricalRule;

interface TewsBandDef {
    label: string;
    parameters: Record<string, ParamRule[]>;
}

interface TewsData {
    version: string;
    reviewedBy: string | null;
    reviewedOn: string | null;
    sourceCitation: string;
    colorBands: Array<{ color: TewsColor; gte?: number; lte?: number }>;
    bands: Record<TewsBandName, TewsBandDef>;
}

const DATA = tewsDataRaw as unknown as TewsData;

function isCategoricalRule(r: ParamRule): r is CategoricalRule {
    return Array.isArray((r as CategoricalRule).values);
}

function matchNumeric(value: number, rules: NumericRule[]): number | null {
    for (const r of rules) {
        if (r.gte !== undefined && value < r.gte) continue;
        if (r.lte !== undefined && value > r.lte) continue;
        if (r.gt !== undefined && value <= r.gt) continue;
        if (r.lt !== undefined && value >= r.lt) continue;
        return r.score;
    }
    return null;
}

function matchCategorical(value: string | boolean, rules: CategoricalRule[]): number | null {
    for (const r of rules) {
        if (r.values.includes(value)) return r.score;
    }
    return null;
}

export function bandFromAge(ageYears: number): TewsBandName {
    if (ageYears < 3) return 'youngerChild';
    if (ageYears <= 12) return 'olderChild';
    return 'adult';
}

export function bandFromHeight(heightCm: number): TewsBandName {
    if (heightCm < 95) return 'youngerChild';
    if (heightCm <= 150) return 'olderChild';
    return 'adult';
}

function totalToColor(total: number): TewsColor {
    for (const band of DATA.colorBands) {
        if (band.gte !== undefined && total < band.gte) continue;
        if (band.lte !== undefined && total > band.lte) continue;
        return band.color;
    }
    return 'GREEN';
}

// AH-44: the +1/+3-style final column in some rows only exists in one
// direction for some parameters (e.g. younger child's RR tops out at +2,
// with no +3 row at all) — `matchNumeric`/`matchCategorical` return `null`
// when nothing matches, which is deliberately different from a score of 0.
function snakeCase(param: string): string {
    return param.replace(/([A-Z])/g, '_$1').toUpperCase();
}

export interface TewsScoreResult {
    band: TewsBandName;
    total: number;
    color: TewsColor;
    perParameterScore: Record<string, number | null>;
    missingParameters: string[];
}

// INTERPRETATION FLAG — needs explicit clinician confirmation against the
// primary SATS manual, not just this transcription (the spec artifact itself
// says as much: "re-read the SATS manual directly rather than trusting this
// transcription").
//
// The source table's columns run -3..+3, and the spec says the parameter
// scores "sum" to a total. Taken completely literally, a bidirectional
// physiological parameter (heart rate, respiratory rate, temperature,
// systolic BP) contributes its SIGNED score — but that can't be the real
// algorithm: severe bradycardia (-3) and severe tachycardia (+3) are both
// dangerous, and a literal signed sum lets one abnormal-low reading cancel
// an abnormal-high one elsewhere instead of adding to the total, the exact
// opposite of an early-warning score's purpose. Every comparable composite
// (NEWS2, MEWS) scores distance-from-normal as an unsigned magnitude
// regardless of direction. So: numeric physiological parameters contribute
// abs(score) to the total.
//
// AVPU/mobility/trauma are different in kind — genuinely ordinal, with one
// best state and one worst state, not "too much of a good thing" in either
// direction. There, the signed score is used as-is (e.g. "alert" scoring
// negative on purpose, reducing the total for a well-looking patient) —
// taking its absolute value would score a fully alert patient as severely
// as an unresponsive one, which cannot be right either.
function contributionOf(rule: ParamRule, score: number): number {
    return isCategoricalRule(rule) ? score : Math.abs(score);
}

function scoreOneBand(band: TewsBandName, vitals: TewsVitals): TewsScoreResult {
    const def = DATA.bands[band];
    const perParameterScore: Record<string, number | null> = {};
    const missingParameters: string[] = [];
    let total = 0;

    for (const [paramName, rules] of Object.entries(def.parameters)) {
        const raw = (vitals as Record<string, unknown>)[paramName];
        if (raw === undefined || raw === null) {
            perParameterScore[paramName] = null;
            missingParameters.push(paramName);
            continue;
        }
        const categorical = isCategoricalRule(rules[0]);
        const score = categorical
            ? matchCategorical(raw as string | boolean, rules as CategoricalRule[])
            : matchNumeric(Number(raw), rules as NumericRule[]);
        perParameterScore[paramName] = score;
        if (score != null) total += contributionOf(rules[0], score);
    }

    return { band, total, color: totalToColor(total), perParameterScore, missingParameters };
}

export type TewsResult = TewsScoreResult | { ageUnknown: true };

// AH-47 §47.2: select by age, fall back to height; where the two disagree,
// score under both candidate bands and use whichever produces the higher
// (more urgent) total — never silently pick one.
export function scoreTews(
    ageYears: number | undefined | null,
    heightCm: number | undefined | null,
    vitals: TewsVitals
): TewsResult {
    if ((ageYears === undefined || ageYears === null) && (heightCm === undefined || heightCm === null)) {
        return { ageUnknown: true };
    }

    const ageBand = ageYears != null ? bandFromAge(ageYears) : null;
    const heightBand = heightCm != null ? bandFromHeight(heightCm) : null;

    if (ageBand && heightBand && ageBand !== heightBand) {
        const byAge = scoreOneBand(ageBand, vitals);
        const byHeight = scoreOneBand(heightBand, vitals);
        return byAge.total >= byHeight.total ? byAge : byHeight;
    }

    return scoreOneBand((ageBand ?? heightBand) as TewsBandName, vitals);
}

// TEWS colour → SATS level. Level 5 is reserved for a green score "carrying
// no discriminator" per the spec, but the spec doesn't give a number for
// that split. Because AVPU/mobility contribute a *negative* signed score
// when normal (see contributionOf above), a fully well, alert, ambulatory
// patient's total sits below zero, not at exactly zero — so "no
// discriminator" is read here as total <= 0, with any positive-but-still-
// green total (a real, if mild, abnormal parameter) landing at 4 instead.
// Another judgment call flagged for clinician sign-off, not a sourced number.
export function tewsColorToSatsLevel(color: TewsColor, total: number): 1 | 2 | 3 | 4 | 5 {
    if (color === 'RED') return 1;
    if (color === 'ORANGE') return 2;
    if (color === 'YELLOW') return 3;
    return total <= 0 ? 5 : 4;
}

export function tewsFlagName(param: string, score: number): string {
    const sign = score > 0 ? '+' : '';
    return `TEWS_${snakeCase(param)}_SCORE_${sign}${score}`;
}

export const TEWS_TABLE_VERSION = DATA.version;
export const TEWS_TABLE_REVIEWED_BY = DATA.reviewedBy;
export const TEWS_TABLE_REVIEWED_ON = DATA.reviewedOn;
