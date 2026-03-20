/**
 * healthConnectService.ts
 *
 * Google Health Connect integration via the `capacitor-health` package.
 * Only active when running as a native Android app (Capacitor).
 * Falls back to a no-op on web so the web app works unchanged.
 *
 * Available data via capacitor-health API:
 *   - Steps (queryAggregated)
 *   - Active calories (queryAggregated)
 *   - Heart rate samples (queryWorkouts with includeHeartRate)
 *   - Workout summaries (duration, distance, type)
 *
 * Data flow:
 *   Android Health Connect → capacitor-health plugin → aggregateAndSync()
 *   → POST /api/biometrics/health-connect → ML service pipeline
 *
 * Install (already done):
 *   pnpm add -w @capacitor/core @capacitor/android @capacitor/device capacitor-health
 *   npx cap add android
 */

import type { HealthPlugin } from 'capacitor-health';
import { Capacitor } from '@capacitor/core';

// Dynamic import keeps web bundle clean — plugin only loads on Android native
async function getPlugin(): Promise<HealthPlugin | null> {
  try {
    const { Health } = await import('capacitor-health');
    return Health as unknown as HealthPlugin;
  } catch {
    return null;
  }
}

export type HealthConnectStatus =
  | 'unavailable'      // Not Android / Capacitor not present
  | 'not_installed'    // Health Connect app not installed (Android 9–13)
  | 'needs_permission' // Plugin available but permissions not granted
  | 'ready'
  | 'error';

export interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  alertLevel?: string;
  readinessScore?: number | null;
  anomalies?: string[];
  error?: string;
}

const PERMISSIONS: string[] = [
  'READ_STEPS',
  'READ_HEART_RATE',
  'READ_WORKOUTS',
  'READ_ACTIVE_CALORIES',
  'READ_TOTAL_CALORIES',
  'READ_DISTANCE',
];

// ─── Platform check ───────────────────────────────────────────────────────────

export function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

// ─── Availability + permission check ─────────────────────────────────────────

export async function checkAvailability(): Promise<HealthConnectStatus> {
  if (!isAndroidNative()) return 'unavailable';

  const plugin = await getPlugin();
  if (!plugin) return 'unavailable';

  try {
    const { available } = await plugin.isHealthAvailable();
    if (!available) return 'not_installed';

    // Check if we already have permissions by requesting them silently
    // capacitor-health returns which ones were granted
    const result = await (plugin as any).checkPermissions?.({
      permissions: PERMISSIONS,
    });

    if (!result) return 'needs_permission';

    const granted: boolean[] = Object.values(result.permissions?.[0] ?? {});
    return granted.every(Boolean) ? 'ready' : 'needs_permission';
  } catch {
    return 'needs_permission'; // Assume permissions needed on error
  }
}

// ─── Permission request ───────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;

  try {
    const result = await (plugin as any).requestHealthPermissions({
      permissions: PERMISSIONS,
    }) as { permissions: Record<string, boolean>[] };

    const permMap: Record<string, boolean> = result.permissions?.[0] ?? {};
    // Consider success if we at least got steps + heart rate
    return !!(permMap['READ_STEPS'] && permMap['READ_HEART_RATE']);
  } catch (err) {
    console.error('[healthConnect] requestPermissions error:', err);
    return false;
  }
}

// ─── Data read ────────────────────────────────────────────────────────────────

export async function readLast24Hours() {
  const plugin = await getPlugin();
  if (!plugin) return null;

  const endDate   = new Date().toISOString();
  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [stepsResult, caloriesResult, workoutsResult] = await Promise.allSettled([
    plugin.queryAggregated({ startDate, endDate, dataType: 'steps',           bucket: 'day' }),
    plugin.queryAggregated({ startDate, endDate, dataType: 'active-calories', bucket: 'day' }),
    plugin.queryWorkouts({
      startDate,
      endDate,
      includeHeartRate: true,
      includeRoute:     false,
      includeSteps:     true,
    }),
  ]);

  const steps = stepsResult.status === 'fulfilled'
    ? stepsResult.value.aggregatedData.reduce((s, d) => s + d.value, 0)
    : 0;

  const activeCalories = caloriesResult.status === 'fulfilled'
    ? caloriesResult.value.aggregatedData.reduce((s, d) => s + d.value, 0)
    : 0;

  const workouts = workoutsResult.status === 'fulfilled'
    ? workoutsResult.value.workouts
    : [];

  // Flatten all heart rate samples from all workouts
  const heartRateSamples: number[] = workouts.flatMap(
    (w) => (w.heartRate ?? []).map((s) => s.bpm)
  );

  return { steps, activeCalories, heartRateSamples, workouts };
}

// ─── Sync to backend ──────────────────────────────────────────────────────────

export async function aggregateAndSync(
  apiBaseUrl: string,
  authToken: string
): Promise<SyncResult> {
  const status = await checkAvailability();

  if (status !== 'ready') {
    return { success: false, recordsProcessed: 0, error: `Health Connect status: ${status}` };
  }

  try {
    const data = await readLast24Hours();
    if (!data) return { success: false, recordsProcessed: 0, error: 'Plugin unavailable' };

    const { steps, activeCalories, heartRateSamples, workouts } = data;

    if (!steps && !heartRateSamples.length && !workouts.length) {
      return { success: true, recordsProcessed: 0 };
    }

    // Detect device model
    let deviceModel = 'Android (Health Connect)';
    try {
      const { Device } = await import('@capacitor/device');
      const info = await Device.getInfo();
      deviceModel = `${info.manufacturer} ${info.model}`;
    } catch { /* non-critical */ }

    const res = await fetch(`${apiBaseUrl}/api/biometrics/health-connect`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        steps,
        activeCalories,
        heartRateSamples,
        workoutCount: workouts.length,
        deviceModel,
        syncedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, recordsProcessed: 0, error: text };
    }

    const result = await res.json() as {
      recordsProcessed?: number;
      alertLevel?: string;
      readinessScore?: number | null;
      anomalies?: string[];
    };
    return {
      success:          true,
      recordsProcessed: result.recordsProcessed ?? 1,
      alertLevel:       result.alertLevel,
      readinessScore:   result.readinessScore,
      anomalies:        result.anomalies ?? [],
    };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[healthConnect] aggregateAndSync error:', message);
    return { success: false, recordsProcessed: 0, error: message };
  }
}

// ─── Open Health Connect settings ────────────────────────────────────────────

export async function openHealthConnectSettings(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.openHealthConnectSettings();
  } catch { /* non-critical */ }
}
