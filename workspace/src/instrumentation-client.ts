// Browser error tracking. No-op unless NEXT_PUBLIC_SENTRY_DSN is set at build.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, sentryOptions } from "./lib/monitoring";

if (SENTRY_DSN) {
  Sentry.init({
    ...sentryOptions(),
    // Replay would record screens full of patient data — never enabled.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Replay"),
  });
}
