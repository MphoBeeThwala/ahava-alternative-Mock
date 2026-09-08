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
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { encryptData, decryptData } from "../utils/encryption";

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

export function encryptTotpSecret(secret: string): string {
  return encryptData(secret);
}

export function decryptTotpSecret(encryptedSecret: string): string {
  return decryptData(encryptedSecret);
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
