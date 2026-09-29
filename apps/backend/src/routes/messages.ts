import { Router } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';
import { NO_ACCESS_ERROR, auditAccessDenied, checkVerifiedClinician, hasActiveAccess } from '../services/careAccess';

const router: Router = Router();

/**
 * Messages are part of the patient's record: the patient, or the visit's
 * nurse/doctor while they hold care access. Admins don't read them.
 */
async function messageAccess(
  req: AuthenticatedRequest,
  visit: { id: string; nurseId: string; doctorId: string | null; booking: { patientId: string } },
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  const me = req.user!.id;
  if (visit.booking.patientId === me) return { ok: true };
  if (visit.nurseId !== me && visit.doctorId !== me) return { ok: false, status: 403, body: { error: 'Access denied' } };
  const check = await checkVerifiedClinician(me);
  if (!check.ok) return { ok: false, status: check.status, body: { error: check.error, code: check.code } };
  if (!(await hasActiveAccess(me, visit.booking.patientId))) {
    await auditAccessDenied(req, 'Message', visit.id, visit.booking.patientId);
    return { ok: false, status: 403, body: NO_ACCESS_ERROR };
  }
  return { ok: true };
}

router.get('/visit/:visitId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { visitId } = req.params;
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, nurseId: true, doctorId: true, booking: { select: { patientId: true } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const access = await messageAccess(req, visit);
    if (!access.ok) return res.status(access.status).json(access.body);
    const messages = await prisma.message.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Message', metadata: { visitId, count: messages.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, messages });
  } catch (error) { return next(error); }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { visitId, recipientId, content, type } = req.body;
    const visit = await prisma.visit.findUnique({ where: { id: visitId }, select: { id: true, nurseId: true, doctorId: true, booking: { select: { patientId: true } } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const access = await messageAccess(req, visit);
    if (!access.ok) return res.status(access.status).json(access.body);
    // The recipient has to be someone on this visit, not any user id.
    const participants = [visit.booking.patientId, visit.nurseId, visit.doctorId].filter(Boolean);
    if (!participants.includes(recipientId) || recipientId === req.user!.id) {
      return res.status(400).json({ error: 'recipientId must be another participant in this visit' });
    }
    if (typeof content !== 'string' || !content.trim() || content.length > 10000) {
      return res.status(400).json({ error: 'content is required (max 10000 characters)' });
    }
    const message = await prisma.message.create({ data: { visitId, senderId: req.user!.id, recipientId, content, type: type || 'TEXT' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'CREATE', resource: 'Message', resourceId: message.id, metadata: { visitId, recipientId, type }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.status(201).json({ success: true, message });
  } catch (error) { return next(error); }
});

export default router;
