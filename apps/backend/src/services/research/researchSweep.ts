/**
 * Background sweep: picks up readings from consented patients that arrived by
 * any route (wearable webhooks, Health Connect, manual entry), writes their
 * snapshots, and scores unscored snapshots with approved shadow models.
 *
 * Idempotent and safe on several replicas: snapshots are unique on
 * (subjectKey, sourceRef) and written with skipDuplicates, predictions on
 * (snapshot, model, version). The cursor only avoids re-reading old rows.
 */
import prisma from '../../lib/prisma';
import { RESEARCH_CONSENT_TYPE, RESEARCH_CONSENT_VERSION, getPseudonymKey, researchCaptureEnabled, sourceRefFor, subjectKeyFor } from './pseudonym';
import { buildSnapshotFields } from './researchFeatures';
import { reconcileConsent } from './researchCapture';
import { scoreUnscored } from './researchShadow';

const CURSOR = 'readings';
const PAGE = 2000;

export interface SweepResult {
  considered: number;
  written: number;
  scored: number;
}

export async function runResearchSweep(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { considered: 0, written: 0, scored: 0 };
  if (!researchCaptureEnabled()) return result;
  const key = getPseudonymKey()!;

  const cursor = await prisma.researchCursor.findUnique({ where: { name: CURSOR } });
  const from = cursor?.value ?? new Date(0);

  const readings = await prisma.biometricReading.findMany({
    where: {
      createdAt: { gte: from, lte: now },
      user: {
        role: 'PATIENT',
        isActive: true,
        consents: { some: { consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, withdrawn: false } },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: PAGE,
    include: {
      user: {
        select: {
          id: true, dateOfBirth: true, gender: true, riskProfile: true,
          consents: {
            where: { consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, withdrawn: false },
            select: { givenAt: true },
          },
        },
      },
    },
  });
  result.considered = readings.length;

  // The cursor follows BiometricReading.createdAt, which every ingest path
  // leaves as the server's insertion time. A path that ever back-dates it would
  // have its rows skipped here: keep that in mind when adding one.
  const rows = [];
  const writtenFor = new Set<string>();
  for (const reading of readings) {
    const givenAt = reading.user.consents[0]?.givenAt;
    if (!givenAt || reading.createdAt < givenAt) continue; // prospective only
    const fields = buildSnapshotFields(reading, reading.user);
    if (!fields) continue;
    writtenFor.add(reading.user.id);
    rows.push({
      subjectKey: subjectKeyFor(reading.user.id, key)!,
      sourceRef: sourceRefFor('reading', reading.id, key)!,
      consentVersion: RESEARCH_CONSENT_VERSION,
      ...fields,
    });
  }
  if (rows.length > 0) {
    const created = await prisma.researchSnapshot.createMany({ data: rows, skipDuplicates: true });
    result.written = created.count;
    // Anyone who withdrew while this sweep was between reading and writing gets purged again.
    for (const userId of writtenFor) await reconcileConsent(userId);
  }

  // A full page means there may be more: resume from the last row seen next
  // time (gte + skipDuplicates makes re-reading that row harmless). A short
  // page means we're caught up to `now`.
  const next = readings.length === PAGE ? readings[readings.length - 1].createdAt : now;
  await prisma.researchCursor.upsert({
    where: { name: CURSOR },
    create: { name: CURSOR, value: next },
    update: { value: next },
  });

  result.scored = (await scoreUnscored()).scored;
  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startResearchSweepMonitor(): void {
  if (timer || !researchCaptureEnabled()) {
    if (!researchCaptureEnabled()) {
      console.log('[research] capture off (RESEARCH_CAPTURE_ENABLED=false or RESEARCH_PSEUDONYM_KEY missing/short)');
    }
    return;
  }
  const everyMs = Math.max(60_000, Number(process.env.RESEARCH_SWEEP_INTERVAL_MS) || 15 * 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runResearchSweep();
      if (r.considered || r.scored) console.log(`[research] sweep: considered=${r.considered} written=${r.written} scored=${r.scored}`);
    } catch (err) {
      console.warn('[research] sweep failed (non-fatal):', err instanceof Error ? err.message : 'error');
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, everyMs);
  timer.unref();
  setTimeout(tick, 30_000).unref(); // first pass shortly after boot, not during it
  console.log(`[research] capture on; sweep every ${Math.round(everyMs / 1000)}s`);
}

export function stopResearchSweepMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
