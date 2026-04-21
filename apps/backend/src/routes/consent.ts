/**
 * consent.ts — HPCSA / POPIA informed consent management routes
 *
 * POST /api/consent          — Record patient consent
 * GET  /api/consent          — Get all consents for authenticated user
 * DELETE /api/consent/:type  — Withdraw a specific consent
 */

import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import prisma from '../lib/prisma';

const router: Router = Router();

const VALID_CONSENT_TYPES = ['AI_TRIAGE', 'BIOMETRIC_MONITORING', 'DATA_SHARING', 'MARKETING'] as const;

const giveConsentSchema = Joi.object({
  consentType: Joi.string().valid(...VALID_CONSENT_TYPES).required(),
  version: Joi.string().default('1.0'),
});

// POST /api/consent — Give consent
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { error, value } = giveConsentSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.details[0].message });

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? null;
    const userAgent = req.headers['user-agent'] ?? null;

    const consent = await (prisma as any).patientConsent.upsert({
      where: {
        userId_consentType_version: {
          userId,
          consentType: value.consentType,
          version: value.version,
        },
      },
      create: {
        userId,
        consentType: value.consentType,
        version: value.version,
        ipAddress,
        userAgent,
        withdrawn: false,
      },
      update: {
        withdrawn: false,
        withdrawnAt: null,
        givenAt: new Date(),
        ipAddress,
        userAgent,
      },
    });

    res.status(201).json({
      success: true,
      message: `Consent recorded for ${value.consentType}`,
      consent: {
        id: consent.id,
        consentType: consent.consentType,
        version: consent.version,
        givenAt: consent.givenAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/consent — List all consents for authenticated user
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;

    const consents = await (prisma as any).patientConsent.findMany({
      where: { userId },
      select: {
        id: true,
        consentType: true,
        version: true,
        givenAt: true,
        withdrawn: true,
        withdrawnAt: true,
      },
      orderBy: { givenAt: 'desc' },
    });

    res.json({ success: true, consents });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/consent/:consentType — Withdraw consent
router.delete('/:consentType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId      = (req as any).user.id;
    const consentType = req.params.consentType;

    if (!VALID_CONSENT_TYPES.includes(consentType as any)) {
      return res.status(400).json({ success: false, error: 'Invalid consent type' });
    }

    await (prisma as any).patientConsent.updateMany({
      where: { userId, consentType, withdrawn: false },
      data: { withdrawn: true, withdrawnAt: new Date() },
    });

    res.json({
      success: true,
      message: `Consent for ${consentType} has been withdrawn. Your data will no longer be processed for this purpose.`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
