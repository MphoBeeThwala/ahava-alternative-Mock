/**
 * AH-07: stops and removes the embedded-postgres instance globalSetup.js
 * started, if any (CI-provided databases via DATABASE_URL are left alone —
 * this process didn't start that one).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BACKEND_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(BACKEND_ROOT, ".test-pgdata");
const META_FILE = path.join(DATA_DIR, "meta.json");

module.exports = async function globalTeardown() {
  if (!fs.existsSync(META_FILE)) return;

  // The instance globalSetup started lives in a different process from this
  // one, so a fresh EmbeddedPostgres object has no handle on it and its stop()
  // silently does nothing - which left the server and its connection processes
  // running after every run. Stop it through the pid Postgres itself records.
  const pidFile = path.join(DATA_DIR, "postmaster.pid");
  if (!fs.existsSync(pidFile)) return;
  const pid = parseInt(fs.readFileSync(pidFile, "utf8"), 10); // first line is the pid
  if (!Number.isInteger(pid) || pid <= 0) return;

  try {
    if (process.platform === "win32") {
      // /t also takes down the backend processes the server forked.
      execFileSync("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGINT");
    }
  } catch {
    // Already gone.
  }
  // Not deleting DATA_DIR here: on Windows the OS can hold its file handles
  // for a moment after the process exits, making an immediate rmSync flaky
  // (EPERM). globalSetup.js removes this directory at the start of every run.
};
