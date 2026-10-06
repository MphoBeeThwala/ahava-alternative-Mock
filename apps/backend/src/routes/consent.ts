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
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { RESEARCH_CONSENT_TYPE, RESEARCH_CONSENT_VERSION } from '../services/research/pseudonym';
import { purgeSubject } from '../services/research/researchCapture';

const router: Router = Router();

// RESEARCH_DATA is a separate, opt-in purpose (POPIA s13/s15: specific purpose,
// no bundling): pseudonymised use of a patient's readings and clinician-confirmed
// outcomes to build and validate future prediction models. It is never implied
// by any other consent. See docs/RESEARCH_DATA_PIPELINE.md.
const VALID_CONSENT_TYPES = ['AI_TRIAGE', 'BIOMETRIC_MONITORING', 'DATA_SHARING', 'MARKETING', RESEARCH_CONSENT_TYPE] as const;
type ValidConsentType = (typeof VALID_CONSENT_TYPES)[number];

function isValidConsentType(value: string): value is ValidConsentType {
  return VALID_CONSENT_TYPES.includes(value as ValidConsentType);
}

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
    if (value.consentType === RESEARCH_CONSENT_TYPE && value.version !== RESEARCH_CONSENT_VERSION) {
      return res.status(400).json({
        success: false,
        error: `RESEARCH_DATA consent must be given on the current wording (version ${RESEARCH_CONSENT_VERSION})`,
      });
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? null;
    const userAgent = req.headers['user-agent'] ?? null;

    const consent = await prisma.patientConsent.upsert({
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

    await createAuditLog({
      userId,
      userRole: (req as any).user?.role,
      action: 'CREATE',
      resource: 'Consent',
      resourceId: consent.id,
      metadata: { consentType: value.consentType, version: value.version },
      ipAddress,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    }).catch(() => undefined);

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
    return next(error);
  }
});

// GET /api/consent — List all consents for authenticated user
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;

    const consents = await prisma.patientConsent.findMany({
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
    return next(error);
  }
});

// DELETE /api/consent/:consentType — Withdraw consent
router.delete('/:consentType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId      = (req as any).user.id;
    const consentType = req.params.consentType;

    if (!isValidConsentType(consentType)) {
      return res.status(400).json({ success: false, error: 'Invalid consent type' });
    }

    await prisma.patientConsent.updateMany({
      where: { userId, consentType, withdrawn: false },
      data: { withdrawn: true, withdrawnAt: new Date() },
    });

    await createAuditLog({
      userId,
      userRole: (req as any).user?.role,
      action: 'UPDATE',
      resource: 'Consent',
      metadata: { consentType, event: 'CONSENT_WITHDRAWN' },
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    }).catch(() => undefined);

    // Withdrawing research consent also deletes what was already captured
    // under it; "no longer processed" would not be true otherwise. If the
    // delete could not run we say so instead of claiming it did.
    if (consentType === RESEARCH_CONSENT_TYPE) {
      const purge = await purgeSubject(userId);
      await createAuditLog({
        userId,
        userRole: (req as any).user?.role,
        action: 'DELETE',
        resource: 'ResearchData',
        metadata: { event: 'RESEARCH_DATA_PURGED_ON_WITHDRAWAL', purged: purge.purged, snapshots: purge.snapshots, outcomes: purge.outcomes },
      }).catch(() => undefined);
      return res.json({
        success: true,
        message: purge.purged
          ? 'Research consent withdrawn. Your readings and outcomes held for research have been deleted.'
          : 'Research consent withdrawn and no further data will be captured. Deletion of data already captured is pending and will be completed by our team.',
        researchDataDeleted: purge.purged,
      });
    }

    res.json({
      success: true,
      message: `Consent for ${consentType} has been withdrawn. Your data will no longer be processed for this purpose.`,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
