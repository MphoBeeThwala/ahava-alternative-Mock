/**
 * Single-use emailed tokens (password reset, email verification).
 *
 * Only a SHA-256 hash of the token is stored, so a database read, backup or
 * log leak doesn't yield working reset or verification links. The token is
 * 256 bits of randomness, so an unsalted fast hash is sufficient (same
 * approach as staff invites, services/staffInvites.ts).
 */
import crypto from 'crypto';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashOneTimeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** `token` goes in the email; only `tokenHash` is stored. */
export function newOneTimeToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashOneTimeToken(token) };
}
