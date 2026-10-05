/**
 * Session lifetimes by role.
 *
 * Staff (nurses, doctors, admins) can reach patient data or control who can,
 * so their sessions are held to a tighter leash than a patient's:
 *
 *  - short access tokens (STAFF_ACCESS_TOKEN_MINUTES, default 5), so a
 *    deactivation, role change or stolen cookie bites quickly;
 *  - an idle timeout (STAFF_SESSION_IDLE_MINUTES, default 15): a session
 *    can only be refreshed if its latest refresh token is no older than
 *    that. A staff member who walks away comes back to a sign-in page;
 *  - an absolute lifetime (STAFF_SESSION_MAX_HOURS, default 12, about a
 *    shift): however active, they sign in again with 2FA after that.
 *
 * Patients keep the long-lived session (15 minute access token, 7 day
 * refresh) because their account only reaches their own record.
 *
 * Idle time is measured at refresh, from the refresh token's issue time.
 * With a 5 minute access token an active user refreshes every ~5 minutes, so
 * the effective idle limit lands between 10 and 15 minutes. That avoids a
 * database write on every request just to track "last seen".
 */
import { MFA_REQUIRED_ROLES } from './mfaPolicy';

const envInt = (name: string, fallback: number, min: number): number => {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

export function isStaffRole(role: string | undefined): boolean {
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(role ?? '');
}

export const staffAccessTokenSeconds = () => envInt('STAFF_ACCESS_TOKEN_MINUTES', 5, 1) * 60;
export const staffIdleSeconds = () => envInt('STAFF_SESSION_IDLE_MINUTES', 15, 1) * 60;
export const staffMaxSessionSeconds = () => envInt('STAFF_SESSION_MAX_HOURS', 12, 1) * 3600;

/** Access-token lifetime for a role, given the general (patient) default. */
export function accessTokenSecondsFor(role: string | undefined, defaultSeconds: number): number {
  return isStaffRole(role) ? Math.min(defaultSeconds, staffAccessTokenSeconds()) : defaultSeconds;
}

export type SessionRefusal = 'SESSION_IDLE_TIMEOUT' | 'SESSION_MAX_AGE';

/**
 * Whether a refresh may proceed. `issuedAt` and `authTime` are epoch seconds
 * from the refresh token; an old token with no `authTime` is treated as
 * having started when it was issued (the stricter reading).
 */
export function refreshRefusal(
  role: string | undefined,
  issuedAt: number | undefined,
  authTime: number | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionRefusal | null {
  if (!isStaffRole(role)) return null;
  const issued = issuedAt ?? nowSeconds;
  if (nowSeconds - issued > staffIdleSeconds()) return 'SESSION_IDLE_TIMEOUT';
  if (nowSeconds - (authTime ?? issued) > staffMaxSessionSeconds()) return 'SESSION_MAX_AGE';
  return null;
}
