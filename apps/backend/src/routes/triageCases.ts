import { Router, Response, NextFunction } from 'express';
import { PrismaClient, TriageCaseStatus, UserRole } from '@prisma/client';
import Joi from 'joi';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { notifyTriageApproved, notifyTriageOverride, notifyTriageReferred } from '../services/notifications';

const router: Router = Router();
const prisma = new PrismaClient();

// GET /api/triage-cases – doctor: list pending cases + my reviewed cases
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== UserRole.DOCTOR && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Only doctors can view the triage queue' });
    }

    const status = req.query.status as string | undefined;
    const where: { status?: TriageCaseStatus; doctorId?: string | null } = {};

    if (status === 'PENDING_REVIEW') {
      where.status = TriageCaseStatus.PENDING_REVIEW;
    } else if (status === 'mine') {
      where.doctorId = req.user!.id;
    } else {
      // Default: pending (for queue) or cases I've handled
      where.status = TriageCaseStatus.PENDING_REVIEW;
    }

    const cases = await prisma.triageCase.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, cases });
  } catch (error) {
    next(error);
  }
});

const approveSchema = Joi.object({ finalDiagnosis: Joi.string().allow('').optional() });
const overrideSchema = Joi.object({
  doctorNotes: Joi.string().allow('').optional(),
  finalDiagnosis: Joi.string().allow('').optional(),
});
const referSchema = Joi.object({
  referredTo: Joi.string().required(),
  doctorNotes: Joi.string().allow('').optional(),
});

// POST /api/triage-cases/:id/approve – doctor agrees with AI
router.post('/:id/approve', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== UserRole.DOCTOR && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Only doctors can approve triage cases' });
    }

    const { error, value } = approveSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const c = await prisma.triageCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Triage case not found' });
    if (c.status !== TriageCaseStatus.PENDING_REVIEW) {
      return res.status(400).json({ error: 'Case already reviewed' });
    }

    const updated = await prisma.triageCase.update({
      where: { id: req.params.id },
      data: {
        status: TriageCaseStatus.APPROVED,
        doctorId: req.user!.id,
        finalDiagnosis: value.finalDiagnosis || c.aiRecommendedAction,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    notifyTriageApproved({
      to: updated.patient.email,
      patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
      finalDiagnosis: updated.finalDiagnosis || updated.aiRecommendedAction,
    }).catch((e) => console.error('[triage] notify approved failed', e));

    res.json({ success: true, case: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/triage-cases/:id/override – doctor disagrees; diagnosis can follow later
router.post('/:id/override', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== UserRole.DOCTOR && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Only doctors can override triage cases' });
    }

    const { error, value } = overrideSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const c = await prisma.triageCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Triage case not found' });
    if (c.status !== TriageCaseStatus.PENDING_REVIEW) {
      return res.status(400).json({ error: 'Case already reviewed' });
    }

    const updated = await prisma.triageCase.update({
      where: { id: req.params.id },
      data: {
        status: TriageCaseStatus.DOCTOR_OVERRIDE,
        doctorId: req.user!.id,
        doctorNotes: value.doctorNotes,
        finalDiagnosis: value.finalDiagnosis,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    notifyTriageOverride({
      to: updated.patient.email,
      patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
      doctorNotes: updated.doctorNotes ?? undefined,
      finalDiagnosis: updated.finalDiagnosis ?? undefined,
    }).catch((e) => console.error('[triage] notify override failed', e));

    res.json({ success: true, case: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/triage-cases/:id/refer – in-person or partner appointment
router.post('/:id/refer', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== UserRole.DOCTOR && req.user!.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Only doctors can refer triage cases' });
    }

    const { error, value } = referSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const c = await prisma.triageCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Triage case not found' });
    if (c.status !== TriageCaseStatus.PENDING_REVIEW) {
      return res.status(400).json({ error: 'Case already reviewed' });
    }

    const updated = await prisma.triageCase.update({
      where: { id: req.params.id },
      data: {
        status: TriageCaseStatus.REFERRED,
        doctorId: req.user!.id,
        referredTo: value.referredTo,
        doctorNotes: value.doctorNotes,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    notifyTriageReferred({
      to: updated.patient.email,
      patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
      referredTo: updated.referredTo!,
      doctorNotes: updated.doctorNotes ?? undefined,
    }).catch((e) => console.error('[triage] notify referred failed', e));

    res.json({ success: true, case: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
