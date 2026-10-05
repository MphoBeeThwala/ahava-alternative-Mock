/**
 * Step-up authentication: some actions are dangerous enough that a valid
 * session isn't proof enough, because a left-open laptop or a stolen cookie
 * has one. These routes need the user to have entered a fresh authenticator
 * code within STEP_UP_WINDOW_MINUTES (default 5), via POST /auth/2fa/step-up.
 *
 * Applied to: creating staff invites, reactivating accounts, verifying or
 * overriding clinical credentials, resetting someone's 2FA, granting a
 * clinician access to a patient, break-glass access, refunds, and the
 * trial-data reset.
 *
 * The check reads the database, not the cached user, so it can't be served
 * stale. An account with no 2FA can't pass it at all (staff are forced to
 * enrol by services/mfaPolicy.ts).
 */
import { NextFunction, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthenticatedRequest } from './auth';

export const stepUpWindowSeconds = (): number =>
  Math.max(60, parseInt(process.env.STEP_UP_WINDOW_MINUTES ?? '5', 10) * 60 || 300);

/** Test suites that aren't about step-up opt out, only under NODE_ENV=test. No production switch. */
const disabledForTests = () => process.env.NODE_ENV === 'test' && process.env.STEP_UP_DISABLED_FOR_TESTS === 'true';

export const STEP_UP_REQUIRED = {
  error: 'Confirm it’s you: enter a code from your authenticator app to continue.',
  code: 'STEP_UP_REQUIRED',
} as const;

export async function hasRecentStepUp(userId: string, now = new Date()): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stepUpVerifiedAt: true } });
  return !!user?.stepUpVerifiedAt && now.getTime() - user.stepUpVerifiedAt.getTime() <= stepUpWindowSeconds() * 1000;
}

export type StepUpDecision = { ok: true } | { ok: false; body: { error: string; code: string } };

/** Shared by the middleware and by handlers that only need step-up for part of what they do. */
export async function checkStepUp(user: NonNullable<AuthenticatedRequest['user']>): Promise<StepUpDecision> {
  if (disabledForTests() || (await hasRecentStepUp(user.id))) return { ok: true };
  if (!user.totpEnabled) {
    return {
      ok: false,
      body: {
        error: 'Two-factor authentication is required for this action. Set it up first.',
        code: 'MFA_ENROLLMENT_REQUIRED',
      },
    };
  }
  return { ok: false, body: STEP_UP_REQUIRED };
}

export const requireRecentStepUp = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const decision = await checkStepUp(req.user);
    return decision.ok ? next() : res.status(403).json(decision.body);
  } catch (error) {
    return next(error);
  }
};
