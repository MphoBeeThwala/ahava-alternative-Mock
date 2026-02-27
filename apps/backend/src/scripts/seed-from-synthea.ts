/**
 * Seed Ahava DB from Synthea CSV output (patients.csv + observations.csv).
 *
 * Prerequisites:
 *   1. Run Synthea with CSV export enabled (exporter.csv.export = true).
 *   2. Copy or point SYNTHEA_CSV_PATH to the directory containing patients.csv and observations.csv.
 *
 * Usage:
 *   pnpm run seed:from-synthea
 *   SYNTHEA_CSV_PATH=./output/csv SYNTHEA_PASSWORD='MyResearch1!' pnpm run seed:from-synthea
 *
 * Env:
 *   SYNTHEA_CSV_PATH   Directory with patients.csv and observations.csv (default: ./synthea-output/csv)
 *   SYNTHEA_PASSWORD   Shared password for all imported patients (default: SyntheaPatient1!)
 *   SYNTHEA_MAX_PATIENTS  Max patients to import, 0 = all (default: 0)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Resolve CSV path: env wins; else try cwd, parent, and repo root (pnpm runs with cwd=apps/backend)
function resolveCsvPath(): string {
  if (process.env.SYNTHEA_CSV_PATH) {
    const p = process.env.SYNTHEA_CSV_PATH;
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'synthea-output', 'csv'),
    path.join(cwd, 'output', 'csv'),
    path.resolve(cwd, '..', 'synthea-output', 'csv'),
    path.resolve(cwd, '..', 'output', 'csv'),
    path.resolve(cwd, '..', '..', 'synthea-output', 'csv'),
    path.resolve(cwd, '..', '..', 'output', 'csv'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'patients.csv'))) return dir;
  }
  return path.resolve(cwd, '..', '..', 'output', 'csv');
}

const CSV_PATH = resolveCsvPath();
const PASSWORD = process.env.SYNTHEA_PASSWORD || 'SyntheaPatient1!';
const MAX_PATIENTS = parseInt(process.env.SYNTHEA_MAX_PATIENTS || '0', 10) || 0;

// LOINC codes → BiometricReading fields (observations.csv Code column)
const LOINC_TO_FIELD: Record<string, keyof {
  heartRate?: number; heartRateResting?: number;
  bloodPressureSystolic?: number; bloodPressureDiastolic?: number;
  temperature?: number; oxygenSaturation?: number; respiratoryRate?: number;
  weight?: number; height?: number;
}> = {
  '8867-4': 'heartRate',           // Heart rate
  '8480-6': 'bloodPressureSystolic',
  '8462-4': 'bloodPressureDiastolic',
  '8310-5': 'temperature',          // Body temperature
  '59408-5': 'oxygenSaturation',
  '9279-1': 'respiratoryRate',
  '8302-2': 'height',              // Body height (cm)
  '29463-7': 'weight',             // Body weight (kg)
};

/** Parse a single CSV line respecting double-quoted fields (commas inside quotes are not separators). */
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function readCSV(filePath: string): { headers: string[]; rows: string[][] } {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error(`Empty CSV: ${fullPath}`);
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCSVLine(l));
  return { headers, rows };
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? '';
  });
  return obj;
}

/** Safe numeric value for observation Value column. */
function toNum(s: string | undefined): number | undefined {
  if (s == null || s === '') return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Generate unique email for Synthea patient (no real email in Synthea). */
function syntheaEmail(first: string, last: string, id: string): string {
  const safe = (x: string) => (x || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
  const shortId = id.replace(/-/g, '').slice(0, 8);
  return `synthea_${safe(first)}_${safe(last)}_${shortId}@synthea.ahava.test`;
}

async function main() {
  console.log('[seed-from-synthea] CSV path:', CSV_PATH);
  const patientsPath = path.join(CSV_PATH, 'patients.csv');
  const observationsPath = path.join(CSV_PATH, 'observations.csv');

  if (!fs.existsSync(patientsPath)) {
    console.error('[seed-from-synthea] Missing patients.csv at', patientsPath);
    console.error('Run Synthea first: pnpm run synthea:run-and-seed (writes to repo root output/csv).');
    console.error('Or set SYNTHEA_CSV_PATH to the folder containing patients.csv (e.g. ../../output/csv from backend).');
    process.exit(1);
  }

  const { headers: pHdr, rows: patientRows } = readCSV(patientsPath);
  const patients = patientRows.map((r) => rowToObject(pHdr, r));
  const limit = MAX_PATIENTS > 0 ? Math.min(MAX_PATIENTS, patients.length) : patients.length;
  const toImport = patients.slice(0, limit);
  console.log(`[seed-from-synthea] Importing ${toImport.length} patients (total in CSV: ${patients.length})`);

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const syntheaIdToUserId: Record<string, string> = {};
  let created = 0;
  let skipped = 0;

  for (const p of toImport) {
    const id = p.Id || p['Id'];
    const first = p.First || p['First'] || '';
    const last = p.Last || p['Last'] || '';
    const birthDate = p.BirthDate || p['BirthDate'];
    const gender = p.Gender || p['Gender'] || null;
    const email = syntheaEmail(first, last, id);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      syntheaIdToUserId[id] = existing.id;
      skipped++;
      continue;
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: first || 'Synthea',
        lastName: last || 'Patient',
        role: 'PATIENT',
        dateOfBirth: birthDate ? new Date(birthDate) : undefined,
        gender: gender || undefined,
        preferredLanguage: 'en-ZA',
        pushTokens: [],
      },
    });
    syntheaIdToUserId[id] = user.id;
    created++;
  }

  console.log(`[seed-from-synthea] Users: ${created} created, ${skipped} already existed.`);

  if (!fs.existsSync(observationsPath)) {
    console.log('[seed-from-synthea] No observations.csv found; skipping biometrics.');
    console.log('[seed-from-synthea] Done. Login with e.g. synthea_<First>_<Last>_<id>@synthea.ahava.test and the configured password.');
    return;
  }

  const { headers: oHdr, rows: obsRows } = readCSV(observationsPath);
  const obs = obsRows.map((r) => rowToObject(oHdr, r));

  // Group observations by (Patient, Date as day) and map LOINC Code -> value
  type DayKey = string;
  const byPatientDay: Record<string, Record<DayKey, Record<string, number>>> = {};

  for (const o of obs) {
    const patientId = o.Patient || o['Patient'];
    const code = o.Code || o['Code'];
    const value = toNum(o.Value || o['Value']);
    const dateStr = o.Date || o['Date'];
    if (!patientId || !code || value == null || !dateStr) continue;
    if (!syntheaIdToUserId[patientId]) continue; // only for imported patients

    const field = LOINC_TO_FIELD[code];
    if (!field) continue;

    const day = dateStr.slice(0, 10); // YYYY-MM-DD
    const key = `${patientId}|${day}`;
    if (!byPatientDay[key]) byPatientDay[key] = {};
    byPatientDay[key][field] = value;
  }

  // One BiometricReading per (patient, day) with at least one vital
  let readingsCreated = 0;
  for (const [key, fields] of Object.entries(byPatientDay)) {
    const [syntheaPatientId, day] = key.split('|');
    const userId = syntheaIdToUserId[syntheaPatientId];
    if (!userId || Object.keys(fields).length === 0) continue;

    const hr = fields.heartRate ?? fields.heartRateResting;
    await prisma.biometricReading.create({
      data: {
        userId,
        ...(hr != null && { heartRate: hr, heartRateResting: hr }),
        ...(fields.bloodPressureSystolic != null && { bloodPressureSystolic: fields.bloodPressureSystolic }),
        ...(fields.bloodPressureDiastolic != null && { bloodPressureDiastolic: fields.bloodPressureDiastolic }),
        ...(fields.temperature != null && { temperature: fields.temperature }),
        ...(fields.oxygenSaturation != null && { oxygenSaturation: fields.oxygenSaturation }),
        ...(fields.respiratoryRate != null && { respiratoryRate: fields.respiratoryRate }),
        ...(fields.weight != null && { weight: fields.weight }),
        ...(fields.height != null && { height: fields.height }),
        source: 'manual',
        deviceType: 'synthea_import',
        createdAt: new Date(day + 'T12:00:00.000Z'),
      },
    });
    readingsCreated++;
  }

  console.log(`[seed-from-synthea] Biometric readings created: ${readingsCreated}.`);
  console.log('[seed-from-synthea] Done. Login with synthea_<First>_<Last>_<id>@synthea.ahava.test and the configured password.');
}

main()
  .catch((e: unknown) => {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'PrismaClientInitializationError' || (typeof err?.message === 'string' && err.message.includes("Can't reach database server"))) {
      console.error('[seed-from-synthea] Database is not reachable.');
      console.error('  Your DATABASE_URL points to:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || '(not set)');
      console.error('  Ensure the database server is running and reachable (e.g. local PostgreSQL, or VPN/network access to Railway).');
      console.error('  For local dev: install PostgreSQL and set DATABASE_URL in apps/backend/.env');
    } else {
      console.error(e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
