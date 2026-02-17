import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { analyzeSymptoms } from '../services/aiTriage';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';

const router: Router = Router();
const prisma = new PrismaClient();

// POST /api/triage – run AI triage and create a case for doctor review
router.post('/', authMiddleware, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
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

        const triageCase = await prisma.triageCase.create({
            data: {
                patientId,
                symptoms,
                imageStorageRef: undefined,
                aiTriageLevel: result.triageLevel,
                aiRecommendedAction: result.recommendedAction,
                aiPossibleConditions: result.possibleConditions,
                aiReasoning: result.reasoning,
            },
        });

        res.json({
            success: true,
            data: result,
            triageCaseId: triageCase.id,
            meta: {
                disclaimer: "Not a medical diagnosis. Tool for decision support only. Sent to doctor for review."
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;
