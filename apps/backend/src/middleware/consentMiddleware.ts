/**
 * consentMiddleware.ts
 *
 * HPCSA telemedicine compliance: require explicit informed consent
 * before AI triage routes can be accessed.
 *
 * Usage:
 *   router.post('/run', requireConsent('AI_TRIAGE'), triageHandler)
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

export type ConsentType = 'AI_TRIAGE' | 'BIOMETRIC_MONITORING' | 'DATA_SHARING' | 'MARKETING';

export function requireConsent(consentType: ConsentType, version = '1.0') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthenticated' });
        return;
      }

      const consent = await (prisma as any).patientConsent.findFirst({
        where: {
          userId,
          consentType,
          version,
          withdrawn: false,
        },
      });

      if (!consent) {
        res.status(403).json({
          success: false,
          error: 'CONSENT_REQUIRED',
          consentType,
          version,
          message: `You must provide informed consent for ${consentType} before using this feature. Visit /api/consent to record your consent.`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
