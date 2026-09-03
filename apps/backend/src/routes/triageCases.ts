import { Router } from 'express';
import { UserRole, TriageCaseStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireDoctor } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';
import { markCaseReviewed } from '../jobs/triageEscalation';
import { resolveTriageOverride } from '../services/triageReviewValidation';

const router: Router = Router();

// Get triage cases for user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === UserRole.PATIENT) where.patientId = req.user!.id;
    else if (req.user!.role === UserRole.DOCTOR) where.doctorId = req.user!.id;
    const cases = await prisma.triageCase.findMany({ where, include: { patient: { select: { id: true, firstName: true, lastName: true } }, doctor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'TriageCase', metadata: { count: cases.length, role: req.user!.role }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, cases });
  } catch (error) { next(error); }
});

// Get specific triage case
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const triageCase = await prisma.triageCase.findUnique({ where: { id }, include: { patient: true, doctor: true } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || triageCase.patientId === req.user!.id || triageCase.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'TriageCase', resourceId: triageCase.id, metadata: { patientId: triageCase.patientId, doctorId: triageCase.doctorId, status: triageCase.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, triageCase });
  } catch (error) { next(error); }
});

// Doctor reviews and updates triage case
router.patch('/:id/review', requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { doctorNotes, doctorDiagnosis, doctorRecommendations, finalTriageLevel, overrideReason, referredTo } = req.body;
    const triageCase = await prisma.triageCase.findUnique({ where: { id } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });

    if (!doctorNotes?.trim() || !doctorDiagnosis?.trim()) {
      return res.status(400).json({ error: 'Doctor notes and diagnosis are required' });
    }

    const {
      chosenLevel,
      normalizedOverrideReason,
      error: overrideValidationError,
    } = resolveTriageOverride({
      aiTriageLevel: triageCase.aiTriageLevel,
      finalTriageLevel,
      overrideReason,
    });

    if (overrideValidationError) {
      return res.status(400).json({ error: overrideValidationError });
    }

    const updated = await prisma.triageCase.update({
      where: { id },
      data: {
        doctorId: req.user!.id,
        doctorNotes: doctorNotes.trim(),
        doctorDiagnosis: doctorDiagnosis.trim(),
        doctorRecommendations: doctorRecommendations?.trim() || null,
        finalDiagnosis: doctorDiagnosis.trim(),
        finalTriageLevel: chosenLevel,
        overrideReason: chosenLevel !== triageCase.aiTriageLevel ? normalizedOverrideReason : null,
        referredTo: referredTo?.trim() || null,
        status: TriageCaseStatus.REVIEWED,
        reviewedAt: new Date(),
      }
    });
    await markCaseReviewed(id, req.user!.id);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'TriageCase', resourceId: id, metadata: { oldStatus: triageCase.status, newStatus: 'REVIEWED', hasDiagnosis: !!doctorDiagnosis }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, triageCase: updated });
  } catch (error) { next(error); }
});

export default router;
