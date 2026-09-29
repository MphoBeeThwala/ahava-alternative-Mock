/**
 * A patient's record, for a verified clinician who currently holds care
 * access to that patient (services/careAccess.ts) — whatever the access
 * came from: an accepted visit, a claimed case or monitoring alert, an
 * admin grant, or break-glass. Every read is audited with the grant that
 * justified it.
 *
 * Current and historical data: vitals come back as stored (they're not
 * field-encrypted, see lib/clinicalFieldEncryption.ts); written notes are
 * decrypted by the Prisma client for this authorised read.
 */
import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { writeRequestAudit } from '../services/clinicalAudit';
import { NO_ACCESS_ERROR, auditAccessDenied, requireVerifiedClinician } from '../services/careAccess';
import { extractMedicalPassportData } from '../services/triageSafetyChecks';
import prisma from '../lib/prisma';

const router: Router = Router();

const HISTORY_DAYS = 90;

router.get('/:patientId', requireVerifiedClinician(), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { patientId } = req.params;
    const me = req.user!.id;
    const now = new Date();
    const grant = await prisma.patientAccessGrant.findFirst({
      where: { clinicianId: me, patientId, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
      select: { id: true, reason: true, expiresAt: true },
    });
    if (!grant) {
      await auditAccessDenied(req, 'PatientRecord', patientId, patientId);
      return res.status(403).json(NO_ACCESS_ERROR);
    }

    const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 3600_000);
    const [patient, vitals, triageCases, visits, prescriptions, referrals] = await Promise.all([
      prisma.user.findUnique({
        where: { id: patientId },
        select: { id: true, role: true, firstName: true, lastName: true, dateOfBirth: true, gender: true, phone: true, riskProfile: true },
      }),
      prisma.biometricReading.findMany({
        where: { userId: patientId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true, createdAt: true, source: true, deviceType: true, alertLevel: true,
          heartRate: true, heartRateResting: true, hrvRmssd: true, bloodPressureSystolic: true, bloodPressureDiastolic: true,
          oxygenSaturation: true, temperature: true, respiratoryRate: true, glucose: true, weight: true,
        },
      }),
      prisma.triageCase.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, createdAt: true, status: true, symptoms: true, aiTriageLevel: true, finalTriageLevel: true,
          doctorDiagnosis: true, doctorNotes: true, doctorRecommendations: true, referredTo: true,
        },
      }),
      prisma.visit.findMany({
        where: { booking: { patientId } },
        orderBy: { scheduledStart: 'desc' },
        take: 50,
        select: { id: true, status: true, scheduledStart: true, actualStart: true, actualEnd: true, nurseReport: true, doctorReview: true, treatment: true, biometrics: true },
      }),
      prisma.prescription.findMany({ where: { patientId }, orderBy: { issuedAt: 'desc' }, take: 50 }),
      prisma.referral.findMany({ where: { patientId }, orderBy: { issuedAt: 'desc' }, take: 50 }),
    ]);
    if (!patient || patient.role !== 'PATIENT') return res.status(404).json({ error: 'Patient not found' });

    await writeRequestAudit({
      userId: me,
      userRole: req.user!.role,
      action: 'READ',
      resource: 'PatientRecord',
      resourceId: patientId,
      metadata: { patientId, grantId: grant.id, grantReason: grant.reason },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const { riskProfile, role: _role, ...demographics } = patient;
    return res.json({
      success: true,
      access: { reason: grant.reason, expiresAt: grant.expiresAt },
      patient: demographics,
      medicalPassport: extractMedicalPassportData({ riskProfile: riskProfile as any, dateOfBirth: patient.dateOfBirth, gender: patient.gender }),
      vitals,
      triageCases,
      visits,
      prescriptions,
      referrals,
    });
  } catch (error) { return next(error); }
});

// The home address is deliberately not part of the general record: it's
// served only by the visit routes, to the nurse going there.

export default router;
