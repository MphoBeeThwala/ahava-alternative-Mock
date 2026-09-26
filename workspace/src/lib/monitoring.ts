/**
 * Error tracking (Sentry) options shared by the browser, Node and edge
 * runtimes. Off unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
 *
 * Patient, nurse and doctor pages render clinical data. No session replay, no
 * tracing, and every category of collected data is disabled; scrubEvent
 * strips anything that still slips through. What reaches Sentry is the error,
 * its stack, the route path, and the browser — enough to find the bug.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

const SAFE_HEADERS = new Set(["user-agent", "content-type", "x-request-id"]);

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0].split("#")[0];
    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([k]) => SAFE_HEADERS.has(k.toLowerCase())),
      );
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      category: b.category,
      level: b.level,
      timestamp: b.timestamp,
      type: b.type,
    }));
  }
  delete event.extra;
  for (const ex of event.exception?.values ?? []) {
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}

export function sentryOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: Boolean(SENTRY_DSN),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [...SAFE_HEADERS] }, response: false },
      httpBodies: [] as never[],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b: Breadcrumb) => (b.category === "console" ? null : b),
  };
}
