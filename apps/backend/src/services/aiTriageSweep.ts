/**
 * Safety net for cases the AI never analysed.
 *
 * A case that no provider could analyse is re-queued automatically (see
 * jobs/aiTriageJob.ts scheduleReanalysis). That chain lives in Redis, or in a
 * process timer when there is no Redis, so a Redis outage or a restart can
 * silently end it, and the case then shows "AI ANALYSIS DID NOT RUN" forever.
 * This sweep finds those cases and starts the chain again.
 *
 * It only touches a case that is still waiting for a doctor, still carries the
 * "AI unavailable" label, and has not been updated for longer than the longest
 * normal gap between re-analyses, so it never doubles up with a live chain.
 */
import prisma from '../lib/prisma';
import { AI_UNAVAILABLE_MODEL_LABEL } from './aiTriage';
import { processAiTriageJob, type AiTriageJobData } from '../jobs/aiTriageJob';

const intEnv = (name: string, fallback: number, min: number) =>
  Math.max(min, parseInt(process.env[name] ?? '', 10) || fallback);

// Longer than the longest default re-analysis gap (2 h) so a live chain is never mistaken for a dead one.
const idleMs = () => intEnv('AI_SWEEP_IDLE_MS', 150 * 60_000, 60_000);
const maxAgeMs = () => intEnv('AI_SWEEP_MAX_AGE_MS', 7 * 24 * 3600_000, 3600_000);
const BATCH = 25;

export async function sweepUnanalysedTriageCases(now: Date = new Date()): Promise<{ requeued: string[] }> {
  const cases = await prisma.triageCase.findMany({
    where: {
      status: 'PENDING_REVIEW',
      aiModel: AI_UNAVAILABLE_MODEL_LABEL,
      updatedAt: { lt: new Date(now.getTime() - idleMs()) },
      createdAt: { gt: new Date(now.getTime() - maxAgeMs()) },
    },
    orderBy: { aiTriageLevel: 'asc' }, // most urgent first
    take: BATCH,
    select: { id: true, patientId: true, symptoms: true },
  });

  const requeued: string[] = [];
  for (const c of cases) {
    const job: AiTriageJobData = {
      caseId: c.id,
      patientId: c.patientId,
      symptoms: c.symptoms,
      retryAttempt: 1, // a re-analysis: keeps the original SLA clock, never overwrites a case a doctor picked up
      holdUrgency: true,
    };
    try {
      const { addAiTriageJob } = await import('./queue');
      if (!(await addAiTriageJob(job))) await processAiTriageJob(job);
      requeued.push(c.id);
    } catch (err) {
      console.error(`[aiTriageSweep] could not re-queue case ${c.id}:`, (err as Error).message);
    }
  }
  if (requeued.length > 0) {
    console.warn(`[aiTriageSweep] re-queued ${requeued.length} case(s) the AI never analysed: ${requeued.join(', ')}`);
  }
  return { requeued };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Sweep shortly after start, then every AI_SWEEP_INTERVAL_MS (default 10 minutes). */
export function startAiTriageSweepMonitor(): void {
  if (timer || process.env.NODE_ENV === 'test') return;
  const run = () => sweepUnanalysedTriageCases().catch((err) => console.error('[aiTriageSweep] failed:', (err as Error).message));
  setTimeout(run, 60_000).unref();
  timer = setInterval(run, intEnv('AI_SWEEP_INTERVAL_MS', 10 * 60_000, 30_000));
  timer.unref();
}
