/**
 * Error tracking (Sentry). Off unless SENTRY_DSN is set, so local dev, CI and
 * the integration suite never send anything anywhere.
 *
 * This is a health platform: an error event must never carry patient data.
 * Sentry's defaults would attach request bodies (symptom narratives, vitals),
 * cookies, auth headers, query strings, and console breadcrumbs (our own logs
 * sometimes include clinical context). All of that is stripped in
 * `scrubEvent` below — what reaches Sentry is the stack trace, route, method,
 * status, request id and an opaque user id/role, which is enough to find the
 * bug and correlate it with our own logs via requestId, and nothing more.
 */
import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

let enabled = false;

// Headers that are safe and useful for debugging. Everything else (notably
// Authorization, Cookie, X-Forwarded-For) is dropped.
const SAFE_HEADERS = new Set(["user-agent", "content-type", "x-request-id"]);

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([k]) =>
          SAFE_HEADERS.has(k.toLowerCase())
        )
      );
    }
  }
  if (event.user) {
    event.user = { id: event.user.id };
  }
  // Breadcrumbs can carry URLs with ids in query strings or log text; keep
  // only category/level/timestamp so the sequence of events is still visible.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      category: b.category,
      level: b.level,
      timestamp: b.timestamp,
      type: b.type,
    }));
  }
  delete event.extra;
  // Prisma error messages can quote the query's argument values (e.g. a
  // patient's name in a failed insert). Keep the error class and code only.
  for (const ex of event.exception?.values ?? []) {
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
    if (ex.type?.startsWith("PrismaClient")) {
      const code = ex.value?.match(/\bP\d{4}\b/)?.[0];
      ex.value = `${ex.type}${code ? ` ${code}` : ""} (message redacted)`;
    }
  }
  return event;
}

export function initMonitoring(service: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || enabled) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    serverName: service,
    // Sentry v11 collects almost everything by default — including local
    // variable values in stack frames, which in a triage handler means
    // symptoms and vitals. Every category is turned off explicitly;
    // scrubEvent is the second layer, not the only one.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [...SAFE_HEADERS] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // Errors only. Performance tracing is a separate decision (cost and a
    // second PHI surface via span data) — not turned on here.
    tracesSampleRate: 0,
    // Express auto-capture is dropped so middleware/errorHandler.ts is the
    // one capture point: it only reports 5xx and attaches request id/route/
    // role. Left on, the SDK captured every error first, untagged, and the
    // tagged capture was then discarded as a duplicate.
    integrations: (defaults) =>
      defaults.filter((i) => !["Console", "RequestData", "Express"].includes(i.name)),
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
  });
  enabled = true;
  console.log(`[monitoring] Sentry error tracking enabled for ${service}`);
}

export interface ErrorContext {
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  userId?: string;
  userRole?: string;
  /** Short, non-PHI label for where this happened, e.g. "triage.ml-service". */
  area?: string;
}

export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag("request_id", ctx.requestId);
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.method) scope.setTag("method", ctx.method);
    if (ctx.statusCode) scope.setTag("status_code", String(ctx.statusCode));
    if (ctx.userRole) scope.setTag("user_role", ctx.userRole);
    if (ctx.area) scope.setTag("area", ctx.area);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    Sentry.captureException(err);
  });
}

/** Flush pending events before the process exits (crash or shutdown). */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.flush(timeoutMs);
}
