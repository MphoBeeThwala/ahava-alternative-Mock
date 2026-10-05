/**
 * Step-up re-authentication for sensitive account changes (e.g. changing the
 * sign-in email). A stolen or left-open session alone must not be enough:
 * the caller has to prove the current password and, when the account has
 * two-factor authentication on, a current TOTP or unused backup code.
 */
import * as bcrypt from '@node-rs/bcrypt';
import prisma from '../lib/prisma';
import { consumeBackupCode, decryptTotpSecret, verifyTotpCode } from './totp';

export type ReauthResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; error: string; code: 'REAUTH_REQUIRED' | 'REAUTH_CODE_REQUIRED' | 'REAUTH_FAILED' };

export async function verifyReauthentication(
  userId: string,
  input: { currentPassword?: string; code?: string },
): Promise<ReauthResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, totpEnabled: true, totpSecret: true, totpBackupCodes: true },
  });
  if (!user || !user.passwordHash) {
    return { ok: false, status: 403, code: 'REAUTH_FAILED', error: 'Password sign-in isn’t set up for this account' };
  }
  if (!input.currentPassword) {
    return { ok: false, status: 403, code: 'REAUTH_REQUIRED', error: 'Enter your current password to change your email address.' };
  }
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    return { ok: false, status: 401, code: 'REAUTH_FAILED', error: 'Current password is incorrect' };
  }

  if (user.totpEnabled && user.totpSecret) {
    if (!input.code) {
      return { ok: false, status: 403, code: 'REAUTH_CODE_REQUIRED', error: 'Enter a code from your authenticator app to change your email address.' };
    }
    const validTotp = verifyTotpCode(decryptTotpSecret(user.totpSecret, user.id), input.code);
    if (!validTotp) {
      const backup = await consumeBackupCode(input.code, user.totpBackupCodes);
      if (!backup.matched) {
        return { ok: false, status: 401, code: 'REAUTH_FAILED', error: 'Invalid code' };
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpBackupCodes: backup.remaining } });
    }
  }
  return { ok: true };
}
