/**
 * Seed mock patient users for load and early-warning testing.
 *
 * Usage:
 *   pnpm run seed:mock-patients
 *   MOCK_PATIENT_COUNT=500 pnpm run seed:mock-patients
 *   MOCK_WITH_HISTORY=1 MOCK_EARLY_WARNING_COUNT=50 pnpm run seed:mock-patients
 *
 * Env:
 *   MOCK_PATIENT_COUNT       Number of patients to create (default 1000)
 *   MOCK_PATIENT_PASSWORD    Shared password for all mock users (default MockPatient1!)
 *   MOCK_WITH_HISTORY        1 = backfill 14 days of biometric_readings per user (default 0)
 *   MOCK_EARLY_WARNING_COUNT Number of users to mark for early-warning test (default 0); no extra data here, use run-early-warning-test to send anomalous readings via API
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const COUNT = Math.min(parseInt(process.env.MOCK_PATIENT_COUNT || '1000', 10) || 1000, 10000);
const PASSWORD = process.env.MOCK_PATIENT_PASSWORD || 'MockPatient1!';
const WITH_HISTORY = process.env.MOCK_WITH_HISTORY === '1' || process.env.MOCK_WITH_HISTORY === 'true';
const EARLY_WARNING_COUNT = Math.min(
  Math.max(0, parseInt(process.env.MOCK_EARLY_WARNING_COUNT || '0', 10) || 0),
  COUNT
);

const FIRST_NAMES = [
  'Thabo', 'Naledi', 'Sipho', 'Zanele', 'Lerato', 'Kagiso', 'Amahle', 'Bongani',
  'Nomsa', 'Sello', 'Precious', 'Mandla', 'Zola', 'Nkosi', 'Lindiwe', 'Sello',
  'Nthabiseng', 'Tshepo', 'Refilwe', 'Kgosi', 'Naledi', 'Thabiso', 'Palesa', 'Kabelo'
];

const LAST_NAMES = [
  'Dlamini', 'Nkosi', 'Khumalo', 'Mthembu', 'Sithole', 'Ndlovu', 'Zulu', 'Molefe',
  'Sithole', 'Ngcobo', 'Mahlangu', 'Zwane', 'Ntuli', 'Mkhize', 'Zungu', 'Cele',
  'Moleko', 'Radebe', 'Mthembu', 'Shabalala', 'Nkomo', 'Molefe', 'Zulu', 'Nkosi'
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateYearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - randomInt(18, years));
  d.setMonth(randomInt(0, 11));
  d.setDate(randomInt(1, 28));
  return d;
}

async function main() {
  console.log(`[seed-mock-patients] Creating ${COUNT} mock patients (password: ${PASSWORD.replace(/./g, '*')})`);
  if (WITH_HISTORY) console.log('[seed-mock-patients] With 14-day biometric history per user.');
  if (EARLY_WARNING_COUNT > 0) console.log(`[seed-mock-patients] Early-warning subset: ${EARLY_WARNING_COUNT} users (use run-early-warning-test to send anomalous readings).`);

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const created: string[] = [];
  const batchSize = 100;

  for (let i = 0; i < COUNT; i += batchSize) {
    const batch = Math.min(batchSize, COUNT - i);
    const users = [];
    for (let j = 0; j < batch; j++) {
      const n = i + j + 1;
      const email = `patient_${String(n).padStart(4, '0')}@mock.ahava.test`;
      users.push({
        email,
        passwordHash,
        firstName: randomChoice(FIRST_NAMES),
        lastName: randomChoice(LAST_NAMES),
        role: 'PATIENT' as const,
        preferredLanguage: 'en-ZA',
        dateOfBirth: randomDateYearsAgo(70),
        gender: randomChoice(['M', 'F', 'Other']),
      });
    }
    const result = await prisma.user.createMany({
      data: users,
      skipDuplicates: true,
    });
    if (result.count > 0) {
      for (let j = 0; j < batch; j++) created.push(users[j].email);
    }
  }

  console.log(`[seed-mock-patients] Created/skipped (duplicates) ${created.length} users.`);

  if (WITH_HISTORY) {
    const emailsToBackfill =
      created.length > 0
        ? created.slice(0, 200)
        : Array.from({ length: 50 }, (_, i) => `patient_${String(i + 1).padStart(4, '0')}@mock.ahava.test`);
    console.log('[seed-mock-patients] Backfilling 14 days of biometric readings...');
    const patients = await prisma.user.findMany({
      where: { email: { in: emailsToBackfill } },
      select: { id: true, email: true },
    });
    const withEnoughReadings = await Promise.all(
      patients.map(async (u) => {
        const count = await prisma.biometricReading.count({ where: { userId: u.id } });
        return count >= 14 ? null : u;
      })
    );
    const toBackfill = withEnoughReadings.filter((u): u is NonNullable<typeof u> => u != null);
    const patientsToRun = toBackfill.length > 0 ? toBackfill : patients;
    if (patientsToRun.length === 0) {
      console.log('[seed-mock-patients] No patients to backfill (none found or all already have 14+ readings).');
    } else {
    const days = 14;
    const readingsPerDay = 2;
    for (const user of patientsToRun) {
      for (let d = 0; d < days; d++) {
        for (let r = 0; r < readingsPerDay; r++) {
          const createdAt = new Date();
          createdAt.setDate(createdAt.getDate() - (days - d));
          createdAt.setHours(8 + r * 6, randomInt(0, 59), 0, 0);
          const hr = randomInt(62, 78);
          const hrr = randomInt(60, 76);
          const hrv = randomInt(40, 65);
          const spo2 = randomInt(96, 100);
          const resp = randomInt(14, 18);
          const steps = randomInt(2000, 8000);
          const cal = randomInt(80, 250);
          const row = await prisma.biometricReading.create({
            data: {
              userId: user.id,
              heartRate: hr,
              heartRateResting: hrr,
              hrvRmssd: hrv,
              oxygenSaturation: spo2,
              respiratoryRate: resp,
              stepCount: steps,
              activeCalories: cal,
              source: 'wearable',
              deviceType: 'mock_seed',
            },
          });
          await prisma.$executeRaw`UPDATE biometric_readings SET "createdAt" = ${createdAt}::timestamptz WHERE id = ${row.id}`;
        }
      }
    }
    console.log(`[seed-mock-patients] Backfilled history for ${patientsToRun.length} users (${patientsToRun.length * days * readingsPerDay} readings).`);
    }
  }

  console.log('[seed-mock-patients] Done. Use patient_0001@mock.ahava.test .. patient_1000@mock.ahava.test with the configured password for load tests.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
