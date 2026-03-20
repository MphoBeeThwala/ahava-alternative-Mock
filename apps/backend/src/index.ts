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
import nurseRoutes from './routes/nurse';
import patientRoutes from './routes/patient';
import terraRoutes from './routes/terra';
import consentRoutes from './routes/consent';
import healthConnectRoutes from './routes/healthConnect';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { authMiddleware } from './middleware/auth';

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
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? [
        'https://frontend-production-326c.up.railway.app',
        'https://ahava-healthcare-admin.railway.app',
        'https://ahava-healthcare-doctor.railway.app',
      ]
    : [
        'http://localhost:3000', 'http://127.0.0.1:3000',
        'http://localhost:3003', 'http://127.0.0.1:3003',
        'https://localhost',      // Capacitor Android WebView origin
        'capacitor://localhost',  // Capacitor iOS / some Android builds
      ];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Compression and logging
app.use(compression());
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
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
app.use('/api/nurse', authMiddleware, nurseRoutes);
app.use('/api/patient', authMiddleware, patientRoutes);
app.use('/api/terra', authMiddleware, terraRoutes);
app.use('/api/consent', authMiddleware, consentRoutes);
app.use('/api/biometrics/health-connect', authMiddleware, healthConnectRoutes);
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

async function startServer() {
  console.log('🔄 Starting initialization...');

  // Initialize Redis + Queues (optional - app works without them for core API)
  if (process.env.REDIS_URL) {
    try {
      console.log('🔄 Connecting to Redis...');
      const redis = await initializeRedis();
      await initializeQueue(redis);
      console.log('✅ Redis and queues initialized');
    } catch (err) {
      console.warn('⚠️ Redis/Queue unavailable, running without background jobs:', (err as Error).message);
    }
  } else {
    console.log('⚠️ REDIS_URL not set, skipping Redis/queues (core API will work)');
  }

  // Start SLA escalation cron (every 2 minutes)
  const ESCALATION_INTERVAL_MS = 2 * 60 * 1000;
  setInterval(() => {
    runEscalationCheck().catch((err) =>
      console.error('[escalation cron] Uncaught error:', err)
    );
  }, ESCALATION_INTERVAL_MS);
  console.log('⏰ Triage escalation cron started (every 2 minutes)');

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
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

startServer();
