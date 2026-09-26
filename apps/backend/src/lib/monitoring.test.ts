import type { ErrorEvent } from "@sentry/node";
import { scrubEvent } from "./monitoring";

describe("scrubEvent — no patient data leaves for error tracking", () => {
  const event = (): ErrorEvent =>
    ({
      type: undefined,
      request: {
        url: "https://api.example/api/v1/triage?patientName=Jane",
        method: "POST",
        data: { symptoms: "chest pain radiating to left arm", spo2: 91 },
        cookies: { session: "abc" },
        query_string: "patientName=Jane",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=abc",
          "X-Forwarded-For": "41.1.2.3",
          "User-Agent": "Mozilla/5.0",
          "X-Request-Id": "req-1",
        },
      },
      user: { id: "u1", email: "jane@example.com", ip_address: "41.1.2.3" },
      extra: { body: { idNumber: "8001015009087" } },
      breadcrumbs: [
        { category: "console", level: "info", message: "triage for Jane Doe", timestamp: 1, data: { x: 1 } },
      ],
      exception: {
        values: [
          { type: "PrismaClientKnownRequestError", value: "Unique constraint failed P2002 on value 'jane@example.com'" },
          {
            type: "TypeError",
            value: "Cannot read properties of undefined",
            stacktrace: { frames: [{ function: "scoreVitals", vars: { patient: "Jane Doe", spo2: 91 } }] },
          },
        ],
      },
    }) as ErrorEvent;

  it("strips bodies, cookies, query strings, auth/ip headers, and extra", () => {
    const e = scrubEvent(event());
    expect(e.request?.data).toBeUndefined();
    expect(e.request?.cookies).toBeUndefined();
    expect(e.request?.query_string).toBeUndefined();
    expect(e.request?.url).toBe("https://api.example/api/v1/triage");
    expect(e.request?.headers).toEqual({ "User-Agent": "Mozilla/5.0", "X-Request-Id": "req-1" });
    expect(e.extra).toBeUndefined();
  });

  it("keeps only an opaque user id", () => {
    expect(scrubEvent(event()).user).toEqual({ id: "u1" });
  });

  it("drops breadcrumb messages and data", () => {
    const [b] = scrubEvent(event()).breadcrumbs!;
    expect(b).toEqual({ category: "console", level: "info", timestamp: 1, type: undefined });
  });

  it("redacts Prisma error messages but keeps the code; leaves other errors alone", () => {
    const [prismaEx, typeEx] = scrubEvent(event()).exception!.values!;
    expect(prismaEx.value).toBe("PrismaClientKnownRequestError P2002 (message redacted)");
    expect(typeEx.value).toBe("Cannot read properties of undefined");
    expect(typeEx.stacktrace?.frames?.[0]).toEqual({ function: "scoreVitals" });
  });

  it("the serialized event contains none of the sensitive strings", () => {
    const s = JSON.stringify(scrubEvent(event()));
    for (const needle of ["chest pain", "Jane", "jane@example.com", "Bearer", "8001015009087", "41.1.2.3", "session"]) {
      expect(s).not.toContain(needle);
    }
  });
});
