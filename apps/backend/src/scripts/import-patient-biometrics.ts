/**
 * Replay a synthetic 90-day biometric file (e.g. mpho_thwala_biometrics.json)
 * into an existing patient account, with back-dated timestamps, so the real
 * early-warning pipeline can be observed over a period:
 *
 *   wearable daily summary  -> ML POST /ingest      (HR, HRV, SpO2, overnight oximetry ...)
 *   every cuff BP session   -> ML POST /ingest/bp   (crisis / stage 2 / sustained / rising rules)
 *   result                  -> biometric_readings.alertLevel/anomalies + health_alerts
 *
 * Usage (from apps/backend, DATABASE_URL and ML_SERVICE_URL set, ML service running):
 *   pnpm exec tsx src/scripts/import-patient-biometrics.ts <file.json> <email> [--dry-run] [--reset] [--no-ml]
 *
 *   --dry-run  parse and print what would be written, touch nothing
 *   --reset    first delete rows this script previously wrote for the user
 *   --no-ml    skip the ML service; use the backend's fallback threshold logic
 *
 * Rows are tagged deviceType = "demo_file_import" so --reset only removes them.
 * Events are replayed in chronological order because the ML baseline is
 * order-dependent. The file's own tiered alerts are NOT inserted: they are the
 * expected answers, printed beside what the engine actually flagged.
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import axios from 'axios';
import prisma from '../lib/prisma';
import { fallbackAnalysis } from '../services/monitoring';
import { mlServiceHeaders } from '../services/mlServiceAuth';

const TAG = 'demo_file_import';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
type Level = 'GREEN' | 'YELLOW' | 'RED';
const RANK: Record<Level, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

interface DaySummary {
  day: number; date: string; weight_kg: number;
  sys_daily_mean: number; dia_daily_mean: number;
  resting_hr_bpm: number; hrv_rmssd_ms: number;
  resp_rate_bpm: number; spo2_avg_pct: number; spo2_night_min_pct: number; night_odi_per_hr: number;
  sleep_hours: number; steps: number; skin_temp_dev_c: number;
}
interface BpReading {
  day: number; timestamp: string; session: string;
  sys_mean: number; dia_mean: number; pulse_bpm: number; irregular_rhythm_flag: boolean;
}
interface FileAlert {
  id: string; day: number; timestamp: string; tier: number; level: string; category: string; title: string;
}
interface BiometricFile {
  patient: { height_cm: number };
  event: { rechecks?: { time: string; bp: string }[] };
  alerts: FileAlert[];
  daily_summary: DaySummary[];
  bp_readings: BpReading[];
}
type Event =
  | { at: Date; kind: 'day'; d: DaySummary; bp?: BpReading }
  | { at: Date; kind: 'bp'; b: BpReading };

// File timestamps are local clinic time (SAST, UTC+2).
const at = (local: string) => new Date(`${local}:00+02:00`);
const category = (a: unknown) => String(a).match(/^[A-Za-z0-9_]+/)?.[0] ?? String(a);
const NOT_CONDITION = new Set(['Suppressed', 'No', 'Exercise']);

async function mlPost(path: string, body: unknown, userId: string) {
  const r = await axios.post(`${ML_SERVICE_URL}${path}?user_id=${userId}`, body, {
    timeout: 8000, headers: mlServiceHeaders(),
  });
  return r.data as { alert_level: Level; anomalies: string[] };
}

async function main() {
  const [file, email, ...flags] = process.argv.slice(2);
  if (!file || !email) {
    console.error('Usage: import-patient-biometrics.ts <file.json> <email> [--dry-run] [--reset] [--no-ml]');
    process.exit(1);
  }
  const dryRun = flags.includes('--dry-run');
  const noMl = flags.includes('--no-ml');
  const data: BiometricFile = JSON.parse(fs.readFileSync(file, 'utf8'));

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true, role: true } });
  if (!user) throw new Error(`No user with email ${email}`);
  console.log(`[import] ${email} -> user ${user.id} (${user.firstName}, ${user.role})`);

  const morningBp = new Map<number, BpReading>();
  const events: Event[] = [];
  for (const b of data.bp_readings) {
    if (b.session === 'morning') morningBp.set(b.day, b);
    else events.push({ at: at(b.timestamp), kind: 'bp', b });
  }
  // Day-48 rechecks from the event block are real BP measurements too.
  for (const r of data.event.rechecks ?? []) {
    const [sys, dia] = r.bp.split('/').map(Number);
    events.push({ at: at(r.time), kind: 'bp', b: { day: 48, timestamp: r.time, session: 'recheck', sys_mean: sys, dia_mean: dia, pulse_bpm: 0, irregular_rhythm_flag: false } });
  }
  for (const d of data.daily_summary) {
    const bp = morningBp.get(d.day);
    events.push({ at: bp ? at(bp.timestamp) : at(`${d.date}T07:00`), kind: 'day', d, bp });
  }
  events.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.kind === 'day' ? -1 : 1));

  console.log(`[import] ${data.daily_summary.length} days, ${events.length - data.daily_summary.length + morningBp.size} BP sessions`);
  if (dryRun) { console.log('[import] dry run, nothing written.'); return; }

  if (flags.includes('--reset')) {
    const del = await prisma.biometricReading.deleteMany({ where: { userId: user.id, deviceType: TAG } });
    const delAlerts = await prisma.healthAlert.deleteMany({ where: { userId: user.id, title: { startsWith: '[demo] ' } } });
    // The ML engine keeps its own history; stale rows would pollute the replayed baseline.
    let mlRows = 0;
    for (const t of ['biometric_time_series', 'measured_vitals_time_series']) {
      try { mlRows += Number(await prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE user_id = $1`, user.id)); } catch { /* table not created yet */ }
    }
    console.log(`[import] reset: removed ${del.count} readings, ${delAlerts.count} alerts, ${mlRows} ML history rows`);
  }

  const tally: Record<Level, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  const flaggedDays = new Map<string, Level>();
  const alertedAt = new Map<Level, Map<string, number>>();
  let n = 0;

  for (const ev of events) {
    const ts = ev.at;
    const isDay = ev.kind === 'day';
    const d = isDay ? ev.d : undefined;
    const bpRow = isDay ? ev.bp : ev.b;

    let level: Level = 'GREEN';
    let anomalies: string[] = [];
    let readiness: number | null = null;

    const wearable = d && {
      heartRate: d.resting_hr_bpm, heartRateResting: d.resting_hr_bpm, hrvRmssd: d.hrv_rmssd_ms,
      oxygenSaturation: d.spo2_avg_pct, respiratoryRate: d.resp_rate_bpm, stepCount: d.steps,
      skinTempOffset: d.skin_temp_dev_c, sleepDurationHours: d.sleep_hours,
      ecgRhythm: bpRow?.irregular_rhythm_flag ? 'irregular' : 'regular',
    };

    try {
      if (noMl) throw new Error('--no-ml');
      if (bpRow) {
        const r = await mlPost('/ingest/bp', { timestamp: ts.toISOString(), systolic: bpRow.sys_mean, diastolic: bpRow.dia_mean }, user.id);
        level = r.alert_level; anomalies = r.anomalies;
      }
      if (d && wearable) {
        const r = await mlPost('/ingest', {
          timestamp: ts.toISOString(), heart_rate_resting: d.resting_hr_bpm, hrv_rmssd: d.hrv_rmssd_ms,
          spo2: d.spo2_avg_pct, skin_temp_offset: d.skin_temp_dev_c, respiratory_rate: d.resp_rate_bpm,
          step_count: d.steps, active_calories: 0, sleep_duration_hours: d.sleep_hours,
          ecg_rhythm: wearable.ecgRhythm, spo2_night_min: d.spo2_night_min_pct, night_odi_per_hr: d.night_odi_per_hr,
        }, user.id);
        if (RANK[r.alert_level] > RANK[level]) level = r.alert_level;
        anomalies = [...new Set([...anomalies, ...r.anomalies])];
        const score = await axios.get(`${ML_SERVICE_URL}/readiness-score/${user.id}`, { timeout: 8000, headers: mlServiceHeaders() });
        readiness = score.data.score ?? null;
      }
    } catch (e: any) {
      if (e.message !== '--no-ml') console.warn(`[import] ${ts.toISOString()}: ML unavailable (${e.message}); fallback logic used`);
      const fb = fallbackAnalysis({
        ...(wearable ?? {}),
        bloodPressure: bpRow ? { systolic: bpRow.sys_mean, diastolic: bpRow.dia_mean } : undefined,
      });
      level = fb.alertLevel; anomalies = fb.anomalies; readiness = fb.readinessScore;
    }

    const row = await prisma.biometricReading.create({
      data: {
        userId: user.id,
        ...(wearable ?? {}),
        // A BP-only session has no wearable vitals; leave those columns empty
        // rather than inventing values the device never reported.
        ...(!wearable && bpRow?.pulse_bpm ? { heartRate: bpRow.pulse_bpm } : {}),
        bloodPressureSystolic: bpRow?.sys_mean ?? d?.sys_daily_mean,
        bloodPressureDiastolic: bpRow?.dia_mean ?? d?.dia_daily_mean,
        ...(d ? { weight: d.weight_kg, height: data.patient.height_cm } : {}),
        source: 'wearable', deviceType: TAG,
        alertLevel: level, anomalies: anomalies as any, readinessScore: readiness,
        createdAt: ts,
      },
    });
    n++;
    tally[level]++;
    if (level !== 'GREEN') flaggedDays.set(ts.toISOString().slice(0, 10), flaggedDays.get(ts.toISOString().slice(0, 10)) === 'RED' ? 'RED' : level);

    // Same rule as the live route: alert when a category is new for this level
    // within the last 7 days; a chronic condition does not re-alert every reading.
    if (level !== 'GREEN' && anomalies.length > 0) {
      const cats = [...new Set(anomalies.map(category))].filter((c) => !NOT_CONDITION.has(c));
      const seen = alertedAt.get(level) ?? new Map<string, number>();
      const fresh = cats.some((c) => !(seen.has(c) && ts.getTime() - seen.get(c)! <= 7 * 24 * 3600 * 1000));
      for (const c of cats) seen.set(c, fresh ? ts.getTime() : seen.get(c) ?? ts.getTime());
      alertedAt.set(level, seen);
      if (fresh) {
        await prisma.healthAlert.create({
          data: {
            userId: user.id, alertLevel: level,
            title: `[demo] ${level === 'RED' ? 'Critical Health Alert' : 'Health Warning'}`,
            message: `Detected ${anomalies.length} biometric anomaly(ies): ${anomalies.slice(0, 2).join(', ')}${anomalies.length > 2 ? '...' : ''}`,
            detectedAnomalies: anomalies as any, biometricReadingId: row.id, createdAt: ts,
          },
        });
      }
    }
  }

  console.log(`[import] wrote ${n} readings; levels:`, tally);
  console.log('[import] engine vs the file\'s own expected alerts (tier >= 2):');
  for (const a of data.alerts.filter((x) => x.tier >= 2)) {
    const day = new Date(at(a.timestamp));
    const near = [-1, 0, 1].map((o) => new Date(day.getTime() + o * 86400000).toISOString().slice(0, 10)).map((k) => flaggedDays.get(k)).filter(Boolean) as Level[];
    const got = near.length ? near.reduce((m, l) => (RANK[l] > RANK[m] ? l : m)) : 'not flagged';
    console.log(`  day ${String(a.day).padStart(2)}  T${a.tier} ${a.title.slice(0, 48).padEnd(48)} engine: ${got}`);
  }
  const first = [...flaggedDays.keys()].sort()[0];
  console.log(`[import] first engine flag: ${first ?? 'none'}; flagged days: ${flaggedDays.size}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
