import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import crypto from 'crypto';
import prisma from '../lib/prisma';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userRole?: string;
  isAlive?: boolean;
}

const clients = new Map<string, AuthenticatedWebSocket>();
const onlineNurses = new Map<string, { lat: number; lng: number }>(); // Track online nurses with location

const INSTANCE_ID = process.env.INSTANCE_ID ?? crypto.randomUUID();
const WS_CHANNEL = process.env.WS_REDIS_CHANNEL ?? 'ws:events';
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;
let redisReady = false;

type WsEvent =
  | { instanceId: string; type: 'sendToUser'; userId: string; message: any }
  | { instanceId: string; type: 'broadcastToUsers'; userIds: string[]; message: any }
  | {
      instanceId: string;
      type: 'bookingAvailable';
      patientLat: number;
      patientLng: number;
      radiusKm: number;
      booking: {
        id: string;
        patientId: string;
        scheduledDate: string;
        estimatedDuration: number;
        amountInCents: number;
      };
      patientName: string;
    }
  | { instanceId: string; type: 'bookingTaken'; bookingId: string; acceptedByNurseId: string };

const publishEvent = (event: WsEvent) => {
  if (!redisReady || !redisPub) return;
  redisPub.publish(WS_CHANNEL, JSON.stringify(event)).catch((err) => {
    console.warn('[ws] redis publish failed:', (err as Error)?.message ?? err);
  });
};

const normalizeRedisUrl = (raw?: string): string | null => {
  if (!raw) return null;
  const decoded = raw.includes('%20') ? raw.replace(/%20/g, ' ') : raw;
  const trimmed = decoded.trim();
  const match = trimmed.match(/(rediss?:\/\/\S+)/);
  if (!match) return null;
  const url = match[1];
  try {
    const u = new URL(url);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
    return url;
  } catch {
    return null;
  }
};

const ensureRedisPubSub = async () => {
  if (redisReady) return;
  const url = normalizeRedisUrl(process.env.REDIS_URL);
  if (!url) {
    const raw = process.env.REDIS_URL;
    if (raw) console.warn('[ws] invalid REDIS_URL; disabling redis pub/sub');
    return;
  }
  const pub = new Redis(url, { connectTimeout: 3000, maxRetriesPerRequest: null, lazyConnect: true });
  const sub = new Redis(url, { connectTimeout: 3000, maxRetriesPerRequest: null, lazyConnect: true });
  pub.on('error', (err) => {
    console.warn('[ws] redis pub error:', (err as Error)?.message ?? err);
  });
  sub.on('error', (err) => {
    console.warn('[ws] redis sub error:', (err as Error)?.message ?? err);
  });
  await pub.connect();
  await sub.connect();
  await sub.subscribe(WS_CHANNEL);
  sub.on('message', (_channel, payload) => {
    try {
      const evt = JSON.parse(payload) as WsEvent;
      if (!evt?.type || evt.instanceId === INSTANCE_ID) return;
      if (evt.type === 'sendToUser') {
        deliverToUserLocal(evt.userId, evt.message);
        return;
      }
      if (evt.type === 'broadcastToUsers') {
        evt.userIds.forEach((id) => deliverToUserLocal(id, evt.message));
        return;
      }
      if (evt.type === 'bookingTaken') {
        broadcastBookingTakenLocal(evt.bookingId, evt.acceptedByNurseId);
        return;
      }
      if (evt.type === 'bookingAvailable') {
        notifyNearbyNursesLocal(
          evt.patientLat,
          evt.patientLng,
          evt.radiusKm,
          {
            ...evt.booking,
            scheduledDate: new Date(evt.booking.scheduledDate),
          },
          evt.patientName
        );
        return;
      }
    } catch (err) {
      console.warn('[ws] redis message parse failed:', (err as Error)?.message ?? err);
    }
  });
  redisPub = pub;
  redisSub = sub;
  redisReady = true;
  console.log('✅ WebSocket Redis pub/sub enabled');
};

export const initializeWebSocket = (wss: WebSocketServer) => {
  void ensureRedisPubSub().catch((err) => {
    console.warn('[ws] redis pub/sub unavailable:', (err as Error)?.message ?? err);
  });

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
    const pub = redisPub;
    const sub = redisSub;
    redisPub = null;
    redisSub = null;
    redisReady = false;
    void pub?.quit().catch(() => {});
    void sub?.quit().catch(() => {});
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
    const nurse = await prisma.user.findUnique({
      where: { id: ws.userId },
      select: { id: true, firstName: true, lastName: true, profileImage: true },
    });
    sendToUser(booking.patientId, {
      type: 'BOOKING_ACCEPTED',
      data: {
        bookingId: data.bookingId,
        visitId: visit.id,
        nurse,
      },
    });

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
      sendToUser(visit.booking.patientId, {
        type: 'NURSE_LOCATION_UPDATE',
        data: {
          visitId: visit.id,
          lat: data.lat,
          lng: data.lng,
          timestamp: new Date().toISOString(),
        },
      });

      // Send location update to doctor if assigned
      if (visit.doctorId) {
        sendToUser(visit.doctorId, {
          type: 'NURSE_LOCATION_UPDATE',
          data: {
            visitId: visit.id,
            nurseId: ws.userId,
            lat: data.lat,
            lng: data.lng,
            timestamp: new Date().toISOString(),
          },
        });
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
    broadcastToUsers(relevantUsers, {
      type: 'VISIT_STATUS_CHANGED',
      data: {
        visitId: visit.id,
        status: data.status,
        timestamp: new Date().toISOString(),
      },
    });

    ws.send(JSON.stringify({ type: 'VISIT_STATUS_UPDATE_SUCCESS' }));
  } catch (error) {
    console.error('❌ Visit status update error:', error);
    ws.send(JSON.stringify({ error: 'Failed to update visit status' }));
  }
};

const handleTypingIndicator = async (ws: AuthenticatedWebSocket, data: any) => {
  // Send typing indicator to recipient
  sendToUser(data.recipientId, {
    type: 'TYPING_INDICATOR',
    data: {
      senderId: ws.userId,
      visitId: data.visitId,
      isTyping: data.isTyping,
    },
  });
};

// ===== HELPER FUNCTIONS =====

// Helper function to send message to specific user
const deliverToUserLocal = (userId: string, message: any) => {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
};

export const sendToUser = (userId: string, message: any) => {
  const delivered = deliverToUserLocal(userId, message);
  publishEvent({ instanceId: INSTANCE_ID, type: 'sendToUser', userId, message });
  return delivered;
};

// Helper function to broadcast to multiple users
export const broadcastToUsers = (userIds: string[], message: any) => {
  const delivered = userIds.map((userId) => deliverToUserLocal(userId, message)).filter(Boolean).length;
  publishEvent({ instanceId: INSTANCE_ID, type: 'broadcastToUsers', userIds, message });
  return delivered;
};

// Broadcast that a booking has been taken
const broadcastBookingTakenLocal = (bookingId: string, acceptedByNurseId: string) => {
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

const broadcastBookingTaken = (bookingId: string, acceptedByNurseId: string) => {
  broadcastBookingTakenLocal(bookingId, acceptedByNurseId);
  publishEvent({ instanceId: INSTANCE_ID, type: 'bookingTaken', bookingId, acceptedByNurseId });
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

const notifyNearbyNursesLocal = (
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
      const delivered = deliverToUserLocal(nurseId, {
          type: 'NEW_BOOKING_AVAILABLE',
          data: {
            bookingId: booking.id,
            patientName,
            scheduledDate: booking.scheduledDate.toISOString(),
            estimatedDuration: booking.estimatedDuration,
            amountInCents: booking.amountInCents,
            distanceKm: Math.round(distance * 10) / 10,
          },
        });
      if (delivered) {
        notifiedCount += 1;
        console.log(`📢 Notified nurse ${nurseId} about booking ${booking.id} (${distance.toFixed(1)}km away)`);
      }
    }
  });

  console.log(`📢 Notified ${notifiedCount} nurses about new booking ${booking.id}`);
  return notifiedCount;
};

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
  const notifiedCount = notifyNearbyNursesLocal(patientLat, patientLng, radiusKm, booking, patientName);
  publishEvent({
    instanceId: INSTANCE_ID,
    type: 'bookingAvailable',
    patientLat,
    patientLng,
    radiusKm,
    booking: {
      id: booking.id,
      patientId: booking.patientId,
      scheduledDate: booking.scheduledDate.toISOString(),
      estimatedDuration: booking.estimatedDuration,
      amountInCents: booking.amountInCents,
    },
    patientName,
  });
  return notifiedCount;
};

// Get count of online nurses (for monitoring)
export const getOnlineNursesCount = () => onlineNurses.size;

