import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import { REDIS_NETWORK_OPTIONS } from './redis';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { verifyWebSocketTicket } from './authSession';
import { decryptPatientLocation } from '../utils/encryption';
import { ACCESS_WINDOWS, checkVerifiedClinician, displayName, hasActiveAccess, syncVisitGrant } from './careAccess';
import { isVisitStatus, visitTimingFor, visitTransitionError } from './visitStatus';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userRole?: string;
  isAlive?: boolean;
  authTimeout?: ReturnType<typeof setTimeout>;
}

const clients = new Map<string, AuthenticatedWebSocket>();
const onlineNurses = new Map<string, { lat: number; lng: number }>(); // Track online nurses with location

export const isValidCoordinate = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/**
 * Forget a socket, but only if it is still the one registered for its user.
 * `clients` holds one socket per user, so when a nurse opened a second tab
 * (or the page reconnected) and the *old* socket closed afterwards, the old
 * close handler deleted the new registration too — silently taking an
 * online nurse off the dispatch radar while their screen still said online.
 */
const dropSocket = (ws: AuthenticatedWebSocket) => {
  if (!ws.userId || clients.get(ws.userId) !== ws) return;
  clients.delete(ws.userId);
  if (onlineNurses.delete(ws.userId)) scheduleStaleOffline(ws.userId);
};

/** REST "go offline" (routes/nurse.ts) — stop dispatching to this nurse from this replica. */
export const markNurseOffline = (userId: string) => {
  onlineNurses.delete(userId);
  cancelStaleOffline(userId);
};

/** Radius, in km, within which a nurse is offered a booking. */
export const DISPATCH_RADIUS_KM = 10;

// ===== STALE AVAILABILITY =====
//
// User.isAvailable used to stay true forever once a nurse's socket dropped
// without an explicit "go offline" (app killed, phone out of signal), so
// anything reading it overstated who could actually be dispatched. Clearing
// it immediately would flip a nurse offline on every page reload, so it's
// cleared only after a grace period, and only if the nurse hasn't
// re-registered anywhere since: NURSE_GO_ONLINE and LOCATION_UPDATE both
// bump lastLocationUpdate, on whichever replica the nurse reconnected to,
// so the conditional write below is safe across replicas.
const staleOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();

const offlineGraceMs = () => {
  const n = Number(process.env.NURSE_OFFLINE_GRACE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 120_000;
};

const cancelStaleOffline = (userId: string) => {
  const t = staleOfflineTimers.get(userId);
  if (t) clearTimeout(t);
  staleOfflineTimers.delete(userId);
};

const scheduleStaleOffline = (userId: string) => {
  cancelStaleOffline(userId);
  const droppedAt = new Date();
  const timer = setTimeout(() => {
    staleOfflineTimers.delete(userId);
    if (onlineNurses.has(userId)) return;
    prisma.user
      .updateMany({
        where: { id: userId, isAvailable: true, lastLocationUpdate: { lte: droppedAt } },
        data: { isAvailable: false },
      })
      .then(({ count }) => {
        if (count) console.log(`🔴 Nurse ${userId} marked unavailable after disconnect grace period`);
      })
      .catch((err) => console.warn('[ws] stale-offline update failed:', (err as Error)?.message ?? err));
  }, offlineGraceMs());
  timer.unref?.();
  staleOfflineTimers.set(userId, timer);
};

// ===== DECLINES =====
//
// Which nurses passed on (or let expire) which booking, so a booking
// re-offered when a nurse comes online isn't shown again to someone who
// already said no. In memory and per replica, like onlineNurses; pruned in
// the heartbeat.
const declinedBy = new Map<string, { nurses: Set<string>; at: number }>();
const DECLINE_TTL_MS = 24 * 3600_000;

const recordDecline = (bookingId: string, nurseId: string) => {
  const entry = declinedBy.get(bookingId) ?? { nurses: new Set<string>(), at: Date.now() };
  entry.nurses.add(nurseId);
  entry.at = Date.now();
  declinedBy.set(bookingId, entry);
};

const hasDeclined = (bookingId: string, nurseId: string) =>
  declinedBy.get(bookingId)?.nurses.has(nurseId) ?? false;

const INSTANCE_ID = process.env.INSTANCE_ID ?? crypto.randomUUID();
const WS_CHANNEL = process.env.WS_REDIS_CHANNEL ?? 'ws:events';
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;
let redisReady = false;
let warnedPublishFallback = false;
// AH-08: lets middleware/auth.ts hear about a deactivation/role-change on
// *other* replicas without middleware/auth.ts needing to know anything
// about WebSockets or Redis pub/sub itself.
let authCacheInvalidationHandler: ((userId: string) => void) | null = null;

type WsEvent =
  | { instanceId: string; type: 'sendToUser'; userId: string; message: any }
  | { instanceId: string; type: 'broadcastToUsers'; userIds: string[]; message: any }
  | { instanceId: string; type: 'authCacheInvalidate'; userId: string }
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
  if (!redisReady || !redisPub) {
    if (!warnedPublishFallback) {
      warnedPublishFallback = true;
      console.warn('[ws] Redis pub/sub unavailable; cross-instance WebSocket delivery is disabled and clients on other replicas will rely on polling');
    }
    return;
  }
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
    if (raw) {
      console.error('[ws] CRITICAL: invalid REDIS_URL; WebSocket cross-instance pub/sub is disabled');
    } else {
      console.warn('[ws] WARNING: REDIS_URL not set; WebSocket cross-instance delivery is disabled and multi-replica deployments will fall back to polling');
    }
    return;
  }
  const pub = new Redis(url, { ...REDIS_NETWORK_OPTIONS, connectTimeout: 3000, maxRetriesPerRequest: null, lazyConnect: true });
  const sub = new Redis(url, { ...REDIS_NETWORK_OPTIONS, connectTimeout: 3000, maxRetriesPerRequest: null, lazyConnect: true });
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
      if (evt.type === 'authCacheInvalidate') {
        authCacheInvalidationHandler?.(evt.userId);
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
  warnedPublishFallback = false;
  console.log('✅ WebSocket Redis pub/sub enabled');
};

export function getWebSocketRedisHealth() {
  return {
    redisConfigured: Boolean(normalizeRedisUrl(process.env.REDIS_URL)),
    redisReady,
    redisPub: Boolean(redisPub && redisReady),
    redisSub: Boolean(redisSub && redisReady),
  };
}

export const initializeWebSocket = (wss: WebSocketServer) => {
  void ensureRedisPubSub().catch((err) => {
    console.error(
      '[ws] CRITICAL: redis pub/sub unavailable; cross-instance WebSocket delivery is degraded:',
      (err as Error)?.message ?? err,
    );
  });

  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    console.log('🔌 New WebSocket connection');

    // Heartbeat mechanism
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.authTimeout = setTimeout(() => {
      ws.close(1008, 'Authentication timeout');
    }, 5000);

    // Handle messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (!ws.userId) {
          const ticket =
            typeof message?.data?.ticket === 'string' ? message.data.ticket : null;
          if (message?.type !== 'AUTH' || !ticket) {
            ws.close(1008, 'Authentication required');
            return;
          }

          const decoded = verifyWebSocketTicket(ticket);
          ws.userId = decoded.userId;
          ws.userRole = decoded.role;
          clients.set(ws.userId, ws);
          if (ws.authTimeout) {
            clearTimeout(ws.authTimeout);
            ws.authTimeout = undefined;
          }
          ws.send(JSON.stringify({ type: 'AUTHENTICATED' }));
          console.log(`✅ WebSocket authenticated for user ${ws.userId}`);
          return;
        }

        await handleWebSocketMessage(ws, message);
      } catch (error) {
        if (!ws.userId) {
          console.error('❌ WebSocket authentication failed:', error);
          ws.close(1008, 'Invalid authentication');
          return;
        }

        console.error('❌ WebSocket message error:', error);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = undefined;
      }
      if (ws.userId) {
        dropSocket(ws);
        console.log(`🔌 WebSocket disconnected for user ${ws.userId}`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = undefined;
      }
      dropSocket(ws);
    });
  });

  // Heartbeat interval
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: AuthenticatedWebSocket) => {
      if (!ws.isAlive) {
        console.log('💔 Terminating dead WebSocket connection');
        dropSocket(ws);
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
    const cutoff = Date.now() - DECLINE_TTL_MS;
    declinedBy.forEach((entry, bookingId) => {
      if (entry.at < cutoff) declinedBy.delete(bookingId);
    });
  }, 30000); // 30 seconds

  // Cleanup on server shutdown
  wss.on('close', () => {
    clearInterval(heartbeat);
    staleOfflineTimers.forEach((t) => clearTimeout(t));
    staleOfflineTimers.clear();
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

  if (!isValidCoordinate(data?.lat, data?.lng)) {
    ws.send(JSON.stringify({ type: 'NURSE_ONLINE_FAILED', error: 'A valid location is required to go online' }));
    return;
  }

  // Only nurses with a verified SANC registration are dispatched to patients.
  const credential = await checkVerifiedClinician(ws.userId);
  if (!credential.ok) {
    ws.send(JSON.stringify({ type: 'NURSE_ONLINE_FAILED', error: credential.error, code: credential.code }));
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
    cancelStaleOffline(ws.userId);

    console.log(`🟢 Nurse ${ws.userId} is now ONLINE at (${data.lat}, ${data.lng})`);
    ws.send(JSON.stringify({ type: 'NURSE_ONLINE_SUCCESS' }));

    await offerOpenBookings(ws.userId, data.lat, data.lng);
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
    markNurseOffline(ws.userId);

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

  if (typeof data?.bookingId !== 'string' || !data.bookingId) {
    ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: 'bookingId is required' }));
    return;
  }

  // Offers only go to nurses who are online on the dispatch radar; without
  // this any nurse account holding a booking id could claim it.
  if (!onlineNurses.has(ws.userId)) {
    ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: 'Go online before accepting visits' }));
    return;
  }
  // Re-checked here, not just at go-online: a registration can be revoked
  // while a nurse is still online.
  const credential = await checkVerifiedClinician(ws.userId);
  if (!credential.ok) {
    markNurseOffline(ws.userId);
    ws.send(JSON.stringify({ type: 'ACCEPT_BOOKING_FAILED', error: credential.error, code: credential.code }));
    return;
  }

  const nurseId = ws.userId;
  try {
    // Claim atomically. The old read-then-write let two nurses who tapped
    // Accept at the same moment both pass the "nurseId is null" check; the
    // loser then hit the unique Visit.bookingId constraint and got a vague
    // "Failed to accept booking" instead of "already taken". It also let a
    // nurse accept a booking the patient had already cancelled.
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: {
          id: data.bookingId,
          nurseId: null,
          paymentStatus: { not: 'REFUNDED' }, // bookings.ts cancel marks REFUNDED
          scheduledDate: { gt: new Date() },
        },
        data: { nurseId },
      });
      if (count === 0) return null;
      const updatedBooking = await tx.booking.findUniqueOrThrow({
        where: { id: data.bookingId },
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      });
      const visit = await tx.visit.create({
        data: {
          bookingId: data.bookingId,
          nurseId,
          status: 'SCHEDULED',
          scheduledStart: updatedBooking.scheduledDate,
        },
      });
      // Accepting is what gives the nurse access to this one patient's
      // record: until the visit, then syncVisitGrant keeps it in step with
      // the visit and winds it down after completion (services/careAccess.ts).
      const from = Math.max(updatedBooking.scheduledDate.getTime(), Date.now());
      await tx.patientAccessGrant.create({
        data: {
          clinicianId: nurseId,
          patientId: updatedBooking.patientId,
          reason: 'VISIT_ASSIGNMENT',
          sourceId: visit.id,
          expiresAt: new Date(from + ACCESS_WINDOWS.visitFromScheduledStartHours * 3600_000),
        },
      });
      return { updatedBooking, visit };
    });

    if (!claimed) {
      const exists = await prisma.booking.findUnique({ where: { id: data.bookingId }, select: { id: true } });
      ws.send(JSON.stringify({
        type: 'ACCEPT_BOOKING_FAILED',
        error: exists ? 'Booking already taken or no longer available' : 'Booking not found',
      }));
      return;
    }
    const { updatedBooking, visit } = claimed;
    const booking = updatedBooking;

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

  if (typeof data?.bookingId === 'string') recordDecline(data.bookingId, ws.userId);
  console.log(`⏭️ Nurse ${ws.userId} declined booking ${data.bookingId}`);
  ws.send(JSON.stringify({ type: 'DECLINE_BOOKING_SUCCESS' }));
};

// ===== LOCATION UPDATE (EXISTING) =====

const handleLocationUpdate = async (ws: AuthenticatedWebSocket, data: any) => {
  if (!ws.userId || ws.userRole !== 'NURSE') {
    ws.send(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!isValidCoordinate(data?.lat, data?.lng)) {
    ws.send(JSON.stringify({ error: 'Invalid location' }));
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
      cancelStaleOffline(ws.userId);
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
  if (typeof data?.visitId !== 'string' || !isVisitStatus(data?.status)) {
    ws.send(JSON.stringify({ error: 'Invalid visit status update' }));
    return;
  }

  try {
    const existing = await prisma.visit.findUnique({
      where: { id: data.visitId },
      include: { booking: { select: { patientId: true } } },
    });
    // Previously this updated any visit id it was given — any nurse or
    // doctor socket could change the status of a visit that wasn't theirs.
    const isAdmin = ws.userRole === 'ADMIN';
    const isAssigned = existing && (existing.nurseId === ws.userId || existing.doctorId === ws.userId);
    if (!existing || (!isAdmin && !isAssigned)) {
      ws.send(JSON.stringify({ error: 'Visit not found' }));
      return;
    }
    if (!isAdmin) {
      const credential = await checkVerifiedClinician(ws.userId);
      if (!credential.ok || !(await hasActiveAccess(ws.userId, existing.booking.patientId))) {
        ws.send(JSON.stringify({ error: 'You do not currently have access to this patient\u2019s record.' }));
        return;
      }
    }
    const transitionError = visitTransitionError(existing.status, data.status, isAdmin);
    if (transitionError) {
      ws.send(JSON.stringify({ error: transitionError }));
      return;
    }
    const { count } = await prisma.visit.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: data.status, ...visitTimingFor(data.status) },
    });
    if (count === 0) {
      ws.send(JSON.stringify({ error: 'Visit status changed in the meantime' }));
      return;
    }
    await syncVisitGrant(existing, data.status);

    // Broadcast status update to all relevant parties
    const relevantUsers = [existing.booking.patientId];
    if (existing.doctorId) relevantUsers.push(existing.doctorId);
    broadcastToUsers(relevantUsers, {
      type: 'VISIT_STATUS_CHANGED',
      data: {
        visitId: existing.id,
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

/**
 * AH-08: middleware/auth.ts calls this after invalidating its own local
 * cache entry, so every *other* replica hears about it too — without this,
 * a deactivated/role-changed user stayed authenticated on any replica whose
 * in-process cache hadn't independently expired (up to
 * AUTH_USER_CACHE_TTL_SECONDS, 300s by default). Same graceful-without-Redis
 * behaviour as the rest of this file: if pub/sub isn't configured, this is a
 * no-op and each replica just falls back to its own TTL, exactly like today.
 */
export const publishAuthCacheInvalidation = (userId: string) => {
  publishEvent({ instanceId: INSTANCE_ID, type: 'authCacheInvalidate', userId });
};

/** Registers the one handler that clears middleware/auth.ts's local cache. */
export const onAuthCacheInvalidate = (handler: (userId: string) => void) => {
  authCacheInvalidationHandler = handler;
};

// Helper function to broadcast to multiple users
export const broadcastToUsers = (userIds: string[], message: any) => {
  const delivered = userIds.map((userId) => deliverToUserLocal(userId, message)).filter(Boolean).length;
  publishEvent({ instanceId: INSTANCE_ID, type: 'broadcastToUsers', userIds, message });
  return delivered;
};

// Broadcast that a booking has been taken
const broadcastBookingTakenLocal = (bookingId: string, acceptedByNurseId: string) => {
  declinedBy.delete(bookingId);
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

/** Patient cancelled before anyone accepted: pull the offer off nurses' screens. */
export const withdrawBookingOffer = (bookingId: string) => {
  broadcastBookingTaken(bookingId, '');
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

const MAX_REOFFERS = 10;

/**
 * A booking used to be offered exactly once, at creation, to whoever was
 * online at that instant. If nobody was, or everyone passed, it was never
 * offered again, and a nurse coming online later never saw it. Now, when a
 * nurse goes online, they're sent every open booking within range that they
 * haven't already declined (soonest first).
 */
const offerOpenBookings = async (nurseId: string, lat: number, lng: number) => {
  try {
    const open = await prisma.booking.findMany({
      where: {
        nurseId: null,
        paymentStatus: { not: 'REFUNDED' },
        scheduledDate: { gt: new Date() },
        encryptedPatientLocation: { not: null },
      },
      select: {
        id: true, scheduledDate: true, estimatedDuration: true, amountInCents: true,
        encryptedPatientLocation: true,
        patient: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 200,
    });
    let offered = 0;
    for (const b of open) {
      if (offered >= MAX_REOFFERS) break;
      if (hasDeclined(b.id, nurseId)) continue;
      // Decrypted in memory only for the distance check; never sent to the nurse.
      const location = decryptPatientLocation(b.encryptedPatientLocation);
      if (!location) continue;
      const distance = getDistanceFromLatLonInKm(location.lat, location.lng, lat, lng);
      if (distance > DISPATCH_RADIUS_KM) continue;
      const delivered = deliverToUserLocal(nurseId, {
        type: 'NEW_BOOKING_AVAILABLE',
        data: {
          bookingId: b.id,
          patientName: displayName(b.patient.firstName, b.patient.lastName),
          scheduledDate: b.scheduledDate.toISOString(),
          estimatedDuration: b.estimatedDuration,
          amountInCents: b.amountInCents,
          distanceKm: Math.round(distance * 10) / 10,
        },
      });
      if (delivered) offered += 1;
    }
    if (offered) console.log(`📢 Re-offered ${offered} open booking(s) to nurse ${nurseId}`);
  } catch (err) {
    console.warn('[ws] offering open bookings failed:', (err as Error)?.message ?? err);
  }
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

