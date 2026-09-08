/**
 * AH-07: stops and removes the embedded-postgres instance globalSetup.js
 * started, if any (CI-provided databases via DATABASE_URL are left alone —
 * this process didn't start that one).
 */
const fs = require("fs");
const path = require("path");

const BACKEND_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(BACKEND_ROOT, ".test-pgdata");
const META_FILE = path.join(DATA_DIR, "meta.json");

module.exports = async function globalTeardown() {
  if (!fs.existsSync(META_FILE)) return;

  const { port, user, password } = JSON.parse(fs.readFileSync(META_FILE, "utf8"));

  const EmbeddedPostgres = require("embedded-postgres").default;
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user,
    password,
    port,
    persistent: false,
  });

  await pg.stop().catch(() => {});
  // Not deleting DATA_DIR here: on Windows, pg_ctl stop can return before
  // the OS fully releases its file handles, making an immediate rmSync
  // flaky (EPERM). globalSetup.js already removes this directory at the
  // start of every run, by which point the previous process has long since
  // let go of it.
};
