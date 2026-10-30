/**
 * Closed-beta gate for patient sign-up.
 *
 * Set BETA_INVITE_CODES to a comma-separated list of codes (one per tester or
 * cohort) and new patient accounts need one of them, by password sign-up or
 * Google. Remove a code from the list to revoke it; accounts already created
 * keep working. Unset or empty means sign-up is open, as before. Staff are
 * unaffected: they join by invite (services/staffInvites.ts).
 */
import crypto from 'crypto';

function configuredCodes(): string[] {
  return (process.env.BETA_INVITE_CODES ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

export function isBetaGateEnabled(): boolean {
  return configuredCodes().length > 0;
}

const digest = (s: string) => crypto.createHash('sha256').update(s.toLowerCase()).digest();

/** Case-insensitive, constant-time match against every configured code. */
export function isValidBetaCode(code: unknown): boolean {
  if (typeof code !== 'string' || !code.trim()) return false;
  const given = digest(code.trim());
  let ok = false;
  for (const c of configuredCodes()) {
    if (crypto.timingSafeEqual(given, digest(c))) ok = true;
  }
  return ok;
}
