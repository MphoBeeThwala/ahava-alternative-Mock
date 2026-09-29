import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requirePatient } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { DISPATCH_RADIUS_KM, notifyNearbyNurses, withdrawBookingOffer } from '../services/websocket';
import { encryptData, encryptPatientLocation, isEncryptedPayload, safeDecrypt } from '../utils/encryption';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { NO_ACCESS_ERROR, auditAccessDenied, checkVerifiedClinician, displayName, hasActiveAccess, isClinicianRole, patientsWithActiveAccess } from '../services/careAccess';
import Joi from 'joi';
import prisma from '../lib/prisma';

const router: Router = Router();

/**
 * A booking as seen by someone without care access to the patient (an
 * admin, or a nurse whose access window has closed): scheduling, payment
 * and status — no address, contact details or visit content.
 */
function restrictBooking(booking: any, reason: 'ADMIN_VIEW' | 'ACCESS_EXPIRED') {
  const { encryptedAddress: _a, encryptedPatientLocation: _l, patient, visit, ...rest } = booking;
  return {
    ...rest,
    patient: patient ? { id: patient.id, firstName: displayName(patient.firstName, patient.lastName) } : undefined,
    visit: visit ? { id: visit.id, status: visit.status, scheduledStart: visit.scheduledStart, actualStart: visit.actualStart ?? null, actualEnd: visit.actualEnd ?? null } : null,
    restricted: reason,
  };
}

const createBookingSchema = Joi.object({
  encryptedAddress: Joi.string().optional(),
  address: Joi.string().optional(),
  scheduledDate: Joi.date().iso().required(),
  estimatedDuration: Joi.number().min(30).max(240).default(60),
  paymentMethod: Joi.string().valid('CARD', 'INSURANCE').required(),
  amountInCents: Joi.number().min(0).required(),
  patientLat: Joi.number().min(-90).max(90).required(),
  patientLng: Joi.number().min(-180).max(180).required(),
  insuranceProvider: Joi.string().when('paymentMethod', {
    is: 'INSURANCE',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  insuranceMemberNumber: Joi.string().when('paymentMethod', {
    is: 'INSURANCE',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
}).or('encryptedAddress', 'address');

// Create new booking (Patient only)
router.post('/', requirePatient, idempotencyMiddleware({ scope: 'booking-create' }), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = createBookingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const bookingData = value;
    const now = new Date();
    if (new Date(bookingData.scheduledDate) <= now) {
      return res.status(400).json({ error: 'Scheduled date must be in the future' });
    }

    const encryptedAddress = isEncryptedPayload(bookingData.encryptedAddress)
      ? bookingData.encryptedAddress
      : encryptData(bookingData.encryptedAddress || bookingData.address || '');

    const booking = await prisma.booking.create({
      data: {
        patientId: req.user!.id,
        encryptedAddress,
        scheduledDate: new Date(bookingData.scheduledDate),
        estimatedDuration: bookingData.estimatedDuration,
        encryptedPatientLocation: encryptPatientLocation(bookingData.patientLat, bookingData.patientLng),
        paymentMethod: bookingData.paymentMethod,
        paymentStatus: 'PENDING',
        amountInCents: bookingData.amountInCents,
        insuranceProvider: bookingData.insuranceProvider,
        insuranceMemberNumber: bookingData.insuranceMemberNumber,
        insuranceStatus: bookingData.paymentMethod === 'INSURANCE' ? 'PENDING_VERIFICATION' : undefined,
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // AuditLog: Log booking creation
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'CREATE',
      resource: 'Booking',
      resourceId: booking.id,
      metadata: {
        patientId: booking.patientId,
        scheduledDate: booking.scheduledDate.toISOString(),
        amountInCents: booking.amountInCents,
        paymentMethod: booking.paymentMethod,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Nurses who haven't accepted yet get a first name and initial, not the
    // patient's full identity (minimum necessary before care access exists).
    const patientName = displayName(booking.patient.firstName, booking.patient.lastName);
    const notifiedCount = await notifyNearbyNurses(
      bookingData.patientLat,
      bookingData.patientLng,
      DISPATCH_RADIUS_KM,
      {
        id: booking.id,
        patientId: booking.patientId,
        scheduledDate: booking.scheduledDate,
        estimatedDuration: booking.estimatedDuration,
        amountInCents: booking.amountInCents,
      },
      patientName
    );

    // Ciphertext never goes back to the client (same as the GET routes).
    const { encryptedAddress: _addr, encryptedPatientLocation: _loc, ...bookingForClient } = booking;
    res.status(201).json({
      success: true,
      booking: { ...bookingForClient, address: safeDecrypt(_addr) },
      notifiedNurses: notifiedCount,
    });
  } catch (error) {
    return next(error);
  }
});

// Get user bookings
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const status = req.query.status as string | undefined;

    const whereClause: any = {};
    if (req.user!.role === UserRole.PATIENT) {
      whereClause.patientId = req.user!.id;
    } else if (req.user!.role === UserRole.NURSE) {
      whereClause.nurseId = req.user!.id;
    } else if (req.user!.role === UserRole.DOCTOR) {
      whereClause.doctorId = req.user!.id;
    }
    if (status) {
      whereClause.visit = { status: status };
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        visit: {
          select: {
            id: true, status: true, scheduledStart: true, actualStart: true, actualEnd: true,
            nurse: { select: { id: true, firstName: true, lastName: true, email: true } },
            doctor: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // AuditLog: Log booking list access
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'LIST',
      resource: 'Booking',
      metadata: { count: bookings.length, filter: { status }, role: req.user!.role },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Decrypt for every authorized viewer of this list (already scoped to
    // the requester's own bookings above) — previously the raw ciphertext
    // (encryptData's output) was sent straight to the client and rendered
    // as-is in the UI, instead of the actual visit address.
    const role = req.user!.role;
    const allowed = isClinicianRole(role)
      ? await patientsWithActiveAccess(req.user!.id, bookings.map((b) => b.patientId))
      : new Set<string>();
    const decryptedBookings = bookings.map((booking) => {
      if (role === UserRole.ADMIN) return restrictBooking(booking, 'ADMIN_VIEW');
      if (role !== UserRole.PATIENT && !allowed.has(booking.patientId)) return restrictBooking(booking, 'ACCESS_EXPIRED');
      const { encryptedAddress, encryptedPatientLocation: _loc, ...rest } = booking;
      return { ...rest, address: safeDecrypt(encryptedAddress) };
    });

    return res.json({ success: true, bookings: decryptedBookings });
  } catch (error: any) {
    console.error('[Bookings] Failed to fetch:', error?.message || error);
    return res.status(503).json({ success: false, error: 'Unable to load bookings. Database may be unavailable.' });
  }
});

// Get specific booking
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        visit: { include: { messages: { orderBy: { createdAt: 'desc' }, take: 10 } } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const isAuthorized =
      req.user!.role === UserRole.ADMIN ||
      booking.patientId === req.user!.id ||
      booking.nurseId === req.user!.id ||
      booking.doctorId === req.user!.id;
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const role = req.user!.role;
    if (role === UserRole.ADMIN) {
      await createAuditLog({ userId: req.user!.id, userRole: role, action: 'READ', resource: 'Booking', resourceId: booking.id, metadata: { view: 'ADMIN_VIEW' }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
      return res.json({ success: true, booking: restrictBooking(booking, 'ADMIN_VIEW') });
    }
    if (booking.patientId !== req.user!.id) {
      const check = await checkVerifiedClinician(req.user!.id);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      if (!(await hasActiveAccess(req.user!.id, booking.patientId))) {
        await auditAccessDenied(req, 'Booking', booking.id, booking.patientId);
        return res.status(403).json(NO_ACCESS_ERROR);
      }
    }

    // AuditLog: Log booking read access
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'READ',
      resource: 'Booking',
      resourceId: booking.id,
      metadata: { patientId: booking.patientId, nurseId: booking.nurseId, doctorId: booking.doctorId, status: booking.paymentStatus },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const { encryptedAddress, encryptedPatientLocation: _loc, ...bookingWithoutCiphertext } = booking;
    res.json({ success: true, booking: { ...bookingWithoutCiphertext, address: safeDecrypt(encryptedAddress) } });
  } catch (error) {
    return next(error);
  }
});

// Cancel booking
router.patch('/:id/cancel', requirePatient, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id }, include: { visit: true } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.patientId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
    if (booking.visit?.status && ['COMPLETED', 'CANCELLED'].includes(booking.visit.status)) {
      return res.status(400).json({ error: 'Cannot cancel completed or already cancelled visit' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id }, data: { paymentStatus: 'REFUNDED' } });
      if (booking.visit) {
        await tx.visit.update({ where: { id: booking.visit.id }, data: { status: 'CANCELLED' } });
      }
    });

    // Nothing accepted it yet, so nurses may still be looking at the offer.
    if (!booking.nurseId) withdrawBookingOffer(id);

    // AuditLog: Log booking cancellation
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'UPDATE',
      resource: 'Booking',
      resourceId: id,
      metadata: { oldStatus: 'PENDING', newStatus: 'REFUNDED', visitStatus: 'CANCELLED', reason: 'Patient cancelled' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (error) {
    return next(error);
  }
});

export default router;
