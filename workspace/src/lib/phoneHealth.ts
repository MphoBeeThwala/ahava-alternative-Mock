/**
 * Reads the patient's health data straight from the phone's health store
 * (Google Health Connect on Android, Apple Health on iPhone) and turns it into
 * the summary POST /biometrics/health-connect accepts. No Terra/Rook account
 * is involved.
 *
 * The aggregation (buildSyncPayload) is pure so it can be tested without a
 * phone. The one rule it exists to enforce: a field is only filled in when the
 * device actually reported it. Nothing is estimated or defaulted, because the
 * backend treats every value it receives as a real measurement.
 */

export type PhonePlatform = 'android' | 'ios';

export interface HealthSampleLike {
  value: number;
  unit?: string;
  startDate: string;
  endDate: string;
  sleepState?: string;
  systolic?: number;
  diastolic?: number;
  sourceName?: string;
}

export type SamplesByType = Partial<Record<
  'heartRate' | 'restingHeartRate' | 'heartRateVariability' | 'oxygenSaturation' | 'respiratoryRate' |
  'bodyTemperature' | 'sleep' | 'steps' | 'calories' | 'bloodPressure',
  HealthSampleLike[]
>>;

export interface PhoneSyncPayload {
  platform: PhonePlatform;
  deviceModel?: string;
  syncedAt: string;
  heartRate?: number;
  heartRateResting?: number;
  hrvRmssd?: number;
  hrvSdnn?: number;
  oxygenSaturation?: number;
  respiratoryRate?: number;
  temperature?: number;
  sleepDurationHours?: number;
  steps?: number;
  activeCalories?: number;
  bloodPressure?: { systolic: number; diastolic: number };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const latest = <T extends { endDate: string }>(xs: T[]): T | undefined =>
  [...xs].sort((a, b) => Date.parse(b.endDate) - Date.parse(a.endDate))[0];

/** Sleep stages that count as sleep (in-bed and awake time do not). */
const ASLEEP = new Set(['asleep', 'light', 'deep', 'rem']);

export function buildSyncPayload(input: {
  platform: PhonePlatform;
  deviceModel?: string;
  samples: SamplesByType;
  now?: Date;
}): PhoneSyncPayload | null {
  const { platform, deviceModel, samples } = input;
  const out: PhoneSyncPayload = {
    platform,
    ...(deviceModel ? { deviceModel } : {}),
    syncedAt: (input.now ?? new Date()).toISOString(),
  };

  const values = (type: keyof SamplesByType) => (samples[type] ?? []).map((s) => s.value).filter(finite);

  // Resting heart rate: the most recent value the device computed. Plain heart
  // rate is an average over whatever the person was doing, so it is sent as
  // heartRate and the backend never treats it as resting.
  const resting = latest(samples.restingHeartRate ?? []);
  if (resting && finite(resting.value)) out.heartRateResting = round(resting.value);
  const hr = values('heartRate');
  if (hr.length) out.heartRate = round(mean(hr));

  // HRV: Android reports RMSSD (what the early-warning baseline uses); Apple
  // reports SDNN, a different statistic that must not be mixed into it.
  const hrv = values('heartRateVariability');
  if (hrv.length) {
    if (platform === 'android') out.hrvRmssd = round(mean(hrv));
    else out.hrvSdnn = round(mean(hrv));
  }

  // Blood oxygen is a percentage; tolerate a 0-1 fraction from a source that sends one.
  const spo2 = values('oxygenSaturation').map((v) => (v > 0 && v <= 1 ? v * 100 : v));
  if (spo2.length) out.oxygenSaturation = round(mean(spo2));

  const rr = values('respiratoryRate');
  if (rr.length) out.respiratoryRate = round(mean(rr));

  const temps = (samples.bodyTemperature ?? [])
    .filter((s) => finite(s.value))
    .map((s) => (s.unit === 'fahrenheit' ? ((s.value - 32) * 5) / 9 : s.value));
  if (temps.length) out.temperature = round(mean(temps), 2);

  const asleepMinutes = (samples.sleep ?? [])
    .filter((s) => finite(s.value) && (s.sleepState === undefined || ASLEEP.has(s.sleepState)))
    .reduce((sum, s) => sum + s.value, 0);
  if (asleepMinutes > 0) out.sleepDurationHours = round(asleepMinutes / 60);

  const steps = values('steps');
  if (steps.length) out.steps = Math.round(steps.reduce((a, b) => a + b, 0));
  const cals = values('calories');
  if (cals.length) out.activeCalories = round(cals.reduce((a, b) => a + b, 0));

  const bp = latest((samples.bloodPressure ?? []).filter((s) => finite(s.systolic) && finite(s.diastolic)));
  if (bp && bp.systolic! > bp.diastolic!) out.bloodPressure = { systolic: bp.systolic!, diastolic: bp.diastolic! };

  const measured = Object.keys(out).filter((k) => !['platform', 'deviceModel', 'syncedAt'].includes(k));
  return measured.length ? out : null;
}

// ─── Native access ─────────────────────────────────────────────────────────

export const READ_TYPES = [
  'heartRate', 'restingHeartRate', 'heartRateVariability', 'oxygenSaturation', 'respiratoryRate',
  'bodyTemperature', 'sleep', 'steps', 'calories', 'bloodPressure',
] as const;

export type PhoneHealthAvailability =
  | { state: 'web' }
  | { state: 'unavailable'; reason: string }
  | { state: 'ready'; platform: PhonePlatform };

async function loadPlugin() {
  const [{ Capacitor }, { Health }] = await Promise.all([import('@capacitor/core'), import('@capgo/capacitor-health')]);
  return { Capacitor, Health };
}

export async function getPhoneHealthAvailability(): Promise<PhoneHealthAvailability> {
  try {
    const { Capacitor, Health } = await loadPlugin();
    if (!Capacitor.isNativePlatform()) return { state: 'web' };
    const platform = Capacitor.getPlatform() as PhonePlatform;
    const res = await Health.isAvailable();
    if (!res.available) {
      return {
        state: 'unavailable',
        reason: platform === 'android'
          ? 'Health Connect is not installed or not up to date on this phone.'
          : 'Apple Health is not available on this device.',
      };
    }
    return { state: 'ready', platform };
  } catch {
    return { state: 'web' };
  }
}

/** Opens the system permission sheet. Returns the data types the patient allowed. */
export async function requestPhoneHealthAccess(): Promise<string[]> {
  const { Health } = await loadPlugin();
  const status = await Health.requestAuthorization({ read: [...READ_TYPES] });
  return status.readAuthorized as string[];
}

/** Reads the last `hours` of data for every allowed type and returns the payload (null if nothing was measured). */
export async function readPhoneHealth(platform: PhonePlatform, hours = 24): Promise<PhoneSyncPayload | null> {
  const { Health } = await loadPlugin();
  const status = await Health.checkAuthorization({ read: [...READ_TYPES] });
  const allowed = new Set<string>(status.readAuthorized as string[]);
  const end = new Date();
  // Sleep sessions start the evening before; look back far enough to catch last night.
  const start = (h: number) => new Date(end.getTime() - h * 3600_000).toISOString();

  const samples: SamplesByType = {};
  let deviceModel: string | undefined;
  for (const type of READ_TYPES) {
    if (!allowed.has(type)) continue;
    try {
      const res = await Health.readSamples({
        dataType: type,
        startDate: start(type === 'sleep' ? Math.max(hours, 36) : hours),
        endDate: end.toISOString(),
        limit: 1000,
      });
      samples[type] = res.samples as HealthSampleLike[];
      deviceModel ??= res.samples.find((s) => s.sourceName)?.sourceName;
    } catch {
      // One unreadable type must not stop the others.
    }
  }
  return buildSyncPayload({ platform, deviceModel, samples, now: end });
}
