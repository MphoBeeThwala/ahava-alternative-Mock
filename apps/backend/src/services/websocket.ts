import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userRole?: string;
  isAlive?: boolean;
}

const clients = new Map<string, AuthenticatedWebSocket>();
const onlineNurses = new Map<string, { lat: number; lng: number }>(); // Track online nurses with location

export const initializeWebSocket = (wss: WebSocketServer) => {
  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    console.log('🔌 New WebSocket connection');

    // Heartbeat mechanism
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Authenticate connection
    const token = req.url?.split('token=')[1];

    if (!token || !process.env.JWT_SECRET) {
      ws.close(1008, 'Authentication required');
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
      ws.userId = decoded.userId;
      ws.userRole = decoded.role;

      // Store client connection
      clients.set(ws.userId, ws);

      console.log(`✅ WebSocket authenticated for user ${ws.userId}`);
    } catch (error) {
      console.error('❌ WebSocket authentication failed:', error);
      ws.close(1008, 'Invalid token');
      return;
    }

    // Handle messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message);
      } catch (error) {
        console.error('❌ WebSocket message error:', error);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      if (ws.userId) {
        clients.delete(ws.userId);
        onlineNurses.delete(ws.userId); // Remove from online nurses
        console.log(`🔌 WebSocket disconnected for user ${ws.userId}`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      if (ws.userId) {
        clients.delete(ws.userId);
        onlineNurses.delete(ws.userId);
      }
    });
  });

  // Heartbeat interval
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: AuthenticatedWebSocket) => {
      if (!ws.isAlive) {
        console.log('💔 Terminating dead WebSocket connection');
        if (ws.userId) {
          clients.delete(ws.userId);
          onlineNurses.delete(ws.userId);
        }
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // 30 seconds

  // Cleanup on server shutdown
  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  console.log('✅ WebSocket server initialized');
};

const handleWebSocketMessage = async (ws: AuthenticatedWebSocket, message: any) => {
  switch (message.type) {
    case 'LOCATION_UPDATE':
      await handleLocationUpdate(ws, message.data);
      break;
    case 'VISIT_STATUS_UPDATE':
      await handleVisitStatusUpdate(ws, message.data);
      break;
    case 'MESSAGE_TYPING':
      await handleTypingIndicator(ws, message.data);
      break;
    case 'NURSE_GO_ONLINE':
      await handleNurseGoOnline(ws, message.data);
      break;
    case 'NURSE_GO_OFFLINE':
      await handleNurseGoOffline(ws);
      break;
    case 'ACCEPT_BOOKING':
      await handleAcceptBooking(ws, message.data);
      break;
    case 'DECLINE_BOOKING':
      await handleDeclineBooking(ws, message.data);
      break;
    default:
      ws.send(JSON.stringify({ error: 'Unknown message type' }));
  }
};

// ===== NURSE ONLINE/OFFLINE HANDLERS =====

const handleNurseGoOnline = async (ws: AuthenticatedWebSocket, data: { lat: number; lng: number }) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    // Update database
    await prisma.user.update({
      where: { id: ws.userId },
      data: {
        isAvailable: true,
        lastKnownLat: data.lat,
        lastKnownLng: data.lng,
        lastLocationUpdate: new Date(),
      },
    });

    // Track in memory for fast lookup
    onlineNurses.set(ws.userId, { lat: data.lat, lng: data.lng });

    console.log(`🟢 Nurse ${ws.userId} is now ONLINE at (${data.lat}, ${data.lng})`);
    ws.send(JSON.stringify({ type: 'NURSE_ONLINE_SUCCESS' }));
  } catch (error) {
    console.error('❌ Nurse go online error:', error);
    ws.send(JSON.stringify({ error: 'Failed to go online' }));
  }
};

const handleNurseGoOffline = async (ws: AuthenticatedWebSocket) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    // Update database
    await prisma.user.update({
      where: { id: ws.userId },
      data: { isAvailable: false },
    });

    // Remove from tracking
    onlineNurses.delete(ws.userId);

    console.log(`🔴 Nurse ${ws.userId} is now OFFLINE`);
    ws.send(JSON.stringify({ type: 'NURSE_OFFLINE_SUCCESS' }));
  } catch (error) {
    console.error('❌ Nurse go offline error:', error);
    ws.send(JSON.stringify({ error: 'Failed to go offline' }));
  }
};

// ===== BOOKING ACCEPT/DECLINE HANDLERS =====

const handleAcceptBooking = async (ws: AuthenticatedWebSocket, data: { bookingId: string }) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    // Get booking and check it's still available
    const booking = await prisma.booking.findUnique({
      where: { id: data.bookingId },
      include: { patient: true },
    });

    if (!booking) {
      ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: 'Booking not found' }));
      return;
    }

    if (booking.nurseId) {
      ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: 'Booking already taken' }));
      return;
    }

    // Assign nurse to booking and create visit
    const [updatedBooking, visit] = await prisma.$transaction([
      prisma.booking.update({
        where: { id: data.bookingId },
        data: { nurseId: ws.userId },
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.visit.create({
        data: {
          bookingId: data.bookingId,
          nurseId: ws.userId,
          status: 'SCHEDULED',
          scheduledStart: booking.scheduledDate,
        },
      }),
    ]);

    console.log(`✅ Nurse ${ws.userId} accepted booking ${data.bookingId}`);

    // Notify the nurse (confirmation)
    ws.send(JSON.stringify({
      type: 'ACCEPT_BOOKING_SUCCESS',
      data: {
        bookingId: data.bookingId,
        visitId: visit.id,
        patient: updatedBooking.patient,
      },
    }));

    // Notify the patient
    const patientWs = clients.get(booking.patientId);
    if (patientWs && patientWs.readyState === WebSocket.OPEN) {
      const nurse = await prisma.user.findUnique({
        where: { id: ws.userId },
        select: { id: true, firstName: true, lastName: true, profileImage: true },
      });

      patientWs.send(JSON.stringify({
        type: 'BOOKING_ACCEPTED',
        data: {
          bookingId: data.bookingId,
          visitId: visit.id,
          nurse,
        },
      }));
    }

    // Notify other nurses that this booking is no longer available
    broadcastBookingTaken(data.bookingId, ws.userId);
  } catch (error) {
    console.error('❌ Accept booking error:', error);
    ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: 'Failed to accept booking' }));
  }
};

const handleDeclineBooking = async (ws: AuthenticatedWebSocket, data: { bookingId: string }) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Just acknowledge - we don't need to do anything in the database
  console.log(`⏭️ Nurse ${ws.userId} declined booking ${data.bookingId}`);
  ws.send(JSON.stringify({ type: 'DECLINE_BOOKING_SUCCESS' }));
};

// ===== LOCATION UPDATE (EXISTING) =====

const handleLocationUpdate = async (ws: AuthenticatedWebSocket, data: any) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    // Update nurse location in database
    await prisma.user.update({
      where: { id: ws.userId },
      data: {
        lastKnownLat: data.lat,
        lastKnownLng: data.lng,
        lastLocationUpdate: new Date(),
      },
    });

    // Update in-memory tracking if online
    if (onlineNurses.has(ws.userId)) {
      onlineNurses.set(ws.userId, { lat: data.lat, lng: data.lng });
    }

    // Broadcast location to relevant users (patients, doctors)
    const visit = await prisma.visit.findFirst({
      where: {
        nurseId: ws.userId,
        status: { in: ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
      },
      include: {
        booking: {
          include: { patient: true },
        },
      },
    });

    if (visit) {
      // Send location update to patient
      const patientWs = clients.get(visit.booking.patientId);
      if (patientWs && patientWs.readyState === WebSocket.OPEN) {
        patientWs.send(JSON.stringify({
          type: 'NURSE_LOCATION_UPDATE',
          data: {
            visitId: visit.id,
            lat: data.lat,
            lng: data.lng,
            timestamp: new Date().toISOString(),
          },
        }));
      }

      // Send location update to doctor if assigned
      if (visit.doctorId) {
        const doctorWs = clients.get(visit.doctorId);
        if (doctorWs && doctorWs.readyState === WebSocket.OPEN) {
          doctorWs.send(JSON.stringify({
            type: 'NURSE_LOCATION_UPDATE',
            data: {
              visitId: visit.id,
              nurseId: ws.userId,
              lat: data.lat,
              lng: data.lng,
              timestamp: new Date().toISOString(),
            },
          }));
        }
      }
    }

    ws.send(JSON.stringify({ type: 'LOCATION_UPDATE_SUCCESS' }));
  } catch (error) {
    console.error('❌ Location update error:', error);
    ws.send(JSON.stringify({ error: 'Failed to update location' }));
  }
};

const handleVisitStatusUpdate = async (ws: AuthenticatedWebSocket, data: any) => {
  if (!ws.userId || !['NURSE', 'DOCTOR', 'ADMIN'].includes(ws.userRole || '')) {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const visit = await prisma.visit.update({
      where: { id: data.visitId },
      data: { status: data.status },
      include: {
        booking: {
          include: { patient: true },
        },
      },
    });

    // Broadcast status update to all relevant parties
    const relevantUsers = [visit.booking.patientId];
    if (visit.doctorId) relevantUsers.push(visit.doctorId);

    relevantUsers.forEach(userId => {
      const userWs = clients.get(userId);
      if (userWs && userWs.readyState === WebSocket.OPEN) {
        userWs.send(JSON.stringify({
          type: 'VISIT_STATUS_CHANGED',
          data: {
            visitId: visit.id,
            status: data.status,
            timestamp: new Date().toISOString(),
          },
        }));
      }
    });

    ws.send(JSON.stringify({ type: 'VISIT_STATUS_UPDATE_SUCCESS' }));
  } catch (error) {
    console.error('❌ Visit status update error:', error);
    ws.send(JSON.stringify({ error: 'Failed to update visit status' }));
  }
};

const handleTypingIndicator = async (ws: AuthenticatedWebSocket, data: any) => {
  // Send typing indicator to recipient
  const recipientWs = clients.get(data.recipientId);
  if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
    recipientWs.send(JSON.stringify({
      type: 'TYPING_INDICATOR',
      data: {
        senderId: ws.userId,
        visitId: data.visitId,
        isTyping: data.isTyping,
      },
    }));
  }
};

// ===== HELPER FUNCTIONS =====

// Helper function to send message to specific user
export const sendToUser = (userId: string, message: any) => {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
};

// Helper function to broadcast to multiple users
export const broadcastToUsers = (userIds: string[], message: any) => {
  const results = userIds.map(userId => sendToUser(userId, message));
  return results.filter(Boolean).length;
};

// Broadcast that a booking has been taken
const broadcastBookingTaken = (bookingId: string, acceptedByNurseId: string) => {
  onlineNurses.forEach((_, nurseId) => {
    if (nurseId !== acceptedByNurseId) {
      const nurseWs = clients.get(nurseId);
      if (nurseWs && nurseWs.readyState === WebSocket.OPEN) {
        nurseWs.send(JSON.stringify({
          type: 'BOOKING_TAKEN',
          data: { bookingId },
        }));
      }
    }
  });
};

// Haversine formula for distance calculation
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Notify nearby online nurses about a new booking
export const notifyNearbyNurses = async (
  patientLat: number,
  patientLng: number,
  radiusKm: number,
  booking: {
    id: string;
    patientId: string;
    scheduledDate: Date;
    estimatedDuration: number;
    amountInCents: number;
  },
  patientName: string
) => {
  let notifiedCount = 0;

  onlineNurses.forEach((location, nurseId) => {
    const distance = getDistanceFromLatLonInKm(patientLat, patientLng, location.lat, location.lng);

    if (distance <= radiusKm) {
      const nurseWs = clients.get(nurseId);
      if (nurseWs && nurseWs.readyState === WebSocket.OPEN) {
        nurseWs.send(JSON.stringify({
          type: 'NEW_BOOKING_AVAILABLE',
          data: {
            bookingId: booking.id,
            patientName,
            scheduledDate: booking.scheduledDate.toISOString(),
            estimatedDuration: booking.estimatedDuration,
            amountInCents: booking.amountInCents,
            distanceKm: Math.round(distance * 10) / 10,
          },
        }));
        notifiedCount++;
        console.log(`📢 Notified nurse ${nurseId} about booking ${booking.id} (${distance.toFixed(1)}km away)`);
      }
    }
  });

  console.log(`📢 Notified ${notifiedCount} nurses about new booking ${booking.id}`);
  return notifiedCount;
};

// Get count of online nurses (for monitoring)
export const getOnlineNursesCount = () => onlineNurses.size;

