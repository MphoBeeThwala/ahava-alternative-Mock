import type { Request } from 'express';
import { hashValue, writeRequestAudit } from './clinicalAudit';

/**
 * Sign-in events in the audit log. Until 2026-09-29 sign-ins weren't
 * recorded at all — only what a session did afterwards — so misuse of a
 * leaked password couldn't be told apart from normal use without
 * reconstructing it from other activity (docs/SECURITY_RUNBOOK.md §0).
 * Unknown emails are stored hashed, never in clear.
 */
export type SignInEvent = 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_2FA_PENDING' | 'LOGIN_2FA_FAILED';

export async function auditSignIn(
  req: Request,
  event: SignInEvent,
  user: { id: string; role: string } | null,
  details: { email?: string; reason?: string; method?: string } = {},
): Promise<void> {
  await writeRequestAudit({
    userId: user?.id ?? null,
    userRole: user?.role ?? null,
    action: event,
    resource: 'Auth',
    resourceId: user?.id ?? null,
    metadata: {
      ...(details.reason ? { reason: details.reason } : {}),
      ...(details.method ? { method: details.method } : {}),
      ...(!user && details.email ? { emailHash: hashValue(details.email.toLowerCase()) } : {}),
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });
}
