import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { writeClinicalAudit } from '../services/clinicalAudit';
import prisma from '../lib/prisma';

const router: Router = Router();

// Create a new message
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = req as AuthenticatedRequest;
    const message = await prisma.message.create({
      data: req.body,
    });
    
    // Audit log for message creation
    await writeClinicalAudit({
      userId: r.user?.id,
      userRole: r.user?.role,
      action: 'MESSAGE_CREATED',
      resource: 'message',
      resourceId: message.id,
      metadata: {
        senderId: message.senderId,
        recipientId: message.recipientId,
        visitId: message.visitId,
      },
    });
    
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
});

// Get all messages
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
    const r = req as AuthenticatedRequest;
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const visitId = (req.query.visitId as string | undefined) || undefined;

    const where: any = {};
    if (visitId) where.visitId = visitId;

    if (r.user?.role !== 'ADMIN') {
      where.OR = [
        { senderId: r.user!.id },
        { recipientId: r.user!.id },
      ];
    }

		const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    
    // Audit log for message access
    await writeClinicalAudit({
      userId: r.user?.id,
      userRole: r.user?.role,
      action: 'MESSAGES_LISTED',
      resource: 'message',
      metadata: {
        count: messages.length,
        filters: { visitId, limit, offset },
      },
    });
		res.json({ success: true, messages, meta: { limit, offset } });
	} catch (error) {
		next(error);
	}
});

// Get a single message by ID
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = req as AuthenticatedRequest;
    const message = await prisma.message.findUnique({
      where: { id: req.params.id },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    
    // Check permissions - user must be sender or recipient
    if (message.senderId !== r.user!.id && message.recipientId !== r.user!.id && r.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    
    // Audit log for message access
    await writeClinicalAudit({
      userId: r.user?.id,
      userRole: r.user?.role,
      action: 'MESSAGE_READ',
      resource: 'message',
      resourceId: message.id,
      metadata: {
        senderId: message.senderId,
        recipientId: message.recipientId,
      },
    });
    
    res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
});

// Update a message
router.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
    const r = req as AuthenticatedRequest;
		const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
    });
    
    if (!existing) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    
    // Check permissions - only sender can update
    if (existing.senderId !== r.user!.id && r.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
		const message = await prisma.message.update({
			where: { id: req.params.id },
			data: req.body,
		});
    
    // Audit log for message update
    await writeClinicalAudit({
      userId: r.user?.id,
      userRole: r.user?.role,
      action: 'MESSAGE_UPDATED',
      resource: 'message',
      resourceId: message.id,
    });
		res.json({ success: true, message });
	} catch (error) {
		next(error);
	}
});

// Delete a message
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = req as AuthenticatedRequest;
    const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
    });
    
    if (!existing) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    
    // Check permissions - only sender can delete
    if (existing.senderId !== r.user!.id && r.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    
    await prisma.message.delete({ where: { id: req.params.id } });
    
    // Audit log for message deletion
    await writeClinicalAudit({
      userId: r.user?.id,
      userRole: r.user?.role,
      action: 'MESSAGE_DELETED',
      resource: 'message',
      resourceId: req.params.id,
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
