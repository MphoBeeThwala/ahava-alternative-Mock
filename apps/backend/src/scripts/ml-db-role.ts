/**
 * Least-privilege database login for the ML service (docs/ENGINEERING_PLAN.md
 * §39, docs/SECURITY_RUNBOOK.md §2).
 *
 * The ML service used to connect with the database owner's credentials,
 * i.e. with read/write access to every table: triage notes, messages,
 * prescriptions, passwords, audit logs. It needs exactly:
 *   - biometric_time_series: SELECT, INSERT (its own vitals history)
 *   - users: SELECT (id, "riskProfile"), UPDATE ("riskProfile")
 * and nothing else. Run with the OWNER connection string:
 *
 *   ML_DB_PASSWORD=... pnpm --filter backend ml-db-role            # create/update + verify
 *   pnpm --filter backend ml-db-role --verify-only                 # re-check an existing role
 *   pnpm --filter backend ml-db-role --drop                        # retire the login
 *
 * If ML_DB_PASSWORD is not set a strong one is generated and printed once.
 * Idempotent: re-running re-applies the grants (and the password, if given).
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });

export const DEFAULT_ML_ROLE = 'ahava_ml';

const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{2,62}$/;

// Same shape the ML service creates (apps/ml-service/db.py). Created here,
// by the owner, because the restricted role can't run DDL.
const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS biometric_time_series (
    time         TIMESTAMPTZ NOT NULL,
    user_id      TEXT        NOT NULL,
    hr_resting   DOUBLE PRECISION,
    hrv_rmssd    DOUBLE PRECISION,
    spo2         DOUBLE PRECISION,
    resp_rate    DOUBLE PRECISION,
    step_count   INTEGER,
    active_cals  DOUBLE PRECISION,
    sleep_hrs    DOUBLE PRECISION,
    skin_temp    DOUBLE PRECISION,
    ecg_rhythm   TEXT DEFAULT 'unknown',
    temp_trend   TEXT DEFAULT 'normal',
    alert_level  TEXT DEFAULT 'GREEN',
    anomalies    JSONB DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS bts_user_time_idx ON biometric_time_series (user_id, time DESC);`;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function provisionMlRole(ownerUrl: string, roleName: string, password: string): Promise<void> {
  if (!ROLE_NAME_RE.test(roleName)) throw new Error(`Invalid role name "${roleName}"`);
  const db = connect(ownerUrl);
  try {
    await db.$transaction(async (tx) => {
      for (const stmt of TABLE_SQL.split(';').map((x) => x.trim()).filter(Boolean)) await tx.$executeRawUnsafe(stmt);
      const timescale = await tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`);
      if (timescale.length) {
        await tx.$queryRawUnsafe(`SELECT create_hypertable('biometric_time_series', 'time', if_not_exists => TRUE, migrate_data => TRUE)`);
      }

      const role = ident(roleName);
      const exists = await tx.$queryRawUnsafe<unknown[]>('SELECT 1 FROM pg_roles WHERE rolname = $1', roleName);
      // The password is quoted server-side by format(%L), never concatenated here.
      const [{ sql }] = await tx.$queryRawUnsafe<Array<{ sql: string }>>(
        'SELECT format($1, $2::text) AS sql',
        // Attributes are fixed at creation; a re-run only changes the password
        // (Postgres won't let a non-superuser owner restate NOSUPERUSER).
        // verifyMlRole below still fails if the role can read more than it should.
        exists.length
          ? `ALTER ROLE ${role} WITH LOGIN PASSWORD %L`
          : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L`,
        password,
      );
      await tx.$executeRawUnsafe(sql);

      const [{ name }] = await tx.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name');
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${ident(name)} TO ${role}`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      // Start from nothing on the two tables, then grant exactly what's used.
      await tx.$executeRawUnsafe(`REVOKE ALL ON biometric_time_series FROM ${role}`);
      await tx.$executeRawUnsafe(`REVOKE ALL ON users FROM ${role}`);
      await tx.$executeRawUnsafe(`GRANT SELECT, INSERT ON biometric_time_series TO ${role}`);
      await tx.$executeRawUnsafe(`GRANT SELECT (id, "riskProfile"), UPDATE ("riskProfile") ON users TO ${role}`);
    });
  } finally {
    await db.$disconnect();
  }
}

/** Retire the ML login: revoke everything it was granted, then drop it. */
export async function dropMlRole(ownerUrl: string, roleName: string): Promise<void> {
  if (!ROLE_NAME_RE.test(roleName)) throw new Error(`Invalid role name "${roleName}"`);
  const db = connect(ownerUrl);
  try {
    const exists = await db.$queryRawUnsafe<unknown[]>('SELECT 1 FROM pg_roles WHERE rolname = $1', roleName);
    if (!exists.length) return;
    const role = ident(roleName);
    const [{ name }] = await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name');
    await db.$transaction([
      db.$executeRawUnsafe(`REVOKE ALL ON biometric_time_series FROM ${role}`),
      db.$executeRawUnsafe(`REVOKE ALL ON users FROM ${role}`),
      db.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${role}`),
      db.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${ident(name)} FROM ${role}`),
      db.$executeRawUnsafe(`DROP ROLE ${role}`),
    ]);
  } finally {
    await db.$disconnect();
  }
}

/** Connects AS the ML role and checks it can do its job and nothing more. */
export async function verifyMlRole(mlUrl: string): Promise<{ ok: boolean; checks: Array<{ check: string; ok: boolean }> }> {
  const db = connect(mlUrl);
  const checks: Array<{ check: string; ok: boolean }> = [];
  try {
    // Every probe runs inside a transaction that is rolled back at the end,
    // each behind a savepoint so one refusal doesn't abort the rest.
    await db.$transaction(async (tx) => {
      const expect = async (check: string, sql: string, shouldSucceed: boolean) => {
        await tx.$executeRawUnsafe('SAVEPOINT probe');
        try {
          await tx.$queryRawUnsafe(sql);
          checks.push({ check, ok: shouldSucceed });
        } catch {
          checks.push({ check, ok: !shouldSucceed });
        }
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT probe');
      };
      await expect('read biometric_time_series', 'SELECT count(*)::int AS n FROM biometric_time_series', true);
      await expect('insert biometric_time_series', `INSERT INTO biometric_time_series (time, user_id) VALUES (now(), '__ml_role_probe__') RETURNING user_id`, true);
      await expect('read users.riskProfile', 'SELECT id, "riskProfile" FROM users LIMIT 1', true);
      await expect('update users.riskProfile', `UPDATE users SET "riskProfile" = "riskProfile" WHERE id = '__none__' RETURNING id`, true);
      await expect('no users.email / passwordHash', 'SELECT email, "passwordHash" FROM users LIMIT 1', false);
      await expect('no triage notes', 'SELECT symptoms FROM triage_cases LIMIT 1', false);
      await expect('no messages', 'SELECT content FROM messages LIMIT 1', false);
      await expect('no biometric_readings', 'SELECT id FROM biometric_readings LIMIT 1', false);
      await expect('no audit log', 'SELECT id FROM audit_logs LIMIT 1', false);
      await expect('no deletes of vitals history', `DELETE FROM biometric_time_series WHERE user_id = '__none__' RETURNING user_id`, false);
      await expect('no DDL', 'CREATE TABLE ml_probe_should_fail (a int)', false);
      throw new RollbackProbe();
    }).catch((err) => { if (!(err instanceof RollbackProbe)) throw err; });
  } finally {
    await db.$disconnect();
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}

class RollbackProbe extends Error {}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

async function main() {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('Set DATABASE_URL to the database OWNER connection string.');
  const roleName = process.env.ML_DB_ROLE || DEFAULT_ML_ROLE;
  const verifyOnly = process.argv.includes('--verify-only');
  if (process.argv.includes('--drop')) {
    await dropMlRole(ownerUrl, roleName);
    console.log(`Role "${roleName}" revoked and dropped.`);
    return;
  }

  let password = process.env.ML_DB_PASSWORD;
  const generated = !password;
  if (!password) {
    if (verifyOnly) throw new Error('--verify-only needs ML_DB_PASSWORD (the ML role’s password).');
    password = crypto.randomBytes(24).toString('base64url');
  }

  if (!verifyOnly) {
    await provisionMlRole(ownerUrl, roleName, password);
    console.log(`Role "${roleName}" is set up with least-privilege grants.`);
  }
  const mlUrl = withCredentials(ownerUrl, roleName, password);
  const result = await verifyMlRole(mlUrl);
  for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check}`);
  if (!result.ok) {
    console.error('Verification failed — do not point the ML service at this role until it passes.');
    process.exit(1);
  }
  if (generated) {
    console.log('\nGenerated password (shown once — store it now, e.g. in Railway):');
    console.log(`  ML service DATABASE_URL = ${mlUrl}`);
  } else {
    console.log('\nSet the ML service DATABASE_URL to the owner URL with this role’s username and password.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
