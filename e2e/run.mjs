#!/usr/bin/env node
/**
 * End-to-end test runner: real Postgres, real API, real production Next.js
 * build, real Chromium. Nothing is mocked.
 *
 *   pnpm test:e2e
 *
 * 1. Database: uses DATABASE_URL if set (CI: a postgres service container);
 *    otherwise starts a disposable embedded Postgres, same as the backend
 *    integration suite.
 * 2. Applies the real migration history (`prisma migrate deploy`).
 * 3. Starts the API from source (tsx) and waits for /ready.
 * 4. Builds the frontend (skip with E2E_REUSE_BUILD=1) and runs `next start`
 *    against that API through the real /api proxy.
 * 5. Runs Playwright, then tears everything down.
 *
 * Env: E2E_CHROMIUM_PATH — use an already-installed Chromium instead of
 * Playwright's download (e.g. /opt/pw-browsers/chromium-NNNN/chrome-linux/chrome).
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(ROOT, "apps", "backend");
const FRONTEND = path.join(ROOT, "workspace");
const API_PORT = Number(process.env.E2E_API_PORT || 4100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3100);
const PG_PORT = 54339;

const children = [];
let pg = null;
let pgDir = null;

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

function start(name, cmd, args, opts) {
  const logFile = path.join(ROOT, "e2e", "test-results", `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "w");
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", out, out], detached: true });
  children.push({ name, child, logFile });
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !shuttingDown) log(`${name} exited with ${code} — see ${logFile}`);
  });
  return child;
}

async function waitFor(url, name, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become ready at ${url} within ${timeoutMs / 1000}s`);
}

let shuttingDown = false;
async function shutdown() {
  shuttingDown = true;
  for (const { child } of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (pg) {
    await pg.stop().catch(() => {});
    if (pgDir) fs.rmSync(pgDir, { recursive: true, force: true });
  }
}

// A leftover server from an earlier run would answer the readiness probes
// and the tests would silently run against it — refuse instead.
async function assertPortFree(port) {
  const net = await import("node:net");
  await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", () => reject(new Error(`port ${port} is already in use — stop whatever is listening there first`)));
    srv.listen(port, () => srv.close(resolve));
  });
}

async function main() {
  for (const port of [API_PORT, WEB_PORT]) await assertPortFree(port);
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const require = createRequire(path.join(BACKEND, "package.json"));
    const EmbeddedPostgres = require("embedded-postgres").default;
    // Under the OS temp dir, not the repo: when run as root, embedded-postgres
    // drops to the `postgres` user, which can't create directories in a
    // root-owned checkout.
    pgDir = fs.mkdtempSync(path.join(os.tmpdir(), "ahava-e2e-pg-"));
    fs.chmodSync(pgDir, 0o777);
    const dataDir = path.join(pgDir, "data");
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "ahava_e2e",
      password: "ahava_e2e",
      port: PG_PORT,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    log("starting disposable Postgres");
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("ahava_e2e");
    databaseUrl = `postgresql://ahava_e2e:ahava_e2e@localhost:${PG_PORT}/ahava_e2e`;
  }

  const apiEnv = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    DATABASE_URL: databaseUrl,
    POOLED_DATABASE_URL: databaseUrl,
    JWT_SECRET: "e2e-jwt-secret-that-is-at-least-32-characters",
    JWT_REFRESH_SECRET: "e2e-refresh-secret-that-is-at-least-32-chars",
    ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
    CORS_ORIGIN: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
    FRONTEND_URL: `http://localhost:${WEB_PORT}`,
    STAFF_REGISTRATION_SECRET: "e2e-staff-secret",
    // No Redis, no AI keys, no ML service: exercises the app's own fallbacks
    // (inline triage, deterministic opinion) — the paths a real outage of
    // those dependencies would hit.
    REDIS_URL: "",
    GEMINI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    SENTRY_DSN: "",
  };

  log("applying migrations");
  execSync("npx prisma migrate deploy --schema=prisma/schema.prisma", { cwd: BACKEND, env: apiEnv, stdio: "inherit" });

  log(`starting API on :${API_PORT}`);
  start("api", path.join(BACKEND, "node_modules", ".bin", "tsx"), ["src/index.ts"], { cwd: BACKEND, env: apiEnv });
  await waitFor(`http://127.0.0.1:${API_PORT}/ready`, "API");

  const webEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_OUTPUT_STANDALONE: "false",
    BACKEND_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_SENTRY_DSN: "",
  };
  if (process.env.E2E_REUSE_BUILD !== "1" || !fs.existsSync(path.join(FRONTEND, ".next", "BUILD_ID"))) {
    log("building frontend (set E2E_REUSE_BUILD=1 to skip on reruns)");
    execSync("pnpm build", { cwd: FRONTEND, env: webEnv, stdio: "inherit" });
  }
  log(`starting frontend on :${WEB_PORT}`);
  start("web", path.join(FRONTEND, "node_modules", ".bin", "next"), ["start", "-p", String(WEB_PORT)], {
    cwd: FRONTEND,
    env: webEnv,
  });
  await waitFor(`http://127.0.0.1:${WEB_PORT}/`, "frontend");

  log("running Playwright");
  const extraArgs = process.argv.slice(2);
  const code = await new Promise((resolve) => {
    const pw = spawn(
      path.join(ROOT, "node_modules", ".bin", "playwright"),
      ["test", "-c", path.join(ROOT, "e2e", "playwright.config.ts"), ...extraArgs],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_BASE_URL: `http://localhost:${WEB_PORT}`,
          E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
          E2E_STAFF_SECRET: apiEnv.STAFF_REGISTRATION_SECRET,
        },
      },
    );
    pw.on("exit", (c) => resolve(c ?? 1));
  });
  return code;
}

main()
  .then(async (code) => {
    await shutdown();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[e2e] ${err.message}`);
    for (const { name, logFile } of children) {
      console.error(`--- last lines of ${name} log (${logFile}) ---`);
      try {
        console.error(fs.readFileSync(logFile, "utf8").split("\n").slice(-30).join("\n"));
      } catch {
        /* no log */
      }
    }
    await shutdown();
    process.exit(1);
  });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await shutdown();
    process.exit(130);
  });
}
