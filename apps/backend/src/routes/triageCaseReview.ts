import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { markCaseReviewed } from '../jobs/triageEscalation';
import { sendToUser } from '../services/websocket';
import { generatePrescriptionPdf, generateReferralPdf, MedicationLine } from '../services/documentGenerator';
import prisma from '../lib/prisma';

const router: Router = Router();

// -----------------------------------------------------------------------
// PATCH /api/triage-review/profile/hpcsa
// Doctor self-service: submit or update their own HPCSA practice number.
// Admin must separately mark it verified via /api/admin/users/:id/hpcsa.
// -----------------------------------------------------------------------
router.patch('/profile/hpcsa', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { hcpsaNumber } = req.body as { hcpsaNumber?: string };

        if (!hcpsaNumber || typeof hcpsaNumber !== 'string' || !hcpsaNumber.trim()) {
            return res.status(400).json({ error: 'hcpsaNumber is required.' });
        }

        const updated = await prisma.user.update({
            where: { id: doctorId },
            data: {
                hcpsaNumber: hcpsaNumber.trim().toUpperCase(),
                hcpsaVerified: false, // Verification must be done by admin
                hcpsaVerifiedAt: null,
            } as any,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                hcpsaNumber: true,
                hcpsaVerified: true,
            } as any,
        });

        res.json({ success: true, user: updated, message: 'Practice number submitted. An administrator will verify it.' });
    } catch (error) { next(error); }
});

// -----------------------------------------------------------------------
// GET /api/triage-review/profile/hpcsa — doctor reads their own HPCSA status
// -----------------------------------------------------------------------
router.get('/profile/hpcsa', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const user = await prisma.user.findUnique({
            where: { id: doctorId },
            select: {
                hcpsaNumber: true,
                hcpsaVerified: true,
                hcpsaVerifiedAt: true,
            } as any,
        });
        res.json({ success: true, hcpsa: user });
    } catch (error) { next(error); }
});

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
        const _doctorId = req.user!.id;
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
                    disclaimer: 'Reviewed and released by a licensed doctor via Ahava Healthcare Platform.',
                    satsLevel: finalLevel,
                },
            },
        });

        res.json({ success: true, releasedAt: releasedAt.toISOString() });
    } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------
// POST /api/triage-cases/:id/prescription — doctor writes remote treatment script
// ---------------------------------------------------------------------------
router.post('/:id/prescription', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { id } = req.params;
        const { diagnosis, medications, doctorNotes } = req.body;

        if (!diagnosis || !Array.isArray(medications) || medications.length === 0) {
            return res.status(400).json({ error: 'diagnosis and at least one medication are required.' });
        }

        const tc = await prisma.triageCase.findUnique({
            where: { id },
            include: {
                patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
            },
        });
        if (!tc) return res.status(404).json({ error: 'Case not found' });
        if (tc.doctorId && tc.doctorId !== doctorId) {
            return res.status(403).json({ error: 'Case assigned to a different doctor' });
        }
        const validPrescribeStatuses = ['REVIEWED', 'ASSIGNED', 'PENDING_REVIEW'];
        if (!validPrescribeStatuses.includes(tc.status as string)) {
            return res.status(400).json({ error: `Cannot issue a prescription on a case with status ${tc.status}.` });
        }

        const doctor = await prisma.user.findUnique({
            where: { id: doctorId },
            select: { firstName: true, lastName: true, hcpsaNumber: true } as any,
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

        const d = doctor as { firstName: string; lastName: string; hcpsaNumber?: string | null };

        const prescription = await (prisma.prescription as any).create({
            data: {
                triageCaseId: id,
                patientId: tc.patientId,
                doctorId,
                medications,
                diagnosis,
                doctorNotes: doctorNotes || null,
                hcpsaNumberSnapshot: d.hcpsaNumber || null,
                doctorNameSnapshot: `${d.firstName} ${d.lastName}`,
                issuedAt: new Date(),
            },
        });

        await prisma.triageCase.update({
            where: { id },
            data: { status: 'PRESCRIPTION_ISSUED', releasedAt: new Date() } as any,
        });

        // Notify patient via WebSocket
        sendToUser(tc.patientId, {
            type: 'PRESCRIPTION_ISSUED',
            data: {
                triageCaseId: id,
                prescriptionId: prescription.id,
                diagnosis,
                doctorName: `Dr. ${d.firstName} ${d.lastName}`,
                medicationCount: medications.length,
                issuedAt: prescription.issuedAt,
                downloadUrl: `/api/triage-review/${id}/prescription/pdf`,
            },
        });

        res.json({ success: true, prescriptionId: prescription.id });
    } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------
// POST /api/triage-cases/:id/emergency-referral — doctor declares emergency
// ---------------------------------------------------------------------------
router.post('/:id/emergency-referral', authMiddleware, requireRole('DOCTOR'), async (req: AuthenticatedRequest, res, next) => {
    try {
        const doctorId = req.user!.id;
        const { id } = req.params;
        const { referralType, provisionalDiagnosis, clinicalNotes, recommendedFacility } = req.body;

        if (!provisionalDiagnosis || !clinicalNotes || !recommendedFacility) {
            return res.status(400).json({ error: 'provisionalDiagnosis, clinicalNotes, and recommendedFacility are required.' });
        }

        const tc = await prisma.triageCase.findUnique({
            where: { id },
            include: {
                patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
            },
        });
        if (!tc) return res.status(404).json({ error: 'Case not found' });
        if (tc.doctorId && tc.doctorId !== doctorId) {
            return res.status(403).json({ error: 'Case assigned to a different doctor' });
        }
        const validReferralStatuses = ['REVIEWED', 'ASSIGNED', 'PENDING_REVIEW'];
        if (!validReferralStatuses.includes(tc.status as string)) {
            return res.status(400).json({ error: `Cannot issue an emergency referral on a case with status ${tc.status}.` });
        }

        const doctor = await prisma.user.findUnique({
            where: { id: doctorId },
            select: { firstName: true, lastName: true, hcpsaNumber: true } as any,
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

        const d = doctor as { firstName: string; lastName: string; hcpsaNumber?: string | null };
        const type = (referralType as string)?.toUpperCase() || 'EMERGENCY';

        const referral = await (prisma.referral as any).create({
            data: {
                triageCaseId: id,
                patientId: tc.patientId,
                doctorId,
                referralType: type,
                provisionalDiagnosis,
                clinicalNotes,
                recommendedFacility,
                hcpsaNumberSnapshot: d.hcpsaNumber || null,
                doctorNameSnapshot: `${d.firstName} ${d.lastName}`,
                issuedAt: new Date(),
                smsStatus: 'NO_SMS_PROVIDER',
            },
        });

        await prisma.triageCase.update({
            where: { id },
            data: {
                doctorId,
                status: 'EMERGENCY_REFERRAL',
                releasedAt: new Date(),
                doctorNotes: clinicalNotes,
                doctorDiagnosis: provisionalDiagnosis,
            } as any,
        });

        // High-priority WebSocket alert to patient
        sendToUser(tc.patientId, {
            type: 'EMERGENCY_REFERRAL_ISSUED',
            data: {
                triageCaseId: id,
                referralId: referral.id,
                referralType: type,
                provisionalDiagnosis,
                recommendedFacility,
                doctorName: `Dr. ${d.firstName} ${d.lastName}`,
                issuedAt: referral.issuedAt,
                downloadUrl: `/api/triage-review/${id}/referral/pdf`,
                emergencyNumbers: { ems: '10177', national: '112', poison: '0861 555 777' },
            },
        });

        res.json({ success: true, referralId: referral.id });
    } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------
// GET /api/triage-cases/:id/prescription/pdf — download prescription as PDF
// ---------------------------------------------------------------------------
router.get('/:id/prescription/pdf', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;

        const prescription = await (prisma.prescription as any).findUnique({
            where: { triageCaseId: id },
            include: {
                patient: { select: { firstName: true, lastName: true, dateOfBirth: true } },
                doctor: { select: { firstName: true, lastName: true, hcpsaNumber: true } },
            },
        });

        if (!prescription) return res.status(404).json({ error: 'No prescription found for this case.' });

        // Only allow patient or the prescribing doctor to download
        if (prescription.patientId !== userId && prescription.doctorId !== userId) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const pdfBuffer = await generatePrescriptionPdf({
            id: prescription.id,
            issuedAt: prescription.issuedAt,
            doctor: prescription.doctor as { firstName: string; lastName: string; hcpsaNumber?: string | null },
            patient: prescription.patient as { firstName: string; lastName: string; dateOfBirth?: Date | null },
            diagnosis: prescription.diagnosis,
            medications: prescription.medications as MedicationLine[],
            doctorNotes: prescription.doctorNotes,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="prescription-${prescription.id.slice(-8)}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------
// GET /api/triage-cases/:id/referral/pdf — download referral letter as PDF
// ---------------------------------------------------------------------------
router.get('/:id/referral/pdf', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;

        const referral = await (prisma.referral as any).findUnique({
            where: { triageCaseId: id },
            include: {
                patient: { select: { firstName: true, lastName: true, dateOfBirth: true, phone: true } },
                doctor: { select: { firstName: true, lastName: true, hcpsaNumber: true } },
            },
        });

        if (!referral) return res.status(404).json({ error: 'No referral found for this case.' });

        if (referral.patientId !== userId && referral.doctorId !== userId) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const pdfBuffer = await generateReferralPdf({
            id: referral.id,
            issuedAt: referral.issuedAt,
            referralType: referral.referralType,
            recommendedFacility: referral.recommendedFacility,
            provisionalDiagnosis: referral.provisionalDiagnosis,
            clinicalNotes: referral.clinicalNotes,
            doctor: referral.doctor as { firstName: string; lastName: string; hcpsaNumber?: string | null },
            patient: referral.patient as { firstName: string; lastName: string; dateOfBirth?: Date | null; phone?: string | null },
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="referral-${referral.id.slice(-8)}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) { next(error); }
});

export default router;
