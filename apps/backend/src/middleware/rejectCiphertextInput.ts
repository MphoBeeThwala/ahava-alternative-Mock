/**
 * Clients never send our ciphertext. Refuse any request body containing a
 * string shaped like a v2/v3 encrypted payload.
 *
 * Why: reads decrypt every ciphertext they meet. If a caller could store a
 * stolen ciphertext (from a leaked backup, say) in any field they control, the
 * API would hand it back decrypted. Webhook paths are exempt (vendor payloads,
 * signature-verified) and are scanned for nothing here.
 */
import { NextFunction, Request, Response } from "express";

const CIPHERTEXT = /^v[23]:[A-Za-z0-9+/=_-]+(?::[A-Za-z0-9+/=_-]+){3,4}$/;
const MAX_DEPTH = 8;
const MAX_NODES = 20_000;

function containsCiphertext(value: unknown, depth = 0, budget = { n: 0 }): boolean {
  if (++budget.n > MAX_NODES || depth > MAX_DEPTH) return false;
  if (typeof value === "string") return value.length < 100_000 && CIPHERTEXT.test(value.trim());
  if (Array.isArray(value)) return value.some((v) => containsCiphertext(v, depth + 1, budget));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => containsCiphertext(v, depth + 1, budget));
  }
  return false;
}

export function rejectCiphertextInput(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/webhooks") || req.path.includes("/payments/webhook")) return next();
  if (req.body && typeof req.body === "object" && containsCiphertext(req.body)) {
    return res.status(400).json({ error: "Invalid input", code: "CIPHERTEXT_NOT_ACCEPTED" });
  }
  return next();
}
