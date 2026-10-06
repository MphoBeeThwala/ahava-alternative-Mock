/**
 * Read-only database login for the offline research tooling
 * (apps/ml-service/research, docs/RESEARCH_DATA_PIPELINE.md).
 *
 * Whoever trains and evaluates models needs the pseudonymised research tables
 * and nothing else: not users, not triage notes, not messages, not the consent
 * table (which links people to their consent history), and no ability to write
 * or change anything. Run with the OWNER connection string:
 *
 *   RESEARCH_DB_PASSWORD=... pnpm --filter backend research-db-role           # create/update + verify
 *   pnpm --filter backend research-db-role --verify-only                      # re-check an existing role
 *   pnpm --filter backend research-db-role --drop                             # retire the login
 *
 * Then give the data scientist RESEARCH_DATABASE_URL = the owner URL with this
 * role's username and password. Same shape and guarantees as ml-db-role.ts.
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const connect = (url: string) => new PrismaClient({ datasources: { db: { url } } });

export const DEFAULT_RESEARCH_ROLE = 'ahava_research';
const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{2,62}$/;
export const RESEARCH_TABLES = ['research_snapshots', 'research_outcomes', 'research_predictions'] as const;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function provisionResearchRole(ownerUrl: string, roleName: string, password: string): Promise<void> {
  if (!ROLE_NAME_RE.test(roleName)) throw new Error(`Invalid role name "${roleName}"`);
  const db = connect(ownerUrl);
  try {
    await db.$transaction(async (tx) => {
      const role = ident(roleName);
      const exists = await tx.$queryRawUnsafe<unknown[]>('SELECT 1 FROM pg_roles WHERE rolname = $1', roleName);
      const [{ sql }] = await tx.$queryRawUnsafe<Array<{ sql: string }>>(
        'SELECT format($1, $2::text) AS sql',
        exists.length
          ? `ALTER ROLE ${role} WITH LOGIN PASSWORD %L`
          : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L`,
        password,
      );
      await tx.$executeRawUnsafe(sql);

      const [{ name }] = await tx.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name');
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${ident(name)} TO ${role}`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      // Start from nothing everywhere this role could plausibly be granted
      // something by default, then give SELECT on exactly the research tables.
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
      for (const t of RESEARCH_TABLES) await tx.$executeRawUnsafe(`GRANT SELECT ON ${ident(t)} TO ${role}`);
    });
  } finally {
    await db.$disconnect();
  }
}

export async function dropResearchRole(ownerUrl: string, roleName: string): Promise<void> {
  if (!ROLE_NAME_RE.test(roleName)) throw new Error(`Invalid role name "${roleName}"`);
  const db = connect(ownerUrl);
  try {
    const exists = await db.$queryRawUnsafe<unknown[]>('SELECT 1 FROM pg_roles WHERE rolname = $1', roleName);
    if (!exists.length) return;
    const role = ident(roleName);
    const [{ name }] = await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name');
    await db.$transaction([
      db.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`),
      db.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${role}`),
      db.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${ident(name)} FROM ${role}`),
      db.$executeRawUnsafe(`DROP ROLE ${role}`),
    ]);
  } finally {
    await db.$disconnect();
  }
}

class RollbackProbe extends Error {}

/** Connects AS the research role and checks it can read the research tables and nothing more. */
export async function verifyResearchRole(url: string): Promise<{ ok: boolean; checks: Array<{ check: string; ok: boolean }> }> {
  const db = connect(url);
  const checks: Array<{ check: string; ok: boolean }> = [];
  try {
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
      for (const t of RESEARCH_TABLES) await expect(`read ${t}`, `SELECT count(*)::int AS n FROM ${ident(t)}`, true);
      await expect('no writes: insert', `INSERT INTO research_outcomes ("id","subjectKey","sourceRef","outcomeType","outcomeDay","source","consentVersion") VALUES ('__probe__','x','x','DEATH',now(),'CLINICIAN_ENTRY','1.0') RETURNING id`, false);
      await expect('no writes: update', `UPDATE research_snapshots SET "ageBand" = "ageBand" WHERE id = '__none__' RETURNING id`, false);
      await expect('no writes: delete', `DELETE FROM research_outcomes WHERE id = '__none__' RETURNING id`, false);
      await expect('no users', 'SELECT id FROM users LIMIT 1', false);
      await expect('no consent table (it links people to their choices)', 'SELECT "userId" FROM patient_consents LIMIT 1', false);
      await expect('no triage cases', 'SELECT symptoms FROM triage_cases LIMIT 1', false);
      await expect('no biometric_readings (identified vitals)', 'SELECT id FROM biometric_readings LIMIT 1', false);
      await expect('no biometric_time_series', 'SELECT user_id FROM biometric_time_series LIMIT 1', false);
      await expect('no messages', 'SELECT content FROM messages LIMIT 1', false);
      await expect('no audit log', 'SELECT id FROM audit_logs LIMIT 1', false);
      await expect('no DDL', 'CREATE TABLE research_probe_should_fail (a int)', false);
      throw new RollbackProbe();
    }).catch((err) => { if (!(err instanceof RollbackProbe)) throw err; });
  } finally {
    await db.$disconnect();
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

async function main() {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('Set DATABASE_URL to the database OWNER connection string.');
  const roleName = process.env.RESEARCH_DB_ROLE || DEFAULT_RESEARCH_ROLE;
  const verifyOnly = process.argv.includes('--verify-only');
  if (process.argv.includes('--drop')) {
    await dropResearchRole(ownerUrl, roleName);
    console.log(`Role "${roleName}" revoked and dropped.`);
    return;
  }
  let password = process.env.RESEARCH_DB_PASSWORD;
  const generated = !password;
  if (!password) {
    if (verifyOnly) throw new Error('--verify-only needs RESEARCH_DB_PASSWORD.');
    password = crypto.randomBytes(24).toString('base64url');
  }
  if (!verifyOnly) {
    await provisionResearchRole(ownerUrl, roleName, password);
    console.log(`Role "${roleName}" is set up: SELECT on the research tables only.`);
  }
  const result = await verifyResearchRole(withCredentials(ownerUrl, roleName, password));
  for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check}`);
  if (!result.ok) {
    console.error('Verification failed: do not hand this login to anyone until it passes.');
    process.exit(1);
  }
  console.log(generated
    ? `\nGenerated password (shown once, store it now):\n  RESEARCH_DATABASE_URL = ${withCredentials(ownerUrl, roleName, password)}`
    : '\nSet RESEARCH_DATABASE_URL to the owner URL with this role’s username and password.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
