/**
 * The AI judge shared by the diagnostic pack and the clinical evaluation: it
 * scores an answer against a published answer key. The key never goes to the
 * engine; only to this separate scoring call.
 */
import { extractJsonObject, runClaude } from './aiProviders';
import type { Judgement, PackCase } from './diagnosticPack';

export const JUDGE_MODEL = process.env.AI_PACK_JUDGE_MODEL || 'claude-sonnet-5-5';
export const JUDGE_EFFORT = process.env.AI_PACK_JUDGE_EFFORT || 'medium';

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

export async function judgeAnswer(c: PackCase, r: { possibleConditions: string[]; recommendedAction: string; reasoning: string }): Promise<Judgement | undefined> {
  try {
    const ran = await runClaude(
      { prompt: JUDGE_PROMPT(c, r.possibleConditions, r.recommendedAction, r.reasoning), files: [] },
      (text) => extractJsonObject(text) as Judgement,
      { models: [JUDGE_MODEL], effort: JUDGE_EFFORT },
    );
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

