#!/usr/bin/env node
/**
 * Fails when an HTTP endpoint has no test that calls its path.
 *
 *   node scripts/check-route-coverage.cjs
 *
 * Backend: routes are read from apps/backend/src/index.ts (mount prefixes) and
 * each routes/*.ts file; a route is covered when some *.test.ts contains a URL
 * string that matches its path (template placeholders match one segment, a
 * leading placeholder such as `${base}/status` matches any prefix).
 * ML service: @app.get/post/put decorators in main.py against tests/*.py.
 *
 * This proves a test CALLS the endpoint, not that its assertions are good -
 * it exists so a new endpoint cannot ship with no test at all. Anything that
 * genuinely cannot be exercised goes in scripts/route-coverage-allowlist.json
 * with a reason; stale allowlist entries fail the check too.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_SRC = path.join(ROOT, "apps/backend/src");
const ML_DIR = path.join(ROOT, "apps/ml-service");
const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, "route-coverage-allowlist.json"), "utf8"));

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, pred, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, pred, out);
    else if (pred(full)) out.push(full);
  }
  return out;
};

const routeRegex = (routePath) =>
  new RegExp("^" + routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+") + "/?$");

/** Test URL literal -> regex. `${...}`/`{...}` is one segment; at the very start it is any prefix. */
function callRegex(literal, placeholder) {
  const bare = literal.split("?")[0];
  let rx = "";
  let i = 0;
  let first = true;
  while (i < bare.length) {
    const m = bare.slice(i).match(placeholder);
    if (m && m.index === 0) {
      rx += first ? ".*" : "[^/]+";
      i += m[0].length;
    } else {
      rx += bare[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
    first = false;
  }
  return { rx: new RegExp("^" + rx + "/?$"), literal: bare.replace(placeholderAll(placeholder), "x") };
}
const placeholderAll = (re) => new RegExp(re.source.replace(/^\^/, ""), "g");

function backendRoutes() {
  const index = read(path.join(BACKEND_SRC, "index.ts"));
  const imports = Object.fromEntries([...index.matchAll(/import (\w+) from "\.\/routes\/(\w+)"/g)].map((m) => [m[1], m[2]]));
  const routes = [];
  for (const m of index.matchAll(/app\.use\(\s*(?:`\$\{API_V1\}([^`]*)`|"([^"]*)")\s*,([^;]*?)(\w+Routes)\)/g)) {
    const prefix = m[1] !== undefined ? "/api/v1" + m[1] : m[2];
    const file = path.join(BACKEND_SRC, "routes", imports[m[4]] + ".ts");
    for (const r of read(file).matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)/g)) {
      routes.push({ id: `${r[1].toUpperCase()} ${(prefix + r[2]).replace(/\/$/, "") || "/"}`, path: (prefix + r[2]).replace(/(.)\/$/, "$1") });
    }
  }
  for (const r of index.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)/g)) {
    routes.push({ id: `${r[1].toUpperCase()} ${r[2]}`, path: r[2] });
  }
  return routes;
}

function backendCalls() {
  const calls = [];
  for (const f of walk(BACKEND_SRC, (p) => p.endsWith(".test.ts"))) {
    for (const m of read(f).matchAll(/(?:\.(get|post|put|patch|delete)\(\s*)?['"`]((?:\$\{[^}]*\}|\/)[^'"`\s]*)['"`]/g)) {
      if (m[2].includes("/")) calls.push({ ...callRegex(m[2], /^\$\{[^}]*\}/), verb: m[1] && m[1].toUpperCase() });
    }
  }
  return calls;
}

function mlRoutes() {
  const src = read(path.join(ML_DIR, "main.py"));
  return [...src.matchAll(/^@app\.(get|post|put|patch|delete)\(\s*["']([^"']*)/gm)].map((m) => ({
    id: `${m[1].toUpperCase()} ${m[2]}`,
    path: m[2].replace(/\{\w+\}/g, ":p"),
  }));
}

function mlCalls() {
  const calls = [];
  for (const f of walk(path.join(ML_DIR, "tests"), (p) => p.endsWith(".py"))) {
    for (const m of read(f).matchAll(/["'](?:f)?(\/[^"'\s]*)["']/g)) calls.push(callRegex(m[1], /^\{[^}]*\}/));
  }
  return calls;
}

function check(label, routes, calls) {
  const allowed = new Set(allowlist[label] ? Object.keys(allowlist[label]) : []);
  const uncovered = routes.filter(
    (r) =>
      !calls.some(
        (c) =>
          (!c.verb || r.id.startsWith(c.verb + " ")) &&
          (c.rx.test(r.path.replace(/:\w+/g, "x")) || routeRegex(r.path).test(c.literal)),
      ),
  );
  const missing = uncovered.filter((r) => !allowed.has(r.id));
  const stale = [...allowed].filter((id) => !uncovered.some((r) => r.id === id));
  console.log(`${label}: ${routes.length} routes, ${routes.length - uncovered.length} covered, ${uncovered.length - missing.length} allowlisted`);
  for (const r of missing) console.log(`  UNTESTED  ${r.id}`);
  for (const id of stale) console.log(`  STALE ALLOWLIST ENTRY (now covered or removed)  ${id}`);
  return missing.length + stale.length;
}

const problems = check("backend", backendRoutes(), backendCalls()) + check("ml-service", mlRoutes(), mlCalls());
if (problems) {
  console.error(`\n${problems} problem(s). Add a test for the endpoint, or list it with a reason in scripts/route-coverage-allowlist.json.`);
  process.exit(1);
}
console.log("Every endpoint has a test that calls it.");
