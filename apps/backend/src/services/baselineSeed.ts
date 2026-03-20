/**
 * baselineSeed.ts
 *
 * SA demographic seed baselines (WHO / SA NDoH sub-Saharan African cohort norms).
 * Used by the backend to pre-populate UserBaseline records for new patients on
 * registration — ensuring the ML service has a meaningful Day-1 comparison point
 * instead of returning "Insufficient data" for the first 14 days.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type AgeBand = '18-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70+';

interface MetricSeed {
  mean: number;
  std: number;
}

interface DemographicSeed {
  heartRate:        MetricSeed;
  hrvRmssd:         MetricSeed;
  spo2:             MetricSeed;
  respiratoryRate:  MetricSeed;
  stepCount:        MetricSeed;
  activeCalories:   MetricSeed;
  sleepHours:       MetricSeed;
}

// ---------------------------------------------------------------------------
// SA NDoH / WHO sub-Saharan African adult reference values
// ---------------------------------------------------------------------------
const SA_SEEDS: Record<AgeBand, DemographicSeed> = {
  '18-29': {
    heartRate:       { mean: 68, std: 9  },
    hrvRmssd:        { mean: 48, std: 16 },
    spo2:            { mean: 98.0, std: 1.0 },
    respiratoryRate: { mean: 14, std: 2  },
    stepCount:       { mean: 8500, std: 3000 },
    activeCalories:  { mean: 450,  std: 200  },
    sleepHours:      { mean: 7.5,  std: 1.2  },
  },
  '30-39': {
    heartRate:       { mean: 70, std: 10 },
    hrvRmssd:        { mean: 44, std: 15 },
    spo2:            { mean: 97.8, std: 1.1 },
    respiratoryRate: { mean: 15, std: 2  },
    stepCount:       { mean: 7800, std: 2800 },
    activeCalories:  { mean: 420,  std: 190  },
    sleepHours:      { mean: 7.2,  std: 1.2  },
  },
  '40-49': {
    heartRate:       { mean: 72, std: 10 },
    hrvRmssd:        { mean: 40, std: 14 },
    spo2:            { mean: 97.5, std: 1.2 },
    respiratoryRate: { mean: 15, std: 3  },
    stepCount:       { mean: 7000, std: 2600 },
    activeCalories:  { mean: 390,  std: 180  },
    sleepHours:      { mean: 7.0,  std: 1.3  },
  },
  '50-59': {
    heartRate:       { mean: 74, std: 11 },
    hrvRmssd:        { mean: 35, std: 13 },
    spo2:            { mean: 97.2, std: 1.2 },
    respiratoryRate: { mean: 16, std: 3  },
    stepCount:       { mean: 6200, std: 2400 },
    activeCalories:  { mean: 350,  std: 170  },
    sleepHours:      { mean: 6.8,  std: 1.3  },
  },
  '60-69': {
    heartRate:       { mean: 76, std: 11 },
    hrvRmssd:        { mean: 29, std: 12 },
    spo2:            { mean: 96.8, std: 1.3 },
    respiratoryRate: { mean: 16, std: 3  },
    stepCount:       { mean: 5500, std: 2200 },
    activeCalories:  { mean: 300,  std: 150  },
    sleepHours:      { mean: 6.5,  std: 1.4  },
  },
  '70+': {
    heartRate:       { mean: 78, std: 12 },
    hrvRmssd:        { mean: 22, std: 11 },
    spo2:            { mean: 96.5, std: 1.4 },
    respiratoryRate: { mean: 17, std: 4  },
    stepCount:       { mean: 4500, std: 2000 },
    activeCalories:  { mean: 250,  std: 130  },
    sleepHours:      { mean: 6.2,  std: 1.5  },
  },
};

export function getAgeBand(dateOfBirth: Date | null): AgeBand {
  if (!dateOfBirth) return '40-49';
  const age = Math.floor(
    (Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
  if (age < 30) return '18-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  if (age < 70) return '60-69';
  return '70+';
}

function applySexAdjustment(seed: DemographicSeed, gender: string | null): DemographicSeed {
  if (!gender || !['female', 'f', 'woman'].includes(gender.toLowerCase())) return seed;
  return {
    ...seed,
    heartRate:  { ...seed.heartRate,  mean: seed.heartRate.mean  + 3 },
    hrvRmssd:   { ...seed.hrvRmssd,   mean: seed.hrvRmssd.mean   - 4 },
  };
}

export function getDemographicSeed(
  dateOfBirth: Date | null,
  gender: string | null
): DemographicSeed {
  const band = getAgeBand(dateOfBirth);
  const raw  = SA_SEEDS[band];
  return applySexAdjustment(raw, gender);
}

/**
 * Create or update a UserBaseline row for a patient using SA demographic seeds.
 * Called at patient registration so the ML service has Day-1 reference values.
 */
export async function seedBaselineForUser(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true, gender: true },
    });

    if (!user) return;

    const seed = getDemographicSeed(user.dateOfBirth, user.gender);
    const band = getAgeBand(user.dateOfBirth);

    await (prisma as any).userBaseline.upsert({
      where: { userId },
      create: {
        userId,
        hrMean:    seed.heartRate.mean,
        hrStd:     seed.heartRate.std,
        hrvMean:   seed.hrvRmssd.mean,
        hrvStd:    seed.hrvRmssd.std,
        spo2Mean:  seed.spo2.mean,
        spo2Std:   seed.spo2.std,
        rrMean:    seed.respiratoryRate.mean,
        rrStd:     seed.respiratoryRate.std,
        demographicSeed: { ageBand: band, gender: user.gender },
        stage: 'PROVISIONAL',
        confidencePct: 0,
        dataPointCount: 0,
        lastCalculated: new Date(),
      },
      update: {
        demographicSeed: { ageBand: band, gender: user.gender },
        lastCalculated: new Date(),
      },
    });

    console.log(`[baselineSeed] Seeded PROVISIONAL baseline for user ${userId} (${band})`);
  } catch (err) {
    console.error(`[baselineSeed] Failed to seed baseline for ${userId}:`, err);
  }
}

/**
 * Update baseline confidence stage from ML service response.
 * Called after each biometric ingest when the ML service returns baseline info.
 */
export async function updateBaselineStage(
  userId: string,
  stage: string,
  confidence: number,
  dataPoints: number
): Promise<void> {
  try {
    await (prisma as any).userBaseline.upsert({
      where: { userId },
      create: {
        userId,
        stage,
        confidencePct: confidence,
        dataPointCount: dataPoints,
        lastCalculated: new Date(),
      },
      update: {
        stage,
        confidencePct: confidence,
        dataPointCount: dataPoints,
        lastCalculated: new Date(),
      },
    });
  } catch (err) {
    console.error(`[baselineSeed] Failed to update baseline stage for ${userId}:`, err);
  }
}
