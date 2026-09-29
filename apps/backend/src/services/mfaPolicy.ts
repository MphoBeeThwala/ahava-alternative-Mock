/**
 * Two-factor authentication is mandatory for staff accounts (nurses,
 * doctors, admins): every one of them can reach patient data or control who
 * can. Patients may turn it on, but aren't forced to.
 *
 * A staff account without 2FA can still sign in, but until it enrols the
 * session reaches only the enrolment endpoints below (middleware/auth.ts).
 * Staff can't switch 2FA off themselves; a lost authenticator is reset by a
 * different admin (POST /admin/users/:id/2fa/reset), which forces
 * re-enrolment. docs/ENGINEERING_PLAN.md §39.
 */
export const MFA_REQUIRED_ROLES = ['NURSE', 'DOCTOR', 'ADMIN'] as const;

export function isMfaRequired(role: string | undefined): boolean {
  // Integration tests that aren't about 2FA opt out, and only under
  // NODE_ENV=test — there is deliberately no production switch.
  if (process.env.NODE_ENV === 'test' && process.env.MFA_ENFORCEMENT_DISABLED_FOR_TESTS === 'true') return false;
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(role ?? '');
}

/** What an unenrolled staff session may call: who am I, enrol, sign out. */
const ENROLMENT_PATHS = [
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/2fa/setup',
  '/api/v1/auth/2fa/verify-setup',
];

export function isEnrolmentPath(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0].replace(/\/+$/, '');
  return ENROLMENT_PATHS.includes(path);
}

export const MFA_ENROLMENT_REQUIRED = {
  error: 'Two-factor authentication is required for your account. Set it up to continue.',
  code: 'MFA_ENROLLMENT_REQUIRED',
} as const;
