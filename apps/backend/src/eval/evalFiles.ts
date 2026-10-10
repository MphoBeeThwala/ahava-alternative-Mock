/**
 * Loading the eval folder (apps/backend/eval) and the offline run: every
 * recorded model output is scored through the production post-processing and
 * checked against the expectation written next to it. This is what runs in CI.
 */
import fs from 'fs';
import path from 'path';
import {
  checkThresholds, scoreRawOutput, SECTIONS, type Baseline, type CaseScore, type EvalCase, type SectionName, type Thresholds,
} from './clinicalEval';

export const EVAL_DIR = path.resolve(__dirname, '..', '..', 'eval');

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

export function loadCases(dir = EVAL_DIR): EvalCase[] {
  const casesDir = path.join(dir, 'cases');
  return fs.readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson<EvalCase>(path.join(casesDir, f)));
}

export function loadThresholds(dir = EVAL_DIR): Thresholds {
  return readJson<Thresholds>(path.join(dir, 'thresholds.json'));
}

export function loadBaseline(dir = EVAL_DIR): Baseline | null {
  const f = path.join(dir, 'baseline.json');
  return fs.existsSync(f) ? readJson<Baseline>(f) : null;
}

export interface Recording {
  kind: 'good' | 'weak' | string;
  synthetic?: boolean;
  note?: string;
  expect: {
    minSection?: Partial<Record<SectionName, number>>;
    maxSection?: Partial<Record<SectionName, number>>;
    lintIncludes?: string[];
    lintRemaining?: string[];
    blockedIncludes?: string[];
  };
  output: unknown;
}

export function loadRecordings(caseId: string, dir = EVAL_DIR): Array<{ file: string; recording: Recording }> {
  const d = path.join(dir, 'recorded', caseId);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, recording: readJson<Recording>(path.join(d, f)) }));
}

export interface OfflineResult {
  caseId: string;
  file: string;
  kind: string;
  score: CaseScore;
  failures: string[];
}

/** Check one recording against its own expectation. */
export function checkExpectation(rec: Recording, score: CaseScore): string[] {
  const out: string[] = [];
  const e = rec.expect ?? {};
  for (const [s, min] of Object.entries(e.minSection ?? {})) {
    const got = score.sections[s as SectionName].score;
    if (got === null || got < (min as number)) out.push(`${s} is ${got}, expected at least ${min}`);
  }
  for (const [s, max] of Object.entries(e.maxSection ?? {})) {
    const got = score.sections[s as SectionName].score;
    if (got === null || got > (max as number)) out.push(`${s} is ${got}, expected at most ${max} (the guard should catch this weakness)`);
  }
  const lint = (score.record?.lintRemaining ?? []).map((l) => l.elementId);
  for (const id of e.lintIncludes ?? []) if (!lint.includes(id)) out.push(`the completeness linter no longer reports "${id}"`);
  if (e.lintRemaining) {
    const extra = lint.filter((id) => !e.lintRemaining!.includes(id));
    if (extra.length) out.push(`the completeness linter now reports: ${extra.join(', ')}`);
  }
  const blocked = (score.record?.blockedTermsRemaining ?? []).map((b) => b.term);
  for (const term of e.blockedIncludes ?? []) if (!blocked.includes(term)) out.push(`the blocked-term check no longer catches "${term}"`);
  return out;
}

export function runOffline(dir = EVAL_DIR): { results: OfflineResult[]; thresholdFailures: string[]; failures: string[] } {
  const cases = loadCases(dir);
  const thresholds = loadThresholds(dir);
  const results: OfflineResult[] = [];
  const goodScores: CaseScore[] = [];
  const failures: string[] = [];

  for (const c of cases) {
    const recs = loadRecordings(c.id, dir);
    if (recs.length === 0) failures.push(`${c.id}: no recorded output to evaluate offline (add one under eval/recorded/${c.id}/)`);
    if (!recs.some((r) => r.recording.kind === 'good')) failures.push(`${c.id}: needs a recording of kind "good" to prove a complete plan passes`);
    if (!recs.some((r) => r.recording.kind === 'weak')) failures.push(`${c.id}: needs a recording of kind "weak" to prove the guards catch a thin plan`);
    for (const { file, recording } of recs) {
      const score = scoreRawOutput(c, recording.output);
      const f = checkExpectation(recording, score).map((m) => `${c.id}/${file}: ${m}`);
      results.push({ caseId: c.id, file, kind: recording.kind, score, failures: f });
      failures.push(...f);
      if (recording.kind === 'good') goodScores.push(score);
    }
  }
  // Only plans that are meant to be good are held to the section thresholds.
  const thresholdFailures = checkThresholds(goodScores, thresholds);
  return { results, thresholdFailures, failures: [...failures, ...thresholdFailures] };
}

export { SECTIONS };
