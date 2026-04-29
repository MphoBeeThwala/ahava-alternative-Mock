import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth';
import bookingRoutes from './routes/bookings';
import visitRoutes from './routes/visits';
import messageRoutes from './routes/messages';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import webhookRoutes from './routes/webhooks';
import triageRoutes from './routes/triage';
import triageCasesRoutes from './routes/triageCases';
import triageCaseReviewRoutes from './routes/triageCaseReview';
import nurseRoutes from './routes/nurse';
import patientRoutes from './routes/patient';
import terraRoutes from './routes/terra';
import rookRoutes from './routes/rook';
import consentRoutes from './routes/consent';
import healthConnectRoutes from './routes/healthConnect';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { authMiddleware } from './middleware/auth';
import { attachRateLimitUserKey } from './middleware/rateLimitUserKey';
import { attachRequestId } from './middleware/requestId';

// Import services
import { initializeRedis } from './services/redis';
import { initializeQueue } from './services/queue';
import { initializeWebSocket } from './services/websocket';
import { runEscalationCheck } from './jobs/triageEscalation';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Trust proxy so X-Forwarded-For is trusted (required behind Railway/reverse proxies for rate-limit)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS: allow frontend origin so browser permits cross-origin API calls (including preflight)
// Priority: CORS_ORIGIN env var > auto-build from FRONTEND_URL + defaults
const buildCorsOrigins = (): string[] => {
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    const defaults = [
      'https://frontend-production-326c.up.railway.app',
      'https://ahava-healthcare-admin.railway.app',
      'https://ahava-healthcare-doctor.railway.app',
    ];
    // Auto-include custom domain set via FRONTEND_URL (e.g. https://app.yourdomain.com)
    if (process.env.FRONTEND_URL) {
      const custom = process.env.FRONTEND_URL.trim().replace(/\/$/, '');
      if (custom && !defaults.includes(custom)) defaults.push(custom);
    }
    return defaults;
  }
  return ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3003', 'http://127.0.0.1:3003'];
};
const corsOrigins = buildCorsOrigins();
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
}));

// Compression and logging
app.use(compression());
app.use(attachRequestId);
app.use(morgan(':req[x-request-id] :method :url :status :res[content-length] - :response-time ms', {
  stream: {
    write: (message: string) => {
      console.log(message.replace(/\?[^\s]+/, '?[REDACTED]').trim());
    },
  },
}));

// Body parsing with raw body capture for webhook verification
app.use(express.json({
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(attachRateLimitUserKey);
app.use(rateLimiter);

// Health check (Railway probes this)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    timezone: process.env.TIMEZONE || 'Africa/Johannesburg'
  });
});

// Root: so opening backend URL in browser doesn't 404
app.get('/', (req, res) => {
  res.redirect(302, '/health');
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', authMiddleware, bookingRoutes);
app.use('/api/visits', authMiddleware, visitRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);
app.use('/api/payments', authMiddleware, paymentRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/triage', authMiddleware, triageRoutes);
app.use('/api/triage-cases', authMiddleware, triageCasesRoutes);
app.use('/api/triage-review', triageCaseReviewRoutes);
app.use('/api/nurse', authMiddleware, nurseRoutes);
app.use('/api/patient', authMiddleware, patientRoutes);
app.use('/api/terra', terraRoutes);
app.use('/api/rook', rookRoutes);
app.use('/api/consent', authMiddleware, consentRoutes);  // moved from /api/patient/consent to avoid prefix conflict
app.use('/api/biometrics/health-connect', healthConnectRoutes);
app.use('/webhooks', webhookRoutes);

// WebSocket initialization
initializeWebSocket(wss);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;

let escalationTimer: ReturnType<typeof setInterval> | null = null;

async function startServer() {
  console.log('🔄 Starting initialization...');

  // Initialize Redis + Queues (optional - app works without them for core API)
  if (process.env.REDIS_URL) {
    try {
      console.log('🔄 Connecting to Redis...');
      const redis = await initializeRedis();
      await initializeQueue(redis);
      console.log('✅ Redis and queues initialized');

      // Schedule SLA escalation check every 2 minutes
      const ESCALATION_INTERVAL_MS = 2 * 60 * 1000;
      escalationTimer = setInterval(async () => {
        try { await runEscalationCheck(); }
        catch (err) { console.error('[escalation] Cron failed:', (err as Error).message); }
      }, ESCALATION_INTERVAL_MS);

      // Catch any cases missed before this restart
      setImmediate(() => runEscalationCheck().catch(console.error));
      console.log('✅ Escalation cron scheduled (every 2 minutes)');
    } catch (err) {
      console.warn('⚠️ Redis/Queue unavailable, running without background jobs:', (err as Error).message);
    }
  } else {
    console.log('⚠️ REDIS_URL not set, skipping Redis/queues (core API will work)');
  }

  // Warn on missing critical env vars (broken email links, etc.)
  if (!process.env.FRONTEND_URL) {
    console.warn('⚠️  FRONTEND_URL is not set — email verification/reset links will be broken. Set FRONTEND_URL to your frontend domain (e.g. https://yourapp.up.railway.app)');
  } else {
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
  }

  // Start server
  server.listen(PORT, () => {
    console.log(`🚀 Ahava Healthcare API server running on port ${PORT}`);
    console.log(`🌍 Timezone: ${process.env.TIMEZONE}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  if (escalationTimer) clearInterval(escalationTimer);
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  if (escalationTimer) clearInterval(escalationTimer);
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

startServer();
