/**
 * Run the published diagnostic test pack through the REAL triage engine
 * (analyzeSymptoms: the same prompt, provider chain, guardrails and fallback a
 * patient's case gets) and score it against the answer key.
 *
 *   npm run ai-pack -- --smoke                 each configured model: one tiny call, with latency
 *   npm run ai-pack -- --floor-only            no network: only the deterministic safety rules
 *   npm run ai-pack -- --judge                 stage 1 of every case, AI-judged diagnosis scoring
 *   npm run ai-pack -- --judge --stage2        also re-run with the withheld results added
 *   npm run ai-pack -- --only AHV-DX-05,AHV-DX-07 --out report.md
 *
 * It needs the provider keys, so run it where they are, for example
 * `railway run --service backend npm run ai-pack -- --smoke`. It never writes
 * to the database. Images are not sent: the pack ships descriptions of the
 * figures, not the files, and describing an image in text would leak the answer.
 * The answer key is never sent to the engine; with --judge it goes to a
 * separate model call that only scores.
 */
import fs from 'fs';
import path from 'path';
import { analyzeSymptoms, type TriageResult } from '../services/aiTriage';
import { assessDeterministicRisk } from '../services/triageSafety';
import {
  checkModel, configuredModels, effectiveChain, extractJsonObject, runClaude,
} from '../services/aiProviders';
import {
  buildCaseInput, renderReport, scoreSafety, type CaseOutcome, type Judgement, type PackCase,
} from '../services/diagnosticPack';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const casesPath = path.resolve(
  opt('cases') ?? process.env.AI_PACK_PATH ?? path.join(process.cwd(), '..', '..', 'docs', 'diagnostic-test-pack', 'ahava-diagnostic-test-cases.json'),
);

async function smoke(): Promise<number> {
  console.log('Configured keys: claude=%s gemini=%s', !!process.env.ANTHROPIC_API_KEY, !!process.env.GEMINI_API_KEY);
  let bad = 0;
  for (const provider of ['claude', 'gemini'] as const) {
    if (!(provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY)) continue;
    console.log(`\n${provider}: order tried in production = ${effectiveChain(provider).join(' > ')} (configured: ${configuredModels(provider).join(', ')})`);
    for (const model of effectiveChain(provider)) {
      const r = await checkModel(provider, model);
      if (!r.ok) bad++;
      console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${model.padEnd(28)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : `  ${r.kind}${r.status ? ` ${r.status}` : ''}: ${r.message}`}`);
    }
  }
  return bad === 0 ? 0 : 1;
}

const JUDGE_PROMPT = (c: PackCase, conditions: string[], action: string, reasoning: string) => `You are scoring a clinical triage assistant against a published answer key. Be strict and literal.

ANSWER KEY
Final diagnosis: ${c.answerKey.finalDiagnosis}
Accepted as partial credit: ${(c.answerKey.acceptableAlternatives ?? []).join(' | ') || 'none'}
Must detect:
${c.answerKey.mustDetect.map((m, i) => `${i + 1}. ${m}`).join('\n')}
Pitfall the original clinicians fell into: ${c.answerKey.pitfall}

ASSISTANT'S ANSWER
Possible conditions (most likely first): ${conditions.join('; ')}
Recommended action: ${action}
Reasoning: ${reasoning}

Score:
- diagnosis: "full" if the final diagnosis (or a clinically equivalent description) is among the first 3 possible conditions; "partial" if only an accepted partial-credit answer is; otherwise "none".
- mustDetect: for each item, covered=true only if the assistant's answer clearly states or acts on it.
- fellForPitfall: true if the answer anchors on the common/wrong explanation the pitfall describes and does not point to the right one.

Output ONLY JSON: {"diagnosis":"full|partial|none","mustDetect":[{"item":"<verbatim>","covered":true}],"fellForPitfall":false,"note":"<one sentence>"}`;

async function judge(c: PackCase, r: { possibleConditions: string[]; recommendedAction: string; reasoning: string }): Promise<Judgement | undefined> {
  try {
    const ran = await runClaude({ prompt: JUDGE_PROMPT(c, r.possibleConditions, r.recommendedAction, r.reasoning), files: [] }, (text) => extractJsonObject(text) as Judgement);
    const j = ran.value;
    return {
      diagnosis: (['full', 'partial', 'none'] as const).includes(j.diagnosis) ? j.diagnosis : 'none',
      mustDetect: c.answerKey.mustDetect.map((item, i) => ({ item, covered: !!j.mustDetect?.[i]?.covered })),
      fellForPitfall: !!j.fellForPitfall,
      note: String(j.note ?? ''),
    };
  } catch (err) {
    console.error(`  judge failed: ${(err as Error).message}`);
    return undefined;
  }
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

  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    for (const stage of stages) {
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
        result = await analyzeSymptoms({ ...input, patientId: 'diagnostic-pack', caseId: `${c.id}-s${stage}` });
      }
      const machine = scoreSafety(c, result);
      const outcome: CaseOutcome = {
        id: c.id, stage, machine, modelUsed: result.modelUsed, seconds: (Date.now() - started) / 1000,
        conditions: result.possibleConditions,
        failures: (result.providerFailures ?? []).map((f) => `${f.provider}/${f.model}=${f.kind}${f.status ? `(${f.status})` : ''}`),
      };
      if (judged && machine.aiAnswered) outcome.judgement = await judge(c, result);
      outcomes.push(outcome);
      console.log(`${c.id} s${stage}: needs ${machine.minimumLevel}, got ${machine.level} ${machine.safetyPass ? 'PASS' : 'FAIL'} ${machine.aiAnswered ? '' : '(NO AI ANSWER)'} ${outcome.failures.join(' ')}`);
    }
  }

  const report = renderReport(outcomes, { generatedAt: new Date().toISOString(), judged, mode: floorOnly ? 'floor-only (deterministic rules, no AI)' : 'full engine' });
  const out = opt('out');
  if (out) { fs.writeFileSync(out, report); console.log(`\nReport written to ${out}`); } else console.log(`\n${report}`);
  const stage1 = outcomes.filter((o) => o.stage === 1);
  return stage1.every((o) => o.machine.safetyPass && (floorOnly || o.machine.aiAnswered)) ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
