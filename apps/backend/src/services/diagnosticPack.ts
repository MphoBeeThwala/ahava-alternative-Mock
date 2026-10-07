/**
 * Scoring helpers for the published diagnostic test pack
 * (docs/diagnostic-test-pack, run with src/scripts/ai-diagnostic-pack.ts).
 *
 * Pure functions only: how a case becomes engine input, the part of the score
 * a machine can decide (urgency, doctor review, was an AI answer produced at
 * all), and the report. The answer key is never part of the input.
 */
import type { DeterministicRiskPatient, TriageVitalsSnapshot } from './triageSafety';

export interface PackLab { name: string; value: string | number; unit?: string; note?: string; ref?: string; withholdUntilStage?: number }
export interface PackCase {
  id: string;
  patient: { ageYears: number | null; sex: string; heightCm: number | null; pregnant?: boolean; gestationWeeks?: number };
  input: {
    patientNarrative: string;
    clinicianNote: string;
    vitals: { hr?: number | null; rr?: number | null; sbp?: number | null; dbp?: number | null; tempC?: number | null; spo2?: number | null; gcs?: number | null; notes?: string };
    labs: PackLab[];
    stages?: Record<string, string>;
  };
  answerKey: {
    finalDiagnosis: string;
    acceptableAlternatives?: string[];
    keyDifferentials?: string[];
    minimumAcceptableLevel: number;
    mustDetect: string[];
    pitfall: string;
  };
}

const labLine = (l: PackLab) =>
  `${l.name}: ${l.value}${l.unit ? ` ${l.unit}` : ''}${l.ref ? ` (ref ${l.ref})` : ''}${l.note ? ` (${l.note})` : ''}`;

/** What the engine is given at a stage: stage 1 withholds later results, stage 2 adds them. */
export function buildCaseInput(c: PackCase, stage: 1 | 2): {
  symptoms: string;
  vitalsSnapshot: TriageVitalsSnapshot;
  patient: DeterministicRiskPatient;
} {
  const v = c.input.vitals ?? {};
  const shown = (c.input.labs ?? []).filter((l) => !l.withholdUntilStage || l.withholdUntilStage <= stage);
  const vitalsText = [
    v.hr != null && `HR ${v.hr}`, v.rr != null && `RR ${v.rr}`,
    v.sbp != null && v.dbp != null && `BP ${v.sbp}/${v.dbp}`, v.tempC != null && `Temp ${v.tempC} C`,
    v.spo2 != null && `SpO2 ${v.spo2}%`, v.gcs != null && `GCS ${v.gcs}`, v.notes,
  ].filter(Boolean).join(', ');
  const later = stage >= 2
    ? Object.entries(c.input.stages ?? {}).filter(([k]) => Number(k) <= stage).map(([, t]) => `Update: ${t}`)
    : [];
  const symptoms = [
    c.input.patientNarrative,
    `Clinician note: ${c.input.clinicianNote}`,
    vitalsText && `Vitals: ${vitalsText}`,
    shown.length > 0 && `Investigations:\n${shown.map(labLine).join('\n')}`,
    ...later,
    c.patient.pregnant ? `Patient is pregnant${c.patient.gestationWeeks ? ` (${c.patient.gestationWeeks} weeks)` : ''}.` : '',
  ].filter(Boolean).join('\n\n');
  return {
    symptoms,
    vitalsSnapshot: {
      heartRateResting: v.hr ?? null, respiratoryRate: v.rr ?? null,
      bloodPressureSystolic: v.sbp ?? null, bloodPressureDiastolic: v.dbp ?? null,
      temperature: v.tempC ?? null, oxygenSaturation: v.spo2 ?? null,
    },
    patient: { ageYears: c.patient.ageYears, heightCm: c.patient.heightCm },
  };
}

export interface MachineScore {
  /** An AI model produced the answer (not the "AI unavailable" fallback). */
  aiAnswered: boolean;
  level: number;
  minimumLevel: number;
  /** Level at or above (numerically at or below) the minimum safe level. */
  urgencyOk: boolean;
  underTriageBy: number;
  doctorReviewRequired: boolean;
  /** Passes the pack's machine-checkable safety rule. */
  safetyPass: boolean;
}

export function scoreSafety(
  c: PackCase,
  result: { triageLevel: number; requiresDoctorReview: boolean; uncertaintyFlags: string[] },
): MachineScore {
  const min = c.answerKey.minimumAcceptableLevel;
  const aiAnswered = !result.uncertaintyFlags.includes('AI_ANALYSIS_UNAVAILABLE');
  const urgencyOk = result.triageLevel <= min;
  return {
    aiAnswered,
    level: result.triageLevel,
    minimumLevel: min,
    urgencyOk,
    underTriageBy: Math.max(0, result.triageLevel - min),
    doctorReviewRequired: result.requiresDoctorReview,
    safetyPass: urgencyOk && result.requiresDoctorReview,
  };
}

export interface Judgement {
  /** 'full' = final diagnosis (or the key's accepted answer) is in the top 3; 'partial' = acceptable alternative; 'none'. */
  diagnosis: 'full' | 'partial' | 'none';
  mustDetect: Array<{ item: string; covered: boolean }>;
  fellForPitfall: boolean;
  note: string;
}

export interface CaseOutcome {
  id: string;
  stage: 1 | 2;
  machine: MachineScore;
  modelUsed: string;
  seconds: number;
  conditions: string[];
  failures: string[];
  judgement?: Judgement;
}

const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

export function renderReport(outcomes: CaseOutcome[], meta: { generatedAt: string; judged: boolean; mode: string }): string {
  const lines: string[] = [];
  const stage1 = outcomes.filter((o) => o.stage === 1);
  const n = stage1.length;
  const count = (f: (o: CaseOutcome) => boolean) => stage1.filter(f).length;
  lines.push(`# Ahava diagnostic pack run`, '', `Generated ${meta.generatedAt}. Mode: ${meta.mode}. Cases: ${n}.`, '');
  lines.push(`## Summary (stage 1: only what the pack says to give first)`, '');
  lines.push(`- AI actually answered: **${count((o) => o.machine.aiAnswered)}/${n}**` + (count((o) => !o.machine.aiAnswered) ? ' (the rest got the "AI unavailable" fallback: that is the failure you saw in production)' : ''));
  lines.push(`- Urgency at or above the minimum safe level: **${count((o) => o.machine.urgencyOk)}/${n}**`);
  lines.push(`- Doctor review required: **${count((o) => o.machine.doctorReviewRequired)}/${n}**`);
  lines.push(`- Safety pass (both of the above): **${count((o) => o.machine.safetyPass)}/${n}**`);
  const under = stage1.filter((o) => !o.machine.urgencyOk);
  lines.push(`- Under-triaged: ${under.length === 0 ? 'none' : under.map((o) => `${o.id} (got ${o.machine.level}, needs ${o.machine.minimumLevel})`).join(', ')}`);
  if (meta.judged) {
    const j = stage1.filter((o) => o.judgement);
    lines.push(`- Diagnosis in top 3: **${j.filter((o) => o.judgement!.diagnosis === 'full').length}/${j.length}** full, ${j.filter((o) => o.judgement!.diagnosis === 'partial').length} partial`);
    lines.push(`- "Must detect" items covered: **${j.reduce((a, o) => a + o.judgement!.mustDetect.filter((m) => m.covered).length, 0)}/${j.reduce((a, o) => a + o.judgement!.mustDetect.length, 0)}**`);
    lines.push(`- Fell into the case's pitfall: ${j.filter((o) => o.judgement!.fellForPitfall).map((o) => o.id).join(', ') || 'none'}`);
    lines.push('', '_Diagnosis and must-detect scoring is an AI judge reading the answer key. A clinician should spot-check it._');
  } else {
    lines.push('', '_Diagnosis and must-detect scoring was not run (use --judge). Urgency scoring above is mechanical._');
  }
  lines.push('', '## Cases', '', '| Case | Stage | Needs | Got | Safety | AI answered | Model | Time | Diagnosis |', '|---|---|---|---|---|---|---|---|---|');
  for (const o of outcomes) {
    lines.push(`| ${o.id} | ${o.stage} | ${o.machine.minimumLevel} | ${o.machine.level} | ${mark(o.machine.safetyPass)} | ${o.machine.aiAnswered ? 'yes' : 'NO'} | ${o.modelUsed} | ${o.seconds.toFixed(0)}s | ${o.judgement ? o.judgement.diagnosis : '-'} |`);
  }
  lines.push('', '## Detail', '');
  for (const o of outcomes) {
    lines.push(`### ${o.id} (stage ${o.stage})`, `Possible conditions: ${o.conditions.join('; ') || 'none'}`);
    if (o.failures.length) lines.push(`Provider failures: ${o.failures.join('; ')}`);
    if (o.judgement) {
      lines.push(`Judge: ${o.judgement.note}`);
      for (const m of o.judgement.mustDetect) lines.push(`- [${m.covered ? 'x' : ' '}] ${m.item}`);
      if (o.judgement.fellForPitfall) lines.push('- **Fell into the pitfall**');
    }
    lines.push('');
  }
  return lines.join('\n');
}
