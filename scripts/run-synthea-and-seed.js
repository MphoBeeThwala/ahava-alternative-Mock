#!/usr/bin/env node
/**
 * Run Synthea (if JAR path set) then seed Ahava DB from Synthea CSV.
 *
 * Prerequisites:
 *   - Java 11+ on PATH (if using SYNTHEA_JAR).
 *   - Synthea JAR with CSV export: download from https://github.com/synthetichealth/synthea/releases
 *
 * Usage:
 *   node scripts/run-synthea-and-seed.js
 *   SYNTHEA_JAR=./synthea-with-dependencies.jar SYNTHEA_POPULATION=200 node scripts/run-synthea-and-seed.js
 *   SYNTHEA_CSV_PATH=./output/csv node scripts/run-synthea-and-seed.js   # seed only (no JAR run)
 *
 * Env (or set in repo root .env.synthea file):
 *   JAVA_HOME / SYNTHEA_JAVA  JDK root, or path to jmods folder, or .jmod file - script finds bin/java.exe.
 *   SYNTHEA_JAR               Path to synthea-with-dependencies.jar. If set, runs Synthea first with CSV export.
 *   SYNTHEA_POPULATION        Number of patients to generate (default: 100).
 *   SYNTHEA_CSV_PATH          CSV directory for seed step (default: ./output/csv if JAR was run, else ./synthea-output/csv).
 *   SYNTHEA_PASSWORD          Password for imported users (default: SyntheaPatient1!).
 *   SYNTHEA_MAX_PATIENTS      Max patients to import in seed (0 = all).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

// Load .env.synthea from repo root so JAVA_HOME/SYNTHEA_JAVA can be set without system env
const envSynthea = path.join(REPO_ROOT, '.env.synthea');
if (fs.existsSync(envSynthea)) {
  const content = fs.readFileSync(envSynthea, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(JAVA_HOME|SYNTHEA_JAVA|SYNTHEA_JAR|SYNTHEA_CSV_PATH|SYNTHEA_POPULATION)\s*=\s*(.+)/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const JAR = process.env.SYNTHEA_JAR;
const POPULATION = parseInt(process.env.SYNTHEA_POPULATION || '100', 10) || 100;
const CSV_PATH_ENV = process.env.SYNTHEA_CSV_PATH;

function run(cmd, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  console.log('[synthea]', cmd);
  execSync(cmd, { stdio: 'inherit', cwd, shell: true, ...opts });
}

/**
 * Resolve to the JDK root (directory that contains bin/java.exe).
 * Accepts: path to a .jmod file, path to jmods folder, or JDK root.
 */
function resolveJdkRoot(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return null;
  let dir = path.resolve(inputPath.trim());
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  const javaExeName = isWindows ? 'java.exe' : 'java';
  for (let i = 0; i < 5; i++) {
    const exe = path.join(dir, 'bin', javaExeName);
    if (fs.existsSync(exe)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve Java executable. Uses JAVA_HOME or SYNTHEA_JAVA (can be JDK root, jmods folder, or .jmod file path). */
function getJavaCommand() {
  const javaHome = process.env.JAVA_HOME || process.env.SYNTHEA_JAVA;
  if (javaHome) {
    const root = resolveJdkRoot(javaHome);
    if (root) {
      const exe = path.join(root, 'bin', isWindows ? 'java.exe' : 'java');
      if (fs.existsSync(exe)) return exe;
    }
    const exe = path.join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
    if (fs.existsSync(exe)) return exe;
  }
  if (isWindows) {
    try {
      const out = execSync('where java', { encoding: 'utf8', shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const first = out.split(/\r?\n/)[0]?.trim().replace(/^["']|["']$/g, '');
      if (first && fs.existsSync(first)) return first;
    } catch (e) {
      // ignore
    }
  }
  return 'java';
}

function isJavaAvailable() {
  const javaCmd = getJavaCommand();
  try {
    execSync(`"${javaCmd}" -version`, { stdio: 'pipe', shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

/** Return first directory that contains patients.csv, or null. */
function findExistingCsvPath(jarPath) {
  const candidates = [
    path.join(REPO_ROOT, 'synthea-output', 'csv'),
    path.join(REPO_ROOT, 'output', 'csv'),
  ];
  if (jarPath && fs.existsSync(jarPath)) {
    const jarDir = path.dirname(path.resolve(REPO_ROOT, jarPath));
    candidates.push(path.join(jarDir, 'output', 'csv'));
    candidates.push(path.join(jarDir, 'csv'));
  }
  if (isWindows && process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'synthea-output', 'csv'));
    candidates.push(path.join(process.env.USERPROFILE, 'output', 'csv'));
    candidates.push(path.join(process.env.USERPROFILE, 'Documents', 'synthea', 'output', 'csv'));
  }
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'patients.csv'))) return dir;
  }
  return null;
}

let csvPath = CSV_PATH_ENV;

if (JAR) {
  const jarPath = path.isAbsolute(JAR) ? JAR : path.join(REPO_ROOT, JAR);
  if (!fs.existsSync(jarPath)) {
    console.error('[synthea] JAR not found:', jarPath);
    console.error('Download from https://github.com/synthetichealth/synthea/releases (synthea-with-dependencies.jar)');
    process.exit(1);
  }
  if (!isJavaAvailable()) {
    console.warn('[synthea] Java is not on PATH. Skipping Synthea generation.');
    console.warn('[synthea] To generate data: install Java 11+ and add it to PATH, then run again.');
    console.warn('[synthea] To seed from existing CSV: set SYNTHEA_CSV_PATH to your output/csv folder and run again.');
    if (!CSV_PATH_ENV) {
      csvPath = path.join(REPO_ROOT, 'synthea-output', 'csv');
    }
  } else {
    const javaCmd = getJavaCommand();
    try {
      run(`"${javaCmd}" -jar "${jarPath}" --exporter.csv.export=true -p ${POPULATION}`, { cwd: REPO_ROOT });
    } catch (e) {
      console.error('[synthea] Synthea run failed. Try running manually: java -jar <jar> --exporter.csv.export=true -p', POPULATION);
      process.exit(1);
    }
    if (!csvPath) csvPath = path.join(REPO_ROOT, 'output', 'csv');
  }
}

if (!csvPath) csvPath = path.join(REPO_ROOT, 'synthea-output', 'csv');

csvPath = path.resolve(REPO_ROOT, csvPath);

if (!fs.existsSync(csvPath) || !fs.existsSync(path.join(csvPath, 'patients.csv'))) {
  const existing = findExistingCsvPath(JAR);
  if (existing) {
    console.log('[synthea] Using existing CSV at:', existing);
    csvPath = existing;
  } else {
    console.error('[synthea] CSV path missing or no patients.csv:', csvPath);
    console.error('Options: (1) Install Java 11+ and set JAVA_HOME or add to PATH, then run again. (2) Copy Synthea output/csv into repo synthea-output/csv. (3) Set SYNTHEA_CSV_PATH to a folder containing patients.csv.');
    process.exit(1);
  }
}

const env = { ...process.env, SYNTHEA_CSV_PATH: csvPath };
console.log('[synthea] Seeding from', csvPath);
run(`pnpm run seed:from-synthea`, { env });
