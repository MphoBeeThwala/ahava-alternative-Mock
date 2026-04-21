import prisma from '../lib/prisma';

/**
 * Generate realistic biometric progression
 * Days 1-14: Stable baseline
 * Days 15-99: Gradual stress accumulation
 * Day 100+: Acute event
 */
export function generateRealisticBiometrics(dayNumber: number) {
  // Baseline values (Sylvia's normal)
  const baselineHR = 72;
  const baselineHRV = 45;
  const baselineSPO2 = 98;
  const baselineRR = 16;

  // Progression: 0 (day 15) to ~1 (day 100)
  const progression = Math.max(0, Math.min(1, (dayNumber - 15) / 85));

  // Event severity on day 100+
  const eventSeverity = Math.max(0, (dayNumber - 100) * 0.5);

  // Add realistic variation
  const noise = () => (Math.random() - 0.5) * 4;

  return {
    heartRate: baselineHR + (progression * 12) + (eventSeverity * 8) + noise(),
    hrv_rmssd: baselineHRV - (progression * 10) - (eventSeverity * 8),
    spo2: baselineSPO2 - (progression * 1.5) - (eventSeverity * 2.5),
    respiratory_rate: baselineRR + (progression * 1.5) + (eventSeverity * 1.5),
    temperature: 37.0 + (eventSeverity * 0.4),
    sleep_duration_hours: 7 + (Math.random() * 1 - 0.5),
    step_count: 7000 + (Math.random() * 4000 - 2000),
    active_calories: 150 + (Math.random() * 200)
  };
}

/**
 * Start demo stream: submits biometrics every 30 seconds
 */
export async function startDemoStream(
  userId: string,
  durationSeconds: number = 300,
  intervalSeconds: number = 30
) {
  console.log(`[DEMO] Starting biometric stream for ${userId} (${durationSeconds}s)`);

  const startDate = new Date();
  let readingCount = 0;

  const interval = setInterval(async () => {
    try {
      const elapsedSeconds = (new Date().getTime() - startDate.getTime()) / 1000;
      
      // Calculate simulated day (progress through 100+ days in ~5 min for demo)
      // 300 seconds (5 min) = 100 days progression
      const simDay = Math.floor((elapsedSeconds / durationSeconds) * 100) + 1;

      const biometrics = generateRealisticBiometrics(simDay);

      // Submit to database internally
      await prisma.biometricReading.create({
        data: {
          userId,
          heartRate: biometrics.heartRate,
          hrvRmssd: biometrics.hrv_rmssd,
          oxygenSaturation: biometrics.spo2,
          respiratoryRate: biometrics.respiratory_rate,
          temperature: biometrics.temperature,
          sleepDurationHours: biometrics.sleep_duration_hours,
          stepCount: biometrics.step_count,
          activeCalories: biometrics.active_calories,
          createdAt: new Date()
        }
      });

      readingCount++;
      console.log(`[DEMO DAY ${simDay}] Reading #${readingCount}: HR=${biometrics.heartRate.toFixed(0)} | SpO₂=${biometrics.spo2.toFixed(1)}% | RR=${biometrics.respiratory_rate.toFixed(1)}`);

      if (elapsedSeconds > durationSeconds) {
        clearInterval(interval);
        console.log(`[DEMO] Stream complete - ${readingCount} readings submitted over ${durationSeconds}s`);
      }
    } catch (e) {
      console.error('[DEMO] Stream error:', e);
    }
  }, intervalSeconds * 1000);

  return interval;
}
