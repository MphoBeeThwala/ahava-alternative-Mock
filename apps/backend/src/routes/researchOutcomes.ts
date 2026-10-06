/**
 * POST /api/v1/research/outcomes — a doctor records a confirmed clinical
 * outcome for a patient they currently hold care access to, so the research
 * dataset has ground truth to learn from and be validated against.
 *
 * The route is deliberately boring: structured fields only (no free text),
 * the doctor must be verified and hold an active grant for that patient, the
 * patient must have opted in to research (otherwise nothing is stored and the
 * doctor is told so), and every call is audited.
 */
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { auditAccessDenied, hasActiveAccess, NO_ACCESS_ERROR, requireVerifiedClinician } from '../services/careAccess';
import { writeRequestAudit } from '../services/clinicalAudit';
import { recordClinicianOutcome, researchDataFor } from '../services/research/researchCapture';
import { CLINICIAN_ENTERABLE } from '../services/research/researchOutcomes';

const router: Router = Router();
const requireVerifiedDoctor = requireVerifiedClinician(['DOCTOR']);

// "What have you shared?": a patient's own research data, for their eyes only.
// Patients only; a clinician has no route to anyone's research rows.
router.get('/my-data', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.user?.role !== 'PATIENT') return res.status(403).json({ error: 'Patients only', code: 'PATIENT_ONLY' });
    const data = await researchDataFor(req.user.id);
    await writeRequestAudit({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'READ',
      resource: 'ResearchData',
      metadata: { event: 'PATIENT_VIEWED_OWN_RESEARCH_DATA', readings: data.readings.length, outcomes: data.outcomes.length },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

// What a client may submit, for building the entry form.
router.get('/outcome-types', requireVerifiedDoctor, (_req, res) => {
  res.json({ success: true, outcomeTypes: CLINICIAN_ENTERABLE });
});

router.post('/outcomes', requireVerifiedDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patientId = typeof body.patientId === 'string' ? body.patientId : '';
    if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' });

    if (!(await hasActiveAccess(req.user!.id, patientId))) {
      await auditAccessDenied(req, 'ResearchOutcome', patientId, patientId);
      return res.status(403).json(NO_ACCESS_ERROR);
    }

    // Whitelist the fields: nothing else the client sends reaches the store.
    const result = await recordClinicianOutcome(
      patientId,
      { outcomeType: body.outcomeType, outcomeDay: body.outcomeDay, icd10: body.icd10, basis: body.basis, alertLevel: body.alertLevel },
      'DOCTOR',
    );
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });

    await writeRequestAudit({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'CREATE',
      resource: 'ResearchOutcome',
      resourceId: patientId,
      // Type and status only: the audit trail records that an outcome was
      // entered, not the clinical content a second time.
      metadata: { outcomeType: body.outcomeType, status: result.status },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // 'no_consent' is reported as not captured, with no further detail about
    // the patient's consent choices.
    return res.status(result.status === 'captured' ? 201 : 200).json({
      success: true,
      captured: result.status === 'captured',
      reason: result.status === 'captured' ? undefined : result.status,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
