/**
 * Cover for the CSRF guard. The "blocks" cases are the vulnerability that
 * existed before it was added; the "allows" cases are the ways legitimate
 * traffic reaches the API, each of which would be an outage if broken.
 */
import type { NextFunction, Request, Response } from "express";
import { originGuard } from "./originGuard";

const ALLOWED = ["https://app.ahava.test", "https://admin.ahava.test"];

function run(overrides: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
}) {
  const req = {
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/api/bookings",
    url: overrides.path ?? "/api/bookings",
    headers: overrides.headers ?? {},
  } as unknown as Request;

  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  const next = jest.fn() as unknown as NextFunction;
  originGuard(ALLOWED)(req, res as unknown as Response, next);

  return { next: next as unknown as jest.Mock, res };
}

describe("originGuard", () => {
  describe("blocks", () => {
    it("a cookie-authenticated write from an unknown origin", () => {
      const { next, res } = run({
        headers: { cookie: "ahava_access_token=x", origin: "https://evil.test" },
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    });

    it("a write whose origin arrives via the frontend proxy header", () => {
      const { next, res } = run({
        headers: {
          cookie: "ahava_access_token=x",
          "x-forwarded-origin": "https://evil.test",
        },
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it("a write with only a cross-site Referer", () => {
      const { next } = run({
        headers: {
          cookie: "ahava_access_token=x",
          referer: "https://evil.test/attack.html",
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("a DELETE as readily as a POST", () => {
      const { next } = run({
        method: "DELETE",
        headers: { cookie: "ahava_access_token=x", origin: "https://evil.test" },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("an origin that merely starts with an allowed one", () => {
      const { next } = run({
        headers: {
          cookie: "ahava_access_token=x",
          origin: "https://app.ahava.test.evil.test",
        },
      });

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("allows", () => {
    it("a write from an origin we serve", () => {
      const { next } = run({
        headers: { cookie: "ahava_access_token=x", origin: "https://app.ahava.test" },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a write proxied from an origin we serve", () => {
      const { next } = run({
        headers: {
          cookie: "ahava_access_token=x",
          "x-forwarded-origin": "https://app.ahava.test",
        },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a bearer-authenticated write, which a browser cannot forge", () => {
      const { next } = run({
        headers: { authorization: "Bearer abc", origin: "capacitor://localhost" },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a native client sending neither Origin nor Referer", () => {
      const { next } = run({ headers: { cookie: "ahava_access_token=x" } });

      expect(next).toHaveBeenCalled();
    });

    it("a signature-verified payment webhook at its original, unversioned path", () => {
      // AH-23: kept mounted here deliberately — PayFast's dashboard points
      // at this exact URL, outside this codebase's control.
      const { next } = run({
        path: "/api/payments/webhook",
        headers: { origin: "https://www.payfast.co.za" },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a signature-verified payment webhook at the versioned path", () => {
      const { next } = run({
        path: "/api/v1/payments/webhook",
        headers: { origin: "https://www.payfast.co.za" },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a Health Connect sync at the versioned path", () => {
      const { next } = run({
        path: "/api/v1/biometrics/health-connect",
        headers: {},
      });

      expect(next).toHaveBeenCalled();
    });

    it("a GET, which changes nothing", () => {
      const { next } = run({
        method: "GET",
        path: "/api/patient/dashboard",
        headers: { cookie: "ahava_access_token=x", origin: "https://evil.test" },
      });

      expect(next).toHaveBeenCalled();
    });

    it("a CORS preflight", () => {
      const { next } = run({
        method: "OPTIONS",
        headers: { origin: "https://evil.test" },
      });

      expect(next).toHaveBeenCalled();
    });
  });
});
