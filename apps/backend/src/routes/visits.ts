import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, VisitStatus, UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { encryptData } from '../utils/encryption';
import Joi from 'joi';

const router: Router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createVisitSchema = Joi.object({
  bookingId: Joi.string().required(),
  nurseId: Joi.string().required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED').required(),
});

const recordBiometricsSchema = Joi.object({
  bloodPressure: Joi.object({
    systolic: Joi.number().min(50).max(250).required(),
    diastolic: Joi.number().min(30).max(150).required(),
  }).optional(),
  heartRate: Joi.number().min(30).max(220).optional(),
  temperature: Joi.number().min(30).max(45).optional(), // Celsius
  oxygenSaturation: Joi.number().min(0).max(100).optional(), // Percentage
  weight: Joi.number().min(0).max(500).optional(), // kg
  height: Joi.number().min(0).max(300).optional(), // cm
  glucose: Joi.number().min(0).max(600).optional(), // mg/dL
});

const recordTreatmentSchema = Joi.object({
  medications: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      dosage: Joi.string().required(),
      frequency: Joi.string().required(),
    })
  ).optional(),
  procedures: Joi.array().items(Joi.string()).optional(),
  notes: Joi.string().optional(),
});

const recordNurseReportSchema = Joi.object({
  report: Joi.string().required(),
});

// Create visit from booking (assigns nurse)
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error, value } = createVisitSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { bookingId, nurseId } = value;

    // Verify user has permission (must be nurse assigning themselves, or admin/doctor)
    if (req.user!.role === UserRole.NURSE && req.user!.id !== nurseId) {
      return res.status(403).json({ error: 'Nurses can only assign themselves to visits' });
    }

    // Check if booking exists and get its details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { patient: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check if visit already exists for this booking
    const existingVisit = await prisma.visit.findUnique({
      where: { bookingId },
    });

    if (existingVisit) {
      return res.status(400).json({ error: 'Visit already exists for this booking' });
    }

    // Verify nurse exists and is a nurse
    const nurse = await prisma.user.findUnique({
      where: { id: nurseId },
    });

    if (!nurse || nurse.role !== UserRole.NURSE) {
      return res.status(400).json({ error: 'Invalid nurse ID' });
    }

    // Update booking with nurse assignment and create visit in transaction
    const [updatedBooking, visit] = await prisma.$transaction([
      prisma.booking.update({
        where: { id: bookingId },
        data: { nurseId },
      }),
      prisma.visit.create({
        data: {
          bookingId,
          nurseId,
          status: VisitStatus.SCHEDULED,
          scheduledStart: booking.scheduledDate,
        },
        include: {
          booking: {
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
        },
      }),
    ]);

    res.status(201).json({
      success: true,
      visit,
      message: 'Visit created and nurse assigned successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Get all visits (filtered by user role)
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const whereClause: any = {};

    // Filter by user role
    if (req.user!.role === UserRole.PATIENT) {
      whereClause.booking = { patientId: req.user!.id };
    } else if (req.user!.role === UserRole.NURSE) {
      whereClause.nurseId = req.user!.id;
    } else if (req.user!.role === UserRole.DOCTOR) {
      whereClause.doctorId = req.user!.id;
    }
    // Admin can see all visits

    const visits = await prisma.visit.findMany({
      where: whereClause,
      include: {
        booking: {
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
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, visits });
  } catch (error) {
    next(error);
  }
});

// Get single visit by ID
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const visit = await prisma.visit.findUnique({
      where: { id: req.params.id },
      include: {
        booking: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                dateOfBirth: true,
                gender: true,
              },
            },
          },
        },
        nurse: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
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
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions
    if (req.user!.role === UserRole.PATIENT && visit.booking.patientId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user!.role === UserRole.NURSE && visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user!.role === UserRole.DOCTOR && visit.doctorId && visit.doctorId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ success: true, visit });
  } catch (error) {
    next(error);
  }
});

// Update visit status
router.patch('/:id/status', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error, value } = updateStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { status } = value;
    const visitId = req.params.id;

    // Get current visit
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions (nurse can update their own visits)
    if (req.user!.role === UserRole.NURSE && visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update status and timestamps based on status
    const updateData: any = { status };

    if (status === VisitStatus.EN_ROUTE && !visit.actualStart) {
      // Could add enRouteAt timestamp if needed
    } else if (status === VisitStatus.ARRIVED && !visit.actualStart) {
      updateData.actualStart = new Date();
    } else if (status === VisitStatus.IN_PROGRESS && !visit.actualStart) {
      updateData.actualStart = new Date();
    } else if (status === VisitStatus.COMPLETED && !visit.actualEnd) {
      updateData.actualEnd = new Date();
    }

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: updateData,
      include: {
        booking: {
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
        },
        nurse: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    res.json({ success: true, visit: updatedVisit });
  } catch (error) {
    next(error);
  }
});

// Record biometrics
router.post('/:id/biometrics', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error, value } = recordBiometricsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const visitId = req.params.id;

    // Get current visit
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions (nurse can record biometrics for their visits)
    if (req.user!.role === UserRole.NURSE && visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get existing biometrics or initialize
    const existingBiometrics = (visit.biometrics as any) || [];
    
    // Add new biometric reading with timestamp
    const newReading = {
      ...value,
      timestamp: new Date().toISOString(),
    };

    const updatedBiometrics = [...existingBiometrics, newReading];

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: {
        biometrics: updatedBiometrics,
      },
      include: {
        booking: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    res.json({
      success: true,
      visit: updatedVisit,
      message: 'Biometrics recorded successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Record treatment
router.post('/:id/treatment', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error, value } = recordTreatmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const visitId = req.params.id;

    // Get current visit
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions (nurse can record treatment for their visits)
    if (req.user!.role === UserRole.NURSE && visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create treatment record with timestamp
    const treatmentData = {
      ...value,
      timestamp: new Date().toISOString(),
    };

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: {
        treatment: treatmentData,
      },
      include: {
        booking: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    res.json({
      success: true,
      visit: updatedVisit,
      message: 'Treatment recorded successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Record nurse report
router.post('/:id/nurse-report', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error, value } = recordNurseReportSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { report } = value;
    const visitId = req.params.id;

    // Get current visit
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions (only nurse assigned to visit can submit report)
    if (req.user!.role !== UserRole.NURSE || visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Only the assigned nurse can submit a report' });
    }

    // Encrypt the report
    const encryptedReport = encryptData(report);

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: {
        nurseReport: encryptedReport,
      },
      include: {
        booking: {
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        nurse: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    res.json({
      success: true,
      visit: updatedVisit,
      message: 'Nurse report submitted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Update visit (general update)
router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const visitId = req.params.id;

    // Get current visit
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    // Check permissions
    if (req.user!.role === UserRole.NURSE && visit.nurseId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Allow updating doctor assignment, GPS coordinates, etc.
    const allowedUpdates: any = {};
    
    if (req.body.doctorId !== undefined) {
      allowedUpdates.doctorId = req.body.doctorId;
    }
    
    if (req.body.gpsCoordinates !== undefined) {
      allowedUpdates.gpsCoordinates = req.body.gpsCoordinates;
    }

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: allowedUpdates,
      include: {
        booking: {
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
      },
    });

    res.json({ success: true, visit: updatedVisit });
  } catch (error) {
    next(error);
  }
});

export default router;
