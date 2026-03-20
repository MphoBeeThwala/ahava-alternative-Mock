import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { analyzeSymptoms } from '../services/aiTriage';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { requireConsent } from '../middleware/consentMiddleware';
import { calculateSlaDeadline, getDoctorFee } from '../jobs/triageEscalation';

const router: Router = Router();
const prisma = new PrismaClient();

// POST /api/triage – run AI triage and create a case for doctor review
router.post('/', rateLimiter, authMiddleware, requireConsent('AI_TRIAGE'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const { symptoms, imageBase64 } = req.body;
        const patientId = req.user?.id;

        if (!symptoms) {
            return res.status(400).json({ error: 'Symptoms description is required' });
        }
        if (!patientId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const result = await analyzeSymptoms({ symptoms, imageBase64 });

        const now         = new Date();
        const slaDeadline  = calculateSlaDeadline(result.triageLevel, now);
        const feeCents     = getDoctorFee(result.triageLevel);

        const triageCase = await prisma.triageCase.create({
            data: {
                patientId,
                symptoms,
                imageStorageRef: undefined,
                aiTriageLevel: result.triageLevel,
                aiRecommendedAction: result.recommendedAction,
                aiPossibleConditions: result.possibleConditions,
                aiReasoning: result.reasoning,
                slaDeadline,
                doctorFeeCents: feeCents,
            } as any,
        });

        res.json({
            success: true,
            data: result,
            triageCaseId: triageCase.id,
            slaDeadline: slaDeadline.toISOString(),
            meta: {
                disclaimer: "Not a medical diagnosis. Tool for decision support only. Sent to doctor for review.",
                satsLevel: result.triageLevel,
                slaMinutes: { 1: 5, 2: 15, 3: 60, 4: 240, 5: 480 }[result.triageLevel],
            },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
