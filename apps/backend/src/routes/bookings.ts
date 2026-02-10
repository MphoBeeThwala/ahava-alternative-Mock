import { Router } from 'express';
import { PrismaClient, PaymentMethod, UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requirePatient } from '../middleware/auth';
import { encryptData } from '../utils/encryption';
import { notifyNearbyNurses } from '../services/websocket';
import Joi from 'joi';

const router = Router();
const prisma = new PrismaClient();

const createBookingSchema = Joi.object({
  encryptedAddress: Joi.string().required(),
  scheduledDate: Joi.date().iso().required(),
  estimatedDuration: Joi.number().min(30).max(240).default(60),
  paymentMethod: Joi.string().valid('CARD', 'INSURANCE').required(),
  amountInCents: Joi.number().min(0).required(),
  patientLat: Joi.number().min(-90).max(90).required(), // Patient location for nurse matching
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
});

// Create new booking (Patient only)
router.post('/', requirePatient, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = createBookingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const {
      encryptedAddress,
      scheduledDate,
      estimatedDuration,
      paymentMethod,
      amountInCents,
      patientLat,
      patientLng,
      insuranceProvider,
      insuranceMemberNumber,
    } = value;

    // Validate scheduled date is in the future
    const now = new Date();
    if (new Date(scheduledDate) <= now) {
      return res.status(400).json({ error: 'Scheduled date must be in the future' });
    }

    // Create booking
    const booking = await prisma.booking.create({
      data: {
        patientId: req.user!.id,
        encryptedAddress,
        scheduledDate: new Date(scheduledDate),
        estimatedDuration,
        paymentMethod,
        paymentStatus: 'PENDING',
        amountInCents,
        insuranceProvider,
        insuranceMemberNumber,
        insuranceStatus: paymentMethod === 'INSURANCE' ? 'PENDING_VERIFICATION' : undefined,
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

    // 🔔 Notify nearby online nurses about the new booking
    const patientName = `${booking.patient.firstName} ${booking.patient.lastName}`;
    const notifiedCount = await notifyNearbyNurses(
      patientLat,
      patientLng,
      10, // 10km radius
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

// Get user's bookings
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { status, limit = '10', offset = '0' } = req.query;

    const whereClause: any = {};

    if (req.user!.role === UserRole.PATIENT) {
      whereClause.patientId = req.user!.id;
    } else if (req.user!.role === UserRole.NURSE) {
      whereClause.nurseId = req.user!.id;
    } else if (req.user!.role === UserRole.DOCTOR) {
      whereClause.doctorId = req.user!.id;
    }

    if (status) {
      whereClause.visit = {
        status: status,
      };
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        visit: {
          select: {
            id: true,
            status: true,
            scheduledStart: true,
            actualStart: true,
            actualEnd: true,
            nurse: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            doctor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    res.json({
      success: true,
      bookings,
    });
  } catch (error) {
    next(error);
  }
});

// Get specific booking
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        nurse: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        visit: {
          include: {
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check permissions
    const isAuthorized =
      req.user!.role === UserRole.ADMIN ||
      booking.patientId === req.user!.id ||
      booking.nurseId === req.user!.id ||
      booking.doctorId === req.user!.id;

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      booking,
    });
  } catch (error) {
    next(error);
  }
});

// Cancel booking (Patient only)
router.patch('/:id/cancel', requirePatient, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { visit: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.patientId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (booking.visit?.status && ['COMPLETED', 'CANCELLED'].includes(booking.visit.status)) {
      return res.status(400).json({ error: 'Cannot cancel completed or already cancelled visit' });
    }

    // Update booking and visit status
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id },
        data: { paymentStatus: 'REFUNDED' },
      });

      if (booking.visit) {
        await tx.visit.update({
          where: { id: booking.visit.id },
          data: { status: 'CANCELLED' },
        });
      }
    });

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
