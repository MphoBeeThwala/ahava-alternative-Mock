// Server-side (Node + edge) error tracking for the Next.js app, including the
// /api/[...path] proxy. No-op unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, sentryOptions } from "./lib/monitoring";

export async function register() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    ...sentryOptions(),
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "Console" && i.name !== "RequestData"),
  });
}

export const onRequestError = Sentry.captureRequestError;
