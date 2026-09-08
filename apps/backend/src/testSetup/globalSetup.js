/**
 * AH-07: global setup for integration tests (jest.integration.config.js).
 *
 * If DATABASE_URL is already set (CI already runs a real `postgres:16`
 * service container for the migrations job — see .github/workflows/ci.yml),
 * that database is used as-is and nothing here starts anything.
 *
 * Otherwise (local runs), spins up a real, disposable PostgreSQL via
 * embedded-postgres — a genuine `pg_ctl`-managed instance, not a mock or a
 * different database engine standing in for one — and applies the real
 * migration history against it with `prisma migrate deploy`, the same
 * command CI's own migration-drift check uses.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKEND_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(BACKEND_ROOT, ".test-pgdata");
const PORT = 54329;
const DB_NAME = "ahava_test";
const DB_USER = "ahava_test";
const DB_PASSWORD = "ahava_test";

function ensureAppSecrets() {
  // Real (if disposable) secrets the app requires at request time — not
  // read at module-import time, but needed the moment a test hits a route
  // that touches auth or encryption.
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "integration-test-jwt-secret-32-chars-minimum";
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    require("crypto").randomBytes(32).toString("base64");
  process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
  process.env.NODE_ENV = "test";
}

module.exports = async function globalSetup() {
  ensureAppSecrets();

  if (process.env.DATABASE_URL) {
    process.env.POOLED_DATABASE_URL =
      process.env.POOLED_DATABASE_URL || process.env.DATABASE_URL;
    return;
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const EmbeddedPostgres = require("embedded-postgres").default;
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: DB_USER,
    password: DB_PASSWORD,
    port: PORT,
    persistent: false,
    // Windows' default locale (WIN1252) can't represent characters some
    // migration files use in comments (box-drawing "─" separators) —
    // force UTF8 the way every real deployment (Docker's postgres:16 image,
    // Railway/CI) already gets by default.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  const databaseUrl = `postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.POOLED_DATABASE_URL = databaseUrl;

  execSync("npx prisma migrate deploy --schema=prisma/schema.prisma", {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, POOLED_DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  // globalTeardown runs in a way that isn't guaranteed to share in-memory
  // state with this function, so hand off what it needs to actually stop
  // the right instance via a file instead of a module-level variable.
  fs.writeFileSync(
    path.join(DATA_DIR, "meta.json"),
    JSON.stringify({ port: PORT, user: DB_USER, password: DB_PASSWORD }),
  );
};
