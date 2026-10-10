/**
 * Clinical evaluation runner. See apps/backend/eval/README.md.
 *
 *   pnpm eval:clinical                         OFFLINE (default, no keys, no network): scores the recorded
 *                                              outputs under eval/recorded through the production
 *                                              post-processing and exits 1 on any regression.
 *   pnpm eval:clinical:live                    LIVE: runs the gold cases through the real engine and scores
 *                                              each section. Spends API credit: needs TEST keys.
 *     --only HIV-HLH-001,AHV-DX-05             limit to some cases
 *     --pack set1|set2|all                     also run the published AHV-DX pack cases (diagnosis judged by AI)
 *     --no-judge                               skip the AI judge for pack cases
 *     --record                                 save each live plan under eval/recorded/<case>/live-*.json
 *     --update-baseline                        write eval/baseline.json from this run
 *     --out report.md                          write the report
 *
 * Live runs use AI_PACK_ANTHROPIC_API_KEY / AI_PACK_GEMINI_API_KEY (the same test keys as
 * the diagnostic pack) so they cannot spend the production credit. They never write to the database.
 */
import fs from 'fs';
import path from 'path';
import { analyzeSymptoms } from '../services/aiTriage';
import { packKeyPolicy, type PackCase } from '../services/diagnosticPack';
import { judgeAnswer } from '../services/diagnosticPackJudge';
import { planText } from '../services/clinical/clinicalPlan';
import {
  checkThresholds, renderEvalReport, scoreRecord, scoreUnparsed, type Baseline, type CaseScore, type EvalCase, SECTIONS,
} from '../eval/clinicalEval';
import { applyJudgement, packCaseToEvalCase } from '../eval/packCases';
import { EVAL_DIR, loadBaseline, loadCases, loadThresholds, runOffline } from '../eval/evalFiles';
import { configuredModels } from '../services/aiProviders';
import type { BaselineSettings } from '../eval/clinicalEval';

/** The Claude settings this run uses, as the engine will read them. Same defaults as services/aiProviders.ts. */
function runSettings(): BaselineSettings {
  return {
    effort: process.env.AI_CLAUDE_EFFORT || 'high',
    maxTokens: Math.max(1024, parseInt(process.env.AI_CLAUDE_MAX_TOKENS ?? '', 10) || 16_384),
    models: configuredModels('claude'),
  };
}

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

function offline(): number {
  const { results, failures } = runOffline();
  const report = renderEvalReport(results.map((r) => ({ ...r.score, caseId: `${r.caseId} [${r.kind}]` })), {
    mode: 'offline (recorded outputs)', generatedAt: new Date().toISOString(),
    label: results.map((r) => `${r.caseId}/${r.file}`).join(', '), failures,
  });
  const out = opt('out');
  if (out) fs.writeFileSync(out, report); else console.log(report);
  return failures.length === 0 ? 0 : 1;
}

async function live(): Promise<number> {
  if (process.env.AI_PACK_ANTHROPIC_API_KEY || process.env.AI_PACK_GEMINI_API_KEY) {
    const set = (n: string, v: string | undefined) => { if (v) process.env[n] = v; else delete process.env[n]; };
    set('ANTHROPIC_API_KEY', process.env.AI_PACK_ANTHROPIC_API_KEY);
    set('GEMINI_API_KEY', process.env.AI_PACK_GEMINI_API_KEY);
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error('No AI_PACK_ANTHROPIC_API_KEY / AI_PACK_GEMINI_API_KEY set. A live run needs test keys. Use `pnpm eval:clinical` for the offline check.');
    return 2;
  }
  if (!packKeyPolicy(process.env, { floorOnly: false, smoke: false }).allowed) {
    console.error('REFUSING TO RUN: this would spend the PRODUCTION API credit. Set AI_PACK_ANTHROPIC_API_KEY (test workspace), or knowingly set AI_PACK_ALLOW_PRODUCTION_KEYS=1.');
    return 2;
  }

  const only = opt('only')?.split(',').map((s) => s.trim());
  const cases: Array<{ c: EvalCase; pack?: PackCase }> = loadCases().map((c) => ({ c }));
  const packChoice = opt('pack');
  if (packChoice) {
    const docs = path.resolve(EVAL_DIR, '..', '..', '..', 'docs', 'diagnostic-test-pack');
    const files = [
      ...(packChoice === 'set1' || packChoice === 'all' ? ['ahava-diagnostic-test-cases.json'] : []),
      ...(packChoice === 'set2' || packChoice === 'all' ? ['ahava-diagnostic-test-cases-set2.json'] : []),
    ];
    for (const f of files) {
      for (const pc of (JSON.parse(fs.readFileSync(path.join(docs, f), 'utf8')) as { cases: PackCase[] }).cases) {
        cases.push({ c: packCaseToEvalCase(pc), pack: pc });
      }
    }
  }
  const selected = cases.filter(({ c }) => !only || only.includes(c.id));
  const judged = !flag('no-judge');
  console.log(`Running ${selected.length} case(s) live${judged ? ' (pack cases judged by AI)' : ''}. This spends API credit.`);

  const scores: CaseScore[] = [];
  const noPlan = new Set<string>(); // cases the model gave no usable plan for: never baselined
  const dir = path.join(EVAL_DIR, 'recorded');
  for (const { c, pack } of selected) {
    const started = Date.now();
    const result = await analyzeSymptoms({
      symptoms: c.input.caseText, findings: c.input.findings, patientId: 'clinical-eval', caseId: `eval-${c.id}`,
    });
    let score: CaseScore;
    if (result.plan) {
      const schemaIssues = result.plan.reviewerFlags
        .filter((f) => f.code === 'PLAN_SCHEMA_INCOMPLETE')
        .flatMap((f) => f.message.replace(/^[^:]*: /, '').split(' | '));
      score = scoreRecord(c, result.plan, schemaIssues, { requiresDoctorReview: result.requiresDoctorReview });
    } else {
      score = scoreUnparsed(c, [`no structured plan (model: ${result.modelUsed})`]);
      noPlan.add(c.id);
    }
    if (pack && judged && result.plan) {
      const j = await judgeAnswer(pack, {
        possibleConditions: result.possibleConditions, recommendedAction: result.recommendedAction,
        reasoning: `${result.reasoning}\n\nFULL CLINICIAN PLAN:\n${planText(result.plan.plan)}`,
      });
      score = applyJudgement(score, j);
    }
    scores.push(score);
    console.log(`${c.id}: ${SECTIONS.map((s) => `${s} ${score.sections[s].score ?? '-'}`).join('  ')}  (${result.modelUsed}, ${((Date.now() - started) / 1000).toFixed(0)}s)`);

    if (flag('record') && result.plan) {
      const d = path.join(dir, c.id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `live-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({
        kind: 'live', synthetic: false, note: `Live output from ${result.modelUsed}. Doses are already stripped. Promote to "good" or "weak" only after clinician review.`,
        expect: {}, output: result.plan.plan,
      }, null, 2) + '\n');
    }
    if ((result.providerFailures ?? []).some((f) => f.kind === 'billing')) {
      console.error('STOPPING: a provider account has no credit left.');
      break;
    }
  }

  const thresholds = loadThresholds();
  const baseline = loadBaseline();
  const settings = runSettings();
  if (baseline?.settings && (baseline.settings.effort !== settings.effort || baseline.settings.maxTokens !== settings.maxTokens)) {
    console.warn(`WARNING: this run (effort ${settings.effort}, max tokens ${settings.maxTokens}) differs from the baseline (effort ${baseline.settings.effort}, max tokens ${baseline.settings.maxTokens}). Scores are not like for like.`);
  }
  // Pack cases have no sign-off yet: they are reported and tracked, but only the gold cases are held to the minimums.
  const goldIds = new Set(loadCases().map((c) => c.id));
  const failures = [
    ...checkThresholds(scores.filter((s) => goldIds.has(s.caseId)), thresholds, baseline),
    ...checkThresholds(scores.filter((s) => !goldIds.has(s.caseId)), { ...thresholds, minSection: { diagnosis: 0, investigations: 0, management: 0, calibration: 0, safety: 0 } }, baseline),
  ];
  const report = renderEvalReport(scores, { mode: 'LIVE engine', generatedAt: new Date().toISOString(), failures });
  const out = opt('out');
  if (out) { fs.writeFileSync(out, report); console.log(`\nReport written to ${out}`); } else console.log(`\n${report}`);

  if (flag('update-baseline')) {
    const next: Baseline = { updatedAt: new Date().toISOString(), settings, cases: { ...(baseline?.cases ?? {}) } };
    for (const s of scores) {
      if (noPlan.has(s.caseId)) { console.warn(`Not baselining ${s.caseId}: the model returned no usable plan.`); continue; }
      next.cases[s.caseId] = Object.fromEntries(SECTIONS.filter((x) => s.sections[x].score !== null).map((x) => [x, s.sections[x].score as number]));
    }
    fs.writeFileSync(path.join(EVAL_DIR, 'baseline.json'), JSON.stringify(next, null, 2) + '\n');
    console.log('Baseline updated.');
  }
  return failures.length === 0 ? 0 : 1;
}

(flag('live') ? live() : Promise.resolve(offline())).then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
