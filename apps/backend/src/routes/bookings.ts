import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requirePatient } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { notifyNearbyNurses } from '../services/websocket';
import { encryptData, isEncryptedPayload } from '../utils/encryption';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import Joi from 'joi';
import prisma from '../lib/prisma';

const router: Router = Router();

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

    const patientName = booking.patient.firstName + ' ' + booking.patient.lastName;
    const notifiedCount = await notifyNearbyNurses(
      bookingData.patientLat,
      bookingData.patientLng,
      10,
      {
        id: booking.id,
        patientId: booking.patientId,
        scheduledDate: booking.scheduledDate,
        estimatedDuration: booking.estimatedDuration,
        amountInCents: booking.amountInCents,
      },
      patientName
    );

    res.status(201).json({
      success: true,
      booking,
      notifiedNurses: notifiedCount,
    });
  } catch (error) {
    next(error);
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

    res.json({ success: true, bookings });
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

    res.json({ success: true, booking });
  } catch (error) {
    next(error);
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
    next(error);
  }
});

export default router;
