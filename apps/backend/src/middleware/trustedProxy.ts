/**
 * Real client IP when the request comes through our own Next.js proxy.
 *
 * The browser talks to Next.js (/api/*), and Next.js calls this API server to
 * server. From here every user then looks like one IP (the Next.js server's),
 * so the per-IP rate limits and login lockouts were shared by everyone — which
 * is why they had to be raised so high that they stopped protecting anything.
 *
 * The proxy now passes the client's address in X-Ahava-Client-IP, together with
 * a shared secret (PROXY_SHARED_SECRET, set to the same value on both
 * services). The header is believed ONLY when the secret matches, compared in
 * constant time, so a caller hitting this API directly cannot choose its own
 * IP. With no secret configured this does nothing and req.ip is unchanged.
 */
import crypto from "crypto";
import net from "net";
import { NextFunction, Request, Response } from "express";

function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function trustedProxyClientIp(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.PROXY_SHARED_SECRET;
  if (expected && expected.length >= 16) {
    const secret = req.headers["x-ahava-proxy-secret"];
    const ip = req.headers["x-ahava-client-ip"];
    if (typeof secret === "string" && typeof ip === "string" && secretMatches(secret, expected) && net.isIP(ip.trim())) {
      Object.defineProperty(req, "ip", { value: ip.trim(), configurable: true });
    }
  }
  next();
}
