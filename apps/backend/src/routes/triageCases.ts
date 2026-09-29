import { Router } from 'express';
import { UserRole, TriageCaseStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { NO_ACCESS_ERROR, auditAccessDenied, checkVerifiedClinician, hasActiveAccess, patientsWithActiveAccess, requireVerifiedClinician } from '../services/careAccess';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';
import { markCaseReviewed } from '../jobs/triageEscalation';
import { resolveTriageOverride } from '../services/triageReviewValidation';

const router: Router = Router();

// Get triage cases for user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    const role = req.user!.role;
    // Patients: their own cases. Doctors: cases they claimed, in full only
    // while they hold care access. Nobody else lists triage cases here
    // (this used to return every case in the system to admins and nurses).
    if (role === UserRole.PATIENT) where.patientId = req.user!.id;
    else if (role === UserRole.DOCTOR) {
      const check = await checkVerifiedClinician(req.user!.id);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      where.doctorId = req.user!.id;
    } else return res.status(403).json({ error: 'Access denied' });
    const cases = await prisma.triageCase.findMany({ where, include: { patient: { select: { id: true, firstName: true, lastName: true } }, doctor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'TriageCase', metadata: { count: cases.length, role: req.user!.role }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    if (role === UserRole.DOCTOR) {
      const allowed = await patientsWithActiveAccess(req.user!.id, cases.map((c) => c.patientId));
      const projected = cases.map((c) => allowed.has(c.patientId)
        ? c
        : { id: c.id, status: c.status, createdAt: c.createdAt, aiTriageLevel: c.aiTriageLevel, finalTriageLevel: c.finalTriageLevel, patientId: c.patientId, doctorId: c.doctorId, restricted: 'ACCESS_EXPIRED' });
      return res.json({ success: true, cases: projected });
    }
    return res.json({ success: true, cases });
  } catch (error) { return next(error); }
});

// Get specific triage case
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const triageCase = await prisma.triageCase.findUnique({ where: { id }, include: { patient: true, doctor: true } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    if (triageCase.patientId !== req.user!.id) {
      if (req.user!.role !== UserRole.DOCTOR || triageCase.doctorId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
      const check = await checkVerifiedClinician(req.user!.id);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      if (!(await hasActiveAccess(req.user!.id, triageCase.patientId))) {
        await auditAccessDenied(req, 'TriageCase', triageCase.id, triageCase.patientId);
        return res.status(403).json(NO_ACCESS_ERROR);
      }
    }
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'TriageCase', resourceId: triageCase.id, metadata: { patientId: triageCase.patientId, doctorId: triageCase.doctorId, status: triageCase.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, triageCase });
  } catch (error) { return next(error); }
});

// Doctor reviews and updates triage case
router.patch('/:id/review', requireVerifiedClinician(['DOCTOR']), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { doctorNotes, doctorDiagnosis, doctorRecommendations, finalTriageLevel, overrideReason, referredTo } = req.body;
    const triageCase = await prisma.triageCase.findUnique({ where: { id } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    // Must be claimed first (POST /triage-review/:id/claim grants access).
    if (triageCase.doctorId !== req.user!.id) return res.status(triageCase.doctorId ? 403 : 409).json({ error: triageCase.doctorId ? 'Access denied' : 'Claim this case before reviewing it' });
    if (!(await hasActiveAccess(req.user!.id, triageCase.patientId))) {
      await auditAccessDenied(req, 'TriageCase', triageCase.id, triageCase.patientId);
      return res.status(403).json(NO_ACCESS_ERROR);
    }

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
    return res.json({ success: true, triageCase: updated });
  } catch (error) { return next(error); }
});

export default router;
