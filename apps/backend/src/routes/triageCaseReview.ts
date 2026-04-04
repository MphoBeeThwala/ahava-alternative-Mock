import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { markCaseReviewed } from '../jobs/triageEscalation';
import { sendToUser } from '../services/websocket';
import prisma from '../lib/prisma';

const router: Router = Router();

// GET /api/triage-cases — doctor fetches queue
router.get('/', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const status = (req.query.status as string) || 'PENDING_REVIEW';

        const cases = await prisma.triageCase.findMany({
            where: status === 'all'
                ? { OR: [{ doctorId }, { doctorId: null, status: 'PENDING_REVIEW' }] }
                : { status: status as any, OR: [{ doctorId }, { doctorId: null }] },
            include: {
                patient: {
                    select: { id: true, firstName: true, lastName: true, dateOfBirth: true, gender: true },
                },
            },
            orderBy: [{ aiTriageLevel: 'asc' }, { slaDeadline: 'asc' }],
            take: 50,
        });

        res.json({ success: true, cases });
    } catch (error) { next(error); }
});

// POST /api/triage-cases/:id/claim — doctor claims a case
router.post('/:id/claim', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { id } = req.params;

        const tc = await prisma.triageCase.findUnique({ where: { id } });
        if (!tc) return res.status(404).json({ error: 'Case not found' });
        if (tc.doctorId && tc.doctorId !== doctorId) {
            return res.status(409).json({ error: 'Case already claimed by another doctor' });
        }

        await prisma.triageCase.update({
            where: { id },
            data: { doctorId, status: 'ASSIGNED' } as any,
        });

        res.json({ success: true });
    } catch (error) { next(error); }
});

// POST /api/triage-cases/:id/review — doctor saves review (draft)
router.post('/:id/review', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { id } = req.params;
        const { doctorNotes, doctorDiagnosis, doctorRecommendations, finalTriageLevel, overrideReason } = req.body;

        const tc = await prisma.triageCase.findUnique({ where: { id } });
        if (!tc) return res.status(404).json({ error: 'Case not found' });
        if (tc.doctorId && tc.doctorId !== doctorId) {
            return res.status(403).json({ error: 'Case assigned to different doctor' });
        }

        if (finalTriageLevel && finalTriageLevel !== tc.aiTriageLevel && !overrideReason) {
            return res.status(400).json({ error: 'overrideReason is required when changing the AI triage level' });
        }

        await prisma.triageCase.update({
            where: { id },
            data: {
                doctorId,
                doctorNotes,
                doctorDiagnosis,
                doctorRecommendations,
                finalTriageLevel: finalTriageLevel ?? tc.aiTriageLevel,
                overrideReason: overrideReason ?? null,
                reviewedAt: new Date(),
                status: 'REVIEWED',
            } as any,
        });

        await markCaseReviewed(id, doctorId);

        res.json({ success: true });
    } catch (error) { next(error); }
});

// POST /api/triage-cases/:id/release — doctor releases result to patient
router.post('/:id/release', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { id } = req.params;

        const tc = await prisma.triageCase.findUnique({ where: { id } });
        if (!tc) return res.status(404).json({ error: 'Case not found' });

        if (!tc.doctorNotes || !tc.doctorDiagnosis) {
            return res.status(400).json({
                error: 'Doctor notes and diagnosis are required before releasing to patient.',
            });
        }

        const releasedAt = new Date();

        await prisma.triageCase.update({
            where: { id },
            data: { status: 'RELEASED', releasedAt } as any,
        });

        const finalLevel = (tc as any).finalTriageLevel ?? tc.aiTriageLevel;

        sendToUser(tc.patientId, {
            type: 'TRIAGE_RESULT_RELEASED',
            data: {
                triageCaseId: tc.id,
                triageLevel: finalLevel,
                aiTriageLevel: tc.aiTriageLevel,
                wasOverridden: finalLevel !== tc.aiTriageLevel,
                recommendedAction: tc.aiRecommendedAction,
                possibleConditions: tc.aiPossibleConditions,
                doctorNotes: tc.doctorNotes,
                doctorDiagnosis: tc.doctorDiagnosis,
                doctorRecommendations: (tc as any).doctorRecommendations,
                releasedAt: releasedAt.toISOString(),
                meta: {
                    disclaimer: 'Reviewed and approved by a licensed HPCSA-registered doctor.',
                    satsLevel: finalLevel,
                },
            },
        });

        res.json({ success: true, releasedAt: releasedAt.toISOString() });
    } catch (error) { next(error); }
});

export default router;
