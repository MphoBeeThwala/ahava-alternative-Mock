/**
 * Shadow scoring: a candidate model's prediction is stored next to the row it
 * was made for, to be compared with what later happened. It is never returned
 * by any route, shown to anyone, or fed into a live decision.
 *
 * Only models a named human has approved for shadow use are served by the ML
 * service (`research/registry.py approve ...`). Until one is approved this
 * module finds nothing to run and does nothing.
 */
import axios from 'axios';
import prisma from '../../lib/prisma';
import { mlServiceHeaders } from '../mlServiceAuth';

export interface ShadowModel {
  name: string;
  version: string;
  target: string;
}

interface ShadowItemResult {
  snapshot_id: string;
  predictions: Array<{
    model: string;
    version: string;
    target: string;
    probability: number;
    contributions?: Array<{ feature: string; logit: number }>;
  }>;
}

const mlUrl = () => (process.env.ML_SERVICE_URL ?? '').replace(/\/$/, '');

export function shadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.RESEARCH_SHADOW_ENABLED ?? 'true').trim().toLowerCase() === 'false') return false;
  return Boolean((env.ML_SERVICE_URL ?? '').trim());
}

export async function listShadowModels(): Promise<ShadowModel[]> {
  const res = await axios.get(`${mlUrl()}/research/models`, { timeout: 5000, headers: mlServiceHeaders() });
  const models = Array.isArray(res.data?.models) ? res.data.models : [];
  return models.filter((m: any) => m?.name && m?.version && m?.target) as ShadowModel[];
}

const HISTORY_DAYS = 30;
const HISTORY_MAX = 60;
const BATCH = 50;

// The columns the ML side builds features from. No subjectKey, no sourceRef:
// the model service gets measurements and nothing that identifies a subject.
const FEATURE_COLUMNS = {
  id: true, observedDay: true, ageBand: true, sex: true, smoker: true, diabetes: true,
  hypertensionKnown: true, hivPositive: true, activeTb: true, bpTreatment: true,
  totalCholesterolMmol: true, hdlMmol: true, hrResting: true, hrvRmssd: true, spo2: true,
  respRate: true, skinTempOffset: true, sbp: true, dbp: true, glucose: true, bmi: true,
  steps: true, sleepHours: true, ecgIrregular: true, temperatureTrend: true, source: true,
} as const;

function wire(row: Record<string, any>) {
  return { ...row, observedDay: row.observedDay.toISOString().slice(0, 10) };
}

/**
 * Score snapshots that have no prediction yet from the currently approved
 * models. A newly approved model therefore also back-scores the snapshots
 * captured before it existed, which is what makes a retrospective shadow
 * evaluation possible.
 */
export async function scoreUnscored(limitPerModel = 250): Promise<{ scored: number }> {
  if (!shadowEnabled()) return { scored: 0 };
  let models: ShadowModel[];
  try {
    models = await listShadowModels();
  } catch (err) {
    console.warn('[research] shadow model list unavailable (non-fatal):', err instanceof Error ? err.message : 'error');
    return { scored: 0 };
  }
  if (models.length === 0) return { scored: 0 };

  let scored = 0;
  for (const model of models) {
    const pending = await prisma.researchSnapshot.findMany({
      where: { predictions: { none: { modelName: model.name, modelVersion: model.version } } },
      orderBy: { observedDay: 'asc' },
      take: limitPerModel,
      select: { ...FEATURE_COLUMNS, subjectKey: true },
    });
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const items = [];
      for (const snap of chunk) {
        const since = new Date(snap.observedDay.getTime() - HISTORY_DAYS * 86_400_000);
        const history = await prisma.researchSnapshot.findMany({
          where: { subjectKey: snap.subjectKey, observedDay: { gte: since, lt: snap.observedDay }, id: { not: snap.id } },
          orderBy: { observedDay: 'desc' },
          take: HISTORY_MAX,
          select: FEATURE_COLUMNS,
        });
        const { subjectKey: _drop, ...snapshot } = snap;
        items.push({ snapshot_id: snap.id, snapshot: wire(snapshot), history: history.reverse().map(wire) });
      }
      try {
        const res = await axios.post(
          `${mlUrl()}/research/shadow-predict`,
          { models: [{ name: model.name, version: model.version }], items },
          { timeout: 20000, headers: mlServiceHeaders() },
        );
        const results: ShadowItemResult[] = Array.isArray(res.data?.results) ? res.data.results : [];
        for (const r of results) {
          for (const p of r.predictions ?? []) {
            if (typeof p.probability !== 'number' || !Number.isFinite(p.probability)) continue;
            await prisma.researchPrediction.upsert({
              where: { snapshotId_modelName_modelVersion: { snapshotId: r.snapshot_id, modelName: p.model, modelVersion: p.version } },
              create: {
                snapshotId: r.snapshot_id, modelName: p.model, modelVersion: p.version, target: p.target,
                probability: p.probability, contributions: (p.contributions ?? undefined) as object | undefined,
              },
              update: {},
            });
            scored += 1;
          }
        }
      } catch (err) {
        console.warn('[research] shadow scoring batch failed (non-fatal):', err instanceof Error ? err.message : 'error');
        break; // ML service down or slow: stop this model, retry next sweep
      }
    }
  }
  return { scored };
}
