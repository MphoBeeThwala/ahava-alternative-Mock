/**
 * TOTP-based two-factor auth (opt-in, AH-29).
 *
 * A user's totpSecret is a login credential, not a setting — it is encrypted
 * at rest with the same AES-256-GCM helper used for PHI (utils/encryption.ts)
 * rather than stored in plaintext.
 *
 * Backup codes exist so losing the authenticator device doesn't lock a
 * clinician out of prescribing. Each is single-use and stored bcrypt-hashed,
 * the same way passwords are.
 */
import crypto from "crypto";
import * as bcrypt from "@node-rs/bcrypt";
import { authenticator } from "otplib";
import { encryptData, decryptData } from "../utils/encryption";
import prisma from "../lib/prisma";

const ISSUER = "Ahava Healthcare";
const BACKUP_CODE_COUNT = 10;

// otplib defaults to a 30s step and 6-digit codes (RFC 6238 defaults); a
// window of 1 tolerates the code rolling over mid-entry without materially
// widening the guessable window.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function getTotpProvisioningUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  try {
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

/**
 * Verify a TOTP code AND burn it. A code is valid for about 90 seconds
 * (window of 1), so without this a code that was shoulder-surfed, phished or
 * logged could be replayed — for example to open a step-up window on a stolen
 * session. The matched 30 s time step is stored; a code is accepted only if its
 * step is later than the last one used, and the write is atomic so two
 * simultaneous requests cannot both succeed with the same code.
 */
export async function verifyTotpCodeOnce(userId: string, secret: string, code: string): Promise<boolean> {
  const token = code.trim();
  if (!/^\d{6}$/.test(token)) return false;
  // Integration tests sign in and step up repeatedly within one 30 s step; they opt out,
  // and only under NODE_ENV=test. There is no production switch.
  if (process.env.NODE_ENV === "test" && process.env.TOTP_REPLAY_PROTECTION_DISABLED_FOR_TESTS === "true") {
    try { return authenticator.check(token, secret); } catch { return false; }
  }
  let delta: number | null;
  try {
    delta = authenticator.checkDelta(token, secret);
  } catch {
    return false;
  }
  if (delta === null || delta === undefined) return false;
  const step = Math.floor(Date.now() / 30_000) + delta;
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
    data: { totpLastUsedStep: step },
  });
  return count === 1;
}

// AH-13: AAD-bind the secret to the account it belongs to, so a totpSecret
// value copied to a different user's row (e.g. by a bug elsewhere, or a
// restored-from-backup row mismatch) fails to decrypt instead of silently
// authenticating against the wrong account's authenticator app.
function totpAAD(userId: string): string {
  return `user:${userId}:totpSecret`;
}

export function encryptTotpSecret(secret: string, userId: string): string {
  return encryptData(secret, totpAAD(userId));
}

export function decryptTotpSecret(encryptedSecret: string, userId: string): string {
  return decryptData(encryptedSecret, totpAAD(userId));
}

/** Ten single-use recovery codes, e.g. "A3F9-7K2Q". Returned once, plaintext. */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
  return Promise.all(codes.map((code) => bcrypt.hash(code, rounds)));
}

/**
 * Checks a submitted backup code against the stored hashes and, on a match,
 * returns the remaining hash list with that one removed (single use).
 */
export async function consumeBackupCode(
  submitted: string,
  hashedCodes: string[],
): Promise<{ matched: boolean; remaining: string[] }> {
  const normalized = submitted.trim().toUpperCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(normalized, hashedCodes[i])) {
      return {
        matched: true,
        remaining: [...hashedCodes.slice(0, i), ...hashedCodes.slice(i + 1)],
      };
    }
  }
  return { matched: false, remaining: hashedCodes };
}

/**
 * Persist the result of consuming a backup code, but only if the stored list is
 * still exactly what the code was checked against. Two requests carrying the
 * same backup code both match the list they read; only the first write finds it
 * unchanged, so a "single-use" code really is single-use. Returns false when it
 * lost that race (treat as an invalid code).
 */
export async function spendBackupCode(userId: string, original: string[], remaining: string[]): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpBackupCodes: { equals: original } },
    data: { totpBackupCodes: remaining },
  });
  return count === 1;
}
