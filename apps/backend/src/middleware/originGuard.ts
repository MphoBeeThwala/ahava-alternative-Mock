/**
 * Cross-site request forgery defence for cookie-authenticated requests.
 *
 * Auth tokens are set as httpOnly cookies, and the frontend and API are served
 * from different domains - which forces SameSite=None for the cookies to be
 * sent at all. With no CSRF defence, that leaves every state-changing endpoint
 * reachable from any page the patient happens to have open: booking, cancelling,
 * submitting triage, changing a profile.
 *
 * This guard rejects state-changing requests whose Origin is not one we serve.
 * Browsers set Origin on every cross-site POST/PUT/PATCH/DELETE and will not
 * let a page forge it, so it is a reliable signal and - unlike a double-submit
 * token - needs no change on the client.
 *
 * Two deliberate exemptions:
 *
 *   1. Requests carrying `Authorization: Bearer`. A token in a header cannot be
 *      attached by the browser automatically, so those requests are not
 *      forgeable in the first place. This is what keeps native and Capacitor
 *      clients working, since they send no Origin.
 *
 *   2. Webhook paths. These are server-to-server callbacks that present no
 *      Origin and are authenticated by signature instead.
 *
 * A double-submit token remains worth adding later for defence in depth; it is
 * tracked as AH-03b in docs/ENGINEERING_PLAN.md.
 */
import { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Signature-verified server-to-server callbacks: no Origin, not forgeable.
 *
 * AH-23: /api/payments/webhook is listed at both its original path (still
 * mounted there — see index.ts, PayFast's dashboard points at it directly)
 * and the new /api/v1 one, so either keeps working regardless of which the
 * ITN is actually configured against. /api/terra/webhook and
 * /api/rook/webhook never corresponded to real routes — Terra/ROOK webhooks
 * only ever arrive at /webhooks/terra and /webhooks/rook (already covered
 * by the /webhooks prefix below) — removed rather than carried forward
 * versioned, since they exempted nothing.
 */
const EXEMPT_PATH_PREFIXES = [
  "/webhooks",
  "/api/payments/webhook",
  "/api/v1/payments/webhook",
  "/api/v1/biometrics/health-connect",
];

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

export function originGuard(allowedOrigins: string[]) {
  const allowed = new Set(
    allowedOrigins
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin)),
  );

  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const path = req.path || req.url || "";
    if (EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    // Bearer-authenticated requests cannot be forged by a browser.
    if (req.headers.authorization) return next();

    // Only cookie-authenticated requests are at risk. Anything with no session
    // cookie will be rejected by authMiddleware on its own merits.
    if (!req.headers.cookie) return next();

    // The Next.js proxy calls this API server-side and forwards the browser's
    // origin as X-Forwarded-Origin, because passing the raw Origin through
    // would confuse the CORS layer. Prefer it when present.
    const forwarded = req.headers["x-forwarded-origin"];
    const rawOrigin =
      (typeof forwarded === "string" ? forwarded : undefined) ??
      (typeof req.headers.origin === "string" ? req.headers.origin : undefined);

    const origin =
      rawOrigin && rawOrigin !== "null" ? normalizeOrigin(rawOrigin) : null;

    if (origin) {
      // A browser sets Origin on every cross-site write and a page cannot
      // forge it, so this is the decisive check.
      if (allowed.has(origin)) return next();
      return reject(res);
    }

    // No origin to judge by. Fall back to Referer when the browser sent one.
    const referer = req.headers.referer;
    const refererOrigin =
      typeof referer === "string" ? normalizeOrigin(referer) : null;
    if (refererOrigin) {
      if (allowed.has(refererOrigin)) return next();
      return reject(res);
    }

    // Neither header present. This is not a cross-site browser write - every
    // current browser sends Origin on cross-origin POST, including form posts -
    // so it is a native client, a health probe, or a server-to-server call.
    // Allowing it here keeps those working; they still face authMiddleware.
    return next();
  };
}

function reject(res: Response) {
  return res.status(403).json({
    error: "Cross-site request blocked",
    code: "CSRF_ORIGIN_REJECTED",
  });
}
