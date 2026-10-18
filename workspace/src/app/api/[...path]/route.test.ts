// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

const BACKEND = "http://backend.test";
const fetchMock = vi.fn();

function call(
  handler: typeof GET,
  path: string[],
  init: { method?: string; headers?: Record<string, string>; body?: string; search?: string } = {},
) {
  const url = `http://app.test/api/${path.join("/")}${init.search ?? ""}`;
  const req = new NextRequest(url, { method: init.method ?? "GET", headers: init.headers, body: init.body });
  return handler(req, { params: Promise.resolve({ path }) });
}

beforeEach(() => {
  process.env.BACKEND_URL = BACKEND;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BACKEND_URL;
});

describe("API proxy route", () => {
  it("forwards to the versioned backend URL, keeping the query string", async () => {
    const res = await call(GET, ["patient", "early-warning"], { search: "?days=7" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BACKEND}/api/v1/patient/early-warning?days=7`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("trims trailing slashes from BACKEND_URL", async () => {
    process.env.BACKEND_URL = `${BACKEND}///`;
    await call(GET, ["auth", "me"]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BACKEND}/api/v1/auth/me`);
  });

  it("encodes path segments", async () => {
    await call(GET, ["visits", "a b%c"]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BACKEND}/api/v1/visits/a%20b%25c`);
  });

  it.each([
    ["POST", POST], ["PUT", PUT], ["PATCH", PATCH], ["DELETE", DELETE],
  ] as const)("passes the method and body through on %s", async (method, handler) => {
    await call(handler, ["profile"], { method, body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe(method);
    expect(new TextDecoder().decode(init.body)).toBe('{"a":1}');
  });

  it("forwards only allow-listed headers and moves Origin to x-forwarded-origin", async () => {
    await call(POST, ["auth", "login"], {
      method: "POST",
      body: "{}",
      headers: {
        authorization: "Bearer t",
        cookie: "sid=1",
        "content-type": "application/json",
        "x-forwarded-for": "6.6.6.6",
        "x-real-ip": "6.6.6.6",
        "x-internal-admin": "yes",
        origin: "https://app.example",
      },
    });
    const sent: Headers = fetchMock.mock.calls[0][1].headers;
    expect(sent.get("authorization")).toBe("Bearer t");
    expect(sent.get("cookie")).toBe("sid=1");
    expect(sent.get("content-type")).toBe("application/json");
    expect(sent.get("x-forwarded-origin")).toBe("https://app.example");
    expect(sent.get("origin")).toBeNull();
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(sent.get("x-real-ip")).toBeNull();
    expect(sent.get("x-internal-admin")).toBeNull();
  });

  it("refuses path traversal and separators smuggled into a segment", async () => {
    for (const path of [["..", "admin"], [".", "x"], ["a/b"], ["a\\b"], [""]]) {
      const res = await call(GET, path);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes upstream status and body through, including errors, without stale length headers", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 403,
        headers: { "content-type": "application/json", "content-length": "999", "content-encoding": "gzip", "x-keep": "1" },
      }),
    );
    const res = await call(GET, ["admin", "users"]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "nope" });
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("x-keep")).toBe("1");
  });

  it("does not follow upstream redirects", async () => {
    await call(GET, ["auth", "google"]);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("answers 502 when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call(GET, ["patient", "x"]);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not reach/i);
  });

  it("answers 504 when the backend times out", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    const res = await call(GET, ["patient", "x"]);
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/too long/i);
  });
});
