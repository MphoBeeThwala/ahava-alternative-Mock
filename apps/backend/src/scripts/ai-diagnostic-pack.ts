/**
 * Run the published diagnostic test pack through the REAL triage engine
 * (analyzeSymptoms: the same prompt, provider chain, guardrails and fallback a
 * patient's case gets) and score it against the answer key.
 *
 *   npm run ai-pack:smoke                      each configured model: one tiny call, with latency
 *   npm run ai-pack:floor                      no network: only the deterministic safety rules
 *   npm run ai-pack:full                       pack 1, stage 1 and 2, AI-judged scoring
 *   npm run ai-pack:set2                       the blind set 2, same settings
 *   (more options: --only AHV-DX-05,AHV-DX-07  --out report.md  --cases <file>  --judge  --stage2)
 *
 * It needs provider keys, and a full run makes dozens of long AI calls. DO NOT
 * spend the production credit on it: an early run did, and every patient case then
 * failed with "credit balance is too low". Use separate test keys from a workspace
 * with its own spend limit:
 *   AI_PACK_ANTHROPIC_API_KEY, AI_PACK_GEMINI_API_KEY   (only these keys are used when either is set)
 * or knowingly accept the risk with AI_PACK_ALLOW_PRODUCTION_KEYS=1 (e.g. under
 * `railway run`). The judge is cheaper than the engine by default:
 *   AI_PACK_JUDGE_MODEL (default claude-sonnet-5-5), AI_PACK_JUDGE_EFFORT (default medium).
 * The run stops at once if a provider reports no credit left. It never writes to
 * the database. Images are not sent: the pack ships descriptions of the figures,
 * not the files, and describing an image in text would leak the answer. The
 * answer key is never sent to the engine; with --judge it goes to a separate
 * model call that only scores.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { analyzeSymptoms, type TriageResult } from '../services/aiTriage';
import { assessDeterministicRisk } from '../services/triageSafety';
import {
  checkModel, configuredModels, effectiveChain, effectiveLimits,
} from '../services/aiProviders';
import { judgeAnswer, JUDGE_EFFORT, JUDGE_MODEL } from '../services/diagnosticPackJudge';
import { planText } from '../services/clinical/clinicalPlan';
import {
  buildCaseFindings, buildCaseInput, packKeyPolicy, plannedRuns, renderReport, scoreSafety,
  type CaseOutcome, type Judgement, type PackCase,
} from '../services/diagnosticPack';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

// Test keys replace the production ones completely (a missing test key means that
// provider is simply not used), so a test run cannot reach the production credit.
if (process.env.AI_PACK_ANTHROPIC_API_KEY || process.env.AI_PACK_GEMINI_API_KEY) {
  const setOrDelete = (name: string, value: string | undefined) => { if (value) process.env[name] = value; else delete process.env[name]; };
  setOrDelete('ANTHROPIC_API_KEY', process.env.AI_PACK_ANTHROPIC_API_KEY);
  setOrDelete('GEMINI_API_KEY', process.env.AI_PACK_GEMINI_API_KEY);
}


/** Which code produced a report. Two runs of "the same" pack were once indistinguishable. */
function codeVersion(): string {
  const git = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return `${git('git rev-parse --short HEAD')}${git('git status --porcelain') ? ' (local uncommitted changes)' : ''}`;
  } catch {
    return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown';
  }
}

const casesPath = path.resolve(
  opt('cases') ?? process.env.AI_PACK_PATH ?? path.join(process.cwd(), '..', '..', 'docs', 'diagnostic-test-pack', 'ahava-diagnostic-test-cases.json'),
);

async function smoke(): Promise<number> {
  console.log('Configured keys: claude=%s gemini=%s', !!process.env.ANTHROPIC_API_KEY, !!process.env.GEMINI_API_KEY);
  const env = (n: string) => (process.env[n] ? `${n}=${process.env[n]}` : null);
  console.log('AI variables set here:', ['AI_PROVIDER_TIMEOUT_MS', 'AI_PROVIDER_IDLE_TIMEOUT_MS', 'AI_PROVIDER_TOTAL_BUDGET_MS', 'AI_CLAUDE_BUDGET_MS', 'AI_GEMINI_BUDGET_MS', 'AI_CLAUDE_MODELS', 'AI_GEMINI_MODELS', 'AI_CLAUDE_EFFORT', 'AI_CLAUDE_MAX_TOKENS'].map(env).filter(Boolean).join(', ') || 'none');
  console.log('Limits in force:', JSON.stringify(effectiveLimits()));
  let bad = 0;
  for (const provider of ['claude', 'gemini'] as const) {
    if (!(provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY)) continue;
    console.log(`\n${provider}: order tried in production = ${effectiveChain(provider).join(' > ')} (configured: ${configuredModels(provider).join(', ')})`);
    for (const model of effectiveChain(provider)) {
      const r = await checkModel(provider, model, effectiveLimits().perCallMs);
      if (!r.ok) bad++;
      console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${model.padEnd(28)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : `  ${r.kind}${r.status ? ` ${r.status}` : ''}: ${r.message}`}`);
    }
  }
  return bad === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  if (flag('smoke')) return smoke();

  const pack = JSON.parse(fs.readFileSync(casesPath, 'utf8')) as { cases: PackCase[] };
  const only = opt('only')?.split(',').map((s) => s.trim());
  const cases = pack.cases.filter((c) => !only || only.includes(c.id));
  const stages: Array<1 | 2> = flag('stage2') ? [1, 2] : [1];
  const floorOnly = flag('floor-only');
  const judged = flag('judge') && !floorOnly;
  if (!floorOnly && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error('No ANTHROPIC_API_KEY or GEMINI_API_KEY here. Run where the keys are (railway run ...), or use --floor-only.');
    return 2;
  }
  if (!packKeyPolicy(process.env, { floorOnly, smoke: false }).allowed) {
    console.error([
      'REFUSING TO RUN: a full pack run makes dozens of long AI calls and would spend the PRODUCTION API credit',
      'that patients\' cases depend on (an earlier run used it all up, and every case then failed).',
      '',
      'Use separate test keys from a workspace or project with its own spend limit. In PowerShell:',
      '  $env:AI_PACK_ANTHROPIC_API_KEY = "sk-ant-..."      (and optionally  $env:AI_PACK_GEMINI_API_KEY = "...")',
      'then run the same command again. Only the test keys are used when either is set.',
      '',
      'Or, knowingly, spend the production credit:   $env:AI_PACK_ALLOW_PRODUCTION_KEYS = "1"',
    ].join('\n'));
    return 2;
  }
  if (!floorOnly) {
    const runs = plannedRuns(cases, flag('stage2'));
    console.log(`Plan: ${cases.length} cases, ${runs} engine runs${judged ? ` plus ${runs} judge calls (${JUDGE_MODEL}, ${JUDGE_EFFORT} effort)` : ''}. This spends API credit: check the usage page of the provider afterwards.`);
  }

  const outcomes: CaseOutcome[] = [];
  const runStartedAt = new Date().toISOString();
  let aborted: string | undefined;
  for (const c of cases) {
    if (aborted) break;
    for (const stage of stages) {
      if (aborted) break;
      if (stage === 2 && !c.input.labs.some((l) => l.withholdUntilStage) && !c.input.stages) continue;
      const input = buildCaseInput(c, stage);
      const started = Date.now();
      let result: TriageResult;
      if (floorOnly) {
        const risk = assessDeterministicRisk(input.symptoms, input.vitalsSnapshot, input.patient);
        result = {
          triageLevel: risk.minTriageLevel, requiresDoctorReview: true, uncertaintyFlags: ['AI_ANALYSIS_UNAVAILABLE'],
          possibleConditions: [], recommendedAction: '', reasoning: '', modelUsed: 'floor-only (no AI)', providerFailures: [],
          confidence: 0, evidenceSources: [],
        };
      } else {
        result = await analyzeSymptoms({ ...input, findings: buildCaseFindings(c, stage), patientId: 'diagnostic-pack', caseId: `${c.id}-s${stage}` });
      }
      const machine = scoreSafety(c, result);
      const outcome: CaseOutcome = {
        id: c.id, stage, machine, modelUsed: result.modelUsed, seconds: (Date.now() - started) / 1000,
        conditions: result.possibleConditions,
        // Include the reason: "timeout" alone cannot tell a silent connection from a slow answer.
        failures: (result.providerFailures ?? []).map((f) => `${f.provider}/${f.model}=${f.kind}${f.status ? `(${f.status})` : ''}: ${f.message.slice(0, 120)}`),
      };
      if (judged && machine.aiAnswered) outcome.judgement = await judgeAnswer(c, {
        possibleConditions: result.possibleConditions,
        recommendedAction: result.recommendedAction,
        // The patient-facing summary no longer carries the clinical detail; the judge reads the full plan.
        reasoning: result.plan ? `${result.reasoning}\n\nFULL CLINICIAN PLAN:\n${planText(result.plan.plan)}` : result.reasoning,
      });
      outcomes.push(outcome);
      console.log(`${c.id} s${stage}: needs ${machine.minimumLevel}, got ${machine.level} ${machine.safetyPass ? 'PASS' : 'FAIL'} ${machine.aiAnswered ? '' : '(NO AI ANSWER)'} ${outcome.failures.join(' ')}`);
      // An empty account fails every remaining case the same way (and a quiet fallback to the
      // other provider would measure the wrong model): stop now instead of burning the whole run.
      if ((result.providerFailures ?? []).some((f) => f.kind === 'billing')) {
        aborted = 'a provider reports that its account has no credit left (billing). Every remaining case would fail the same way, or be answered by the fallback provider, so the run was stopped. Add credit, then run again.';
        console.error(`\nSTOPPING: ${aborted}`);
      }
    }
  }

  const report = renderReport(outcomes, {
    generatedAt: new Date().toISOString(), startedAt: runStartedAt, codeVersion: codeVersion(), judged,
    mode: floorOnly ? 'floor-only (deterministic rules, no AI)' : 'full engine',
    judge: `${JUDGE_MODEL}, ${JUDGE_EFFORT} effort`, aborted,
  });
  const out = opt('out');
  if (out) { fs.writeFileSync(out, report); console.log(`\nReport written to ${out}`); } else console.log(`\n${report}`);
  const stage1 = outcomes.filter((o) => o.stage === 1);
  return stage1.every((o) => o.machine.safetyPass && (floorOnly || o.machine.aiAnswered)) ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
