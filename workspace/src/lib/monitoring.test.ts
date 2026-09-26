import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent, sentryOptions } from "./monitoring";

describe("frontend error tracking never ships patient data", () => {
  it("strips request data, query/hash, cookies, auth headers, user details, extra, breadcrumbs, frame vars", () => {
    const out = scrubEvent({
      type: undefined,
      request: {
        url: "https://app/patient/vitals?name=Jane#spo2=91",
        data: { symptoms: "chest pain" },
        cookies: { sid: "x" },
        query_string: "name=Jane",
        headers: { Authorization: "Bearer t", "User-Agent": "ua" },
      },
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      extra: { form: { idNumber: "8001015009087" } },
      breadcrumbs: [{ category: "ui.input", level: "info", message: "Jane", timestamp: 1, data: { v: "91" } }],
      exception: { values: [{ type: "TypeError", stacktrace: { frames: [{ function: "f", vars: { spo2: 91 } }] } }] },
    } as ErrorEvent);
    expect(out.request).toEqual({ url: "https://app/patient/vitals", headers: { "User-Agent": "ua" } });
    expect(out.user).toEqual({ id: "u1" });
    expect(out.extra).toBeUndefined();
    expect(out.breadcrumbs).toEqual([{ category: "ui.input", level: "info", timestamp: 1, type: undefined }]);
    const s = JSON.stringify(out);
    for (const n of ["Jane", "chest pain", "8001015009087", "Bearer", "1.2.3.4", "spo2"]) expect(s).not.toContain(n);
  });

  it("has replay and tracing off, and is disabled without a DSN", () => {
    const o = sentryOptions();
    expect(o.replaysSessionSampleRate).toBe(0);
    expect(o.replaysOnErrorSampleRate).toBe(0);
    expect(o.tracesSampleRate).toBe(0);
    expect(o.dataCollection.stackFrameVariables).toBe(false);
    expect(o.enabled).toBe(false);
  });
});
