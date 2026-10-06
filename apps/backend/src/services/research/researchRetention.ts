/**
 * Retention for the research tables (docs/RESEARCH_DATA_PIPELINE.md).
 *
 * Two rules, applied daily:
 *   1. No row is kept longer than RESEARCH_RETENTION_MAX_YEARS (default 7).
 *      Validating a risk model takes years of follow-up (the diabetes target
 *      alone needs 365 days), so the limit has to be generous; 7 years sits
 *      above the 5-year health-record norm without keeping anyone's data
 *      indefinitely (POPIA s14: no longer than needed for the purpose).
 *   2. A person with no new reading or outcome for RESEARCH_RETENTION_INACTIVE_MONTHS
 *      (default 24) is removed entirely. Someone who has gone quiet is no longer
 *      contributing to the purpose, and their agreement is likely stale. If they
 *      are still opted in and start sending readings again, capture simply
 *      restarts from that day, as always.
 *
 * Settings are bounded on purpose. A typo must never turn this into "delete
 * everything": a value below the floor is ignored (the default is used and a
 * warning logged), and the only way to switch a rule off is the explicit word
 * "off".
 */
import prisma from '../../lib/prisma';
import { writeClinicalAudit } from '../clinicalAudit';

export const DEFAULT_MAX_YEARS = 7;
export const MIN_MAX_YEARS = 1;
export const DEFAULT_INACTIVE_MONTHS = 24;
export const MIN_INACTIVE_MONTHS = 6;
const LAST_RUN_CURSOR = 'retention-last-run';
const BATCH = 500;

export interface RetentionConfig {
  maxYears: number | null;       // null = rule off
  inactiveMonths: number | null; // null = rule off
  warnings: string[];
}

function parse(raw: string | undefined, name: string, def: number, min: number, warnings: string[]): number | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return def;
  if (v === 'off') return null;
  // Plain digits only: no signs, decimals, exponents or units that Number() would quietly accept.
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min) {
    warnings.push(`${name}="${raw}" is not a whole number of at least ${min}; using the default (${def}). Write "off" to disable the rule.`);
    return def;
  }
  return n;
}

export function retentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const warnings: string[] = [];
  return {
    maxYears: parse(env.RESEARCH_RETENTION_MAX_YEARS, 'RESEARCH_RETENTION_MAX_YEARS', DEFAULT_MAX_YEARS, MIN_MAX_YEARS, warnings),
    inactiveMonths: parse(env.RESEARCH_RETENTION_INACTIVE_MONTHS, 'RESEARCH_RETENTION_INACTIVE_MONTHS', DEFAULT_INACTIVE_MONTHS, MIN_INACTIVE_MONTHS, warnings),
    warnings,
  };
}

/**
 * Midnight UTC, `years` and `months` before `now`, with the day clamped to the
 * target month's length (31 March minus one month is 28/29 February, not 3 March).
 */
export function cutoffDay(now: Date, years = 0, months = 0): Date {
  const y = now.getUTCFullYear() - years;
  const m = now.getUTCMonth() - months;
  const lastDayOfTargetMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(now.getUTCDate(), lastDayOfTargetMonth)));
}

export interface RetentionResult {
  snapshots: number;
  outcomes: number;
  inactiveSubjects: number;
}

export async function runRetention(now = new Date(), cfg: RetentionConfig = retentionConfig()): Promise<RetentionResult> {
  const result: RetentionResult = { snapshots: 0, outcomes: 0, inactiveSubjects: 0 };

  if (cfg.maxYears !== null) {
    const cutoff = cutoffDay(now, cfg.maxYears);
    // Predictions go with their snapshot (cascade).
    result.snapshots += (await prisma.researchSnapshot.deleteMany({ where: { observedDay: { lt: cutoff } } })).count;
    result.outcomes += (await prisma.researchOutcome.deleteMany({ where: { outcomeDay: { lt: cutoff } } })).count;
  }

  if (cfg.inactiveMonths !== null) {
    const cutoff = cutoffDay(now, 0, cfg.inactiveMonths);
    // Last sign of life per person: the latest reading or outcome day they have.
    const stale = await prisma.$queryRaw<Array<{ subjectKey: string }>>`
      SELECT "subjectKey"
      FROM (
        SELECT "subjectKey", "observedDay" AS d FROM research_snapshots
        UNION ALL
        SELECT "subjectKey", "outcomeDay" AS d FROM research_outcomes
      ) t
      GROUP BY "subjectKey"
      HAVING max(d) < ${cutoff}
    `;
    for (let i = 0; i < stale.length; i += BATCH) {
      const keys = stale.slice(i, i + BATCH).map((r) => r.subjectKey);
      result.snapshots += (await prisma.researchSnapshot.deleteMany({ where: { subjectKey: { in: keys } } })).count;
      result.outcomes += (await prisma.researchOutcome.deleteMany({ where: { subjectKey: { in: keys } } })).count;
    }
    result.inactiveSubjects = stale.length;
  }

  await prisma.researchCursor.upsert({
    where: { name: LAST_RUN_CURSOR },
    create: { name: LAST_RUN_CURSOR, value: now },
    update: { value: now },
  });
  if (result.snapshots + result.outcomes > 0) {
    // Counts only, so the trail shows that data was removed and why without recording whose.
    await writeClinicalAudit({
      userId: null,
      userRole: null,
      action: 'DELETE',
      resource: 'ResearchData',
      metadata: { event: 'RETENTION_PURGE', ...result, maxYears: cfg.maxYears, inactiveMonths: cfg.inactiveMonths },
    });
  }
  return result;
}

export async function lastRetentionRun(): Promise<Date | null> {
  return (await prisma.researchCursor.findUnique({ where: { name: LAST_RUN_CURSOR } }))?.value ?? null;
}
