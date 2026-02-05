import { Router } from 'express';
import { analyzeSymptoms } from '../services/aiTriage';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// POST /api/triage
router.post('/', authMiddleware, rateLimiter, async (req, res, next) => {
    try {
        const { symptoms, imageBase64 } = req.body;

        if (!symptoms) {
            return res.status(400).json({ error: 'Symptoms description is required' });
        }

        const result = await analyzeSymptoms({ symptoms, imageBase64 });

        // In a real app, save this to the DB as a 'TriageRecord' linked to the Visit
        // await prisma.triageRecord.create({ ... })

        res.json({
            success: true,
            data: result,
            meta: {
                disclaimer: "Not a medical diagnosis. Tool for decision support only."
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;
