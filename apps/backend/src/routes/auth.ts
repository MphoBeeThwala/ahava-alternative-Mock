import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import Joi from 'joi';
import { verifySancRegistration } from '../services/sancVerification';
import { seedBaselineForUser } from '../services/baselineSeed';
import { addEmailJob } from '../services/queue';
import prisma from '../lib/prisma';
import { getRedis } from '../services/redis';

const router: Router = Router();

// Allow any TLD including .test for mock/load-test users (IANA list excludes .test)
const emailSchema = Joi.string().email({ tlds: { allow: false } }).required();

// Password must be 8+ chars with at least one uppercase, one digit, one special character
const passwordComplexitySchema = Joi.string()
  .min(8)
  .pattern(/[A-Z]/, 'uppercase letter')
  .pattern(/[0-9]/, 'number')
  .pattern(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'special character')
  .required()
  .messages({
    'string.pattern.name': 'Password must contain at least one {#name}',
    'string.min': 'Password must be at least 8 characters',
  });

// ---------------------------------------------------------------------------
// Account lockout helpers (Redis-backed, graceful fallback if Redis is down)
// ---------------------------------------------------------------------------
const LOCKOUT_MAX_ATTEMPTS = parseInt(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? '5', 10);
const LOCKOUT_TTL_SECONDS  = parseInt(process.env.AUTH_LOCKOUT_TTL_SECONDS  ?? '900', 10); // 15 min

async function isAccountLocked(email: string): Promise<{ locked: boolean; remainingSeconds?: number }> {
  try {
    const redis = getRedis();
    const ttl = await redis.ttl(`auth:locked:${email}`);
    if (ttl > 0) return { locked: true, remainingSeconds: ttl };
  } catch {
    // Redis unavailable — fail open (do not block healthcare login)
    console.warn('[auth] Redis unavailable for lockout check, failing open');
  }
  return { locked: false };
}

async function recordFailedAttempt(email: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `auth:failures:${email}`;
    const attempts = await redis.incr(key);
    // Reset window on first attempt
    if (attempts === 1) await redis.expire(key, LOCKOUT_TTL_SECONDS);
    if (attempts >= LOCKOUT_MAX_ATTEMPTS) {
      await redis.set(`auth:locked:${email}`, '1', 'EX', LOCKOUT_TTL_SECONDS);
      await redis.del(key);
      console.warn(`[auth] Account locked after ${LOCKOUT_MAX_ATTEMPTS} failed attempts: ${email}`);
    }
  } catch {
    console.warn('[auth] Redis unavailable for failure tracking');
  }
}

async function clearFailedAttempts(email: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`auth:failures:${email}`);
  } catch {
    // Non-fatal
  }
}

// Validation schemas
const registerSchema = Joi.object({
  email: emailSchema,
  password: passwordComplexitySchema,
  firstName: Joi.string().min(2).required(),
  lastName: Joi.string().min(2).required(),
  role: Joi.string().valid('PATIENT', 'NURSE', 'DOCTOR', 'ADMIN').required(),
  phone: Joi.string().optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().optional(),
  preferredLanguage: Joi.string().default('en-ZA'),
  sancRegistrationNumber: Joi.string().when('role', { is: 'NURSE', then: Joi.optional(), otherwise: Joi.forbidden() }),
});

const loginSchema = Joi.object({
  email: emailSchema,
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Register new user
router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password, firstName, lastName, role, phone, dateOfBirth, gender, preferredLanguage, sancRegistrationNumber } = value;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        phone,
        dateOfBirth,
        gender,
        preferredLanguage,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
      },
    });

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(user.id, user.role);

    // Send email verification (non-fatal — requires DB migration to be applied)
    try {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      await (prisma.user.update as Function)({
        where: { id: user.id },
        data: { emailVerificationToken: verificationToken },
      });
      const frontendBase = (process.env.FRONTEND_URL ?? 'https://app.ahavaon88.co.za').replace(/\/$/, '');
      const verifyUrl = `${frontendBase}/auth/verify-email?token=${verificationToken}`;
      addEmailJob({
        to: email,
        subject: 'Verify your Ahava Healthcare email',
        html: `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#059669);padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:32px;">⚕️</p>
          <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:800;">Ahava Healthcare</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center;">
          <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Hi ${firstName}, verify your email</h2>
          <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.6;">
            Welcome to Ahava Healthcare! Click the button below to verify your email address and activate your account.
          </p>
          <a href="${verifyUrl}"
             style="display:inline-block;background:linear-gradient(135deg,#0d9488,#059669);color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.3px;">
            Verify My Email →
          </a>
          <p style="margin:28px 0 0;color:#94a3b8;font-size:12px;">
            Button not working? Copy and paste this link into your browser:<br>
            <a href="${verifyUrl}" style="color:#0d9488;word-break:break-all;">${verifyUrl}</a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">Ahava Healthcare · POPIA Compliant · Encrypted</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Hi ${firstName},\n\nWelcome to Ahava Healthcare! Please verify your email by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, ignore this email.`,
      }).catch(() => {});
    } catch (verifyErr) {
      console.warn('[auth/register] Could not set email verification token (migration pending?):', verifyErr);
    }

    // Post-registration async hooks (non-blocking)
    setImmediate(async () => {
      try {
        if (role === 'PATIENT') {
          await seedBaselineForUser(user.id);
        }
        if (role === 'NURSE' && sancRegistrationNumber) {
          await verifySancRegistration(user.id, sancRegistrationNumber, firstName, lastName);
        }
      } catch (hookErr) {
        console.error('[auth/register] Post-registration hook error:', hookErr);
      }
    });

    res.status(201).json({
      success: true,
      user,
      accessToken,
      refreshToken,
      sancVerification: role === 'NURSE' && sancRegistrationNumber ? 'PENDING' : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// Login user
router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    // Check account lockout before doing any DB work
    const lockStatus = await isAccountLocked(email);
    if (lockStatus.locked) {
      const minutes = Math.ceil((lockStatus.remainingSeconds ?? LOCKOUT_TTL_SECONDS) / 60);
      return res.status(429).json({
        error: `Account temporarily locked due to too many failed login attempts. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`,
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      // Still record attempt to prevent email enumeration timing attacks
      await recordFailedAttempt(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await recordFailedAttempt(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Successful login — clear any failure counter
    await clearFailedAttempts(email);

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(user.id, user.role);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        preferredLanguage: user.preferredLanguage,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { error, value } = refreshTokenSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { refreshToken } = value;

    // Verify refresh token
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET not configured');
    }

    const _decoded = jwt.verify(refreshToken, process.env.JWT_SECRET) as { userId: string };
    const tokenHash = hashRefreshToken(refreshToken);

    // Check if refresh token exists in database
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (!tokenRecord.user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = await generateTokens(
      tokenRecord.user.id,
      tokenRecord.user.role
    );

    // Delete old refresh token
    await prisma.refreshToken.delete({
      where: { token: tokenHash },
    });

    res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
});

// Logout (invalidate refresh token)
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await prisma.refreshToken.deleteMany({
        where: { token: tokenHash },
      });
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Get current user profile
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET not configured');
    }

    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId: string };
    } catch (verifyError) {
      const errName = (verifyError as { name?: string })?.name;
      if (errName === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        phone: true,
        profileImage: true,
        dateOfBirth: true,
        gender: true,
        riskProfile: true,
        preferredLanguage: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        isAvailable: true,
        lastKnownLat: true,
        lastKnownLng: true,
        lastLocationUpdate: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /auth/profile — update own profile details
// ---------------------------------------------------------------------------
router.put('/profile', authMiddleware, async (req: any, res: any, next: any) => {
  try {
    const userId = req.user.id;
    const { error, value } = Joi.object({
      firstName: Joi.string().min(1).max(80),
      lastName: Joi.string().min(1).max(80),
      phone: Joi.string().allow('', null),
      dateOfBirth: Joi.string().isoDate().allow(null),
      gender: Joi.string().valid('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY').allow(null),
      preferredLanguage: Joi.string().max(10).allow(null),
      email: emailSchema.optional(),
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    const updateData: Record<string, unknown> = {};
    if (value.firstName !== undefined) updateData.firstName = value.firstName;
    if (value.lastName !== undefined) updateData.lastName = value.lastName;
    if (value.phone !== undefined) updateData.phone = value.phone;
    if (value.dateOfBirth !== undefined) updateData.dateOfBirth = value.dateOfBirth ? new Date(value.dateOfBirth) : null;
    if (value.gender !== undefined) updateData.gender = value.gender;
    if (value.preferredLanguage !== undefined) updateData.preferredLanguage = value.preferredLanguage;

    let emailChanged = false;
    if (value.email && value.email.toLowerCase() !== currentUser.email.toLowerCase()) {
      const taken = await prisma.user.findUnique({ where: { email: value.email.toLowerCase() } });
      if (taken) return res.status(409).json({ error: 'That email address is already in use.' });
      updateData.email = value.email.toLowerCase();
      updateData.isVerified = false;
      emailChanged = true;
      try {
        const verificationToken = crypto.randomBytes(32).toString('hex');
        (updateData as any).emailVerificationToken = verificationToken;
        const verifyUrl = `${process.env.FRONTEND_URL ?? ''}/auth/verify-email?token=${verificationToken}`;
        addEmailJob({
          to: value.email.toLowerCase(),
          subject: 'Verify your new Ahava Healthcare email',
          html: `<p>Hi ${value.firstName ?? currentUser.firstName},</p><p>You changed your email address. Please verify your new address:</p><p><a href="${verifyUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify New Email</a></p>`,
        }).catch(() => {});
      } catch { /* non-fatal */ }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, dateOfBirth: true, gender: true, preferredLanguage: true, isVerified: true, role: true },
    });

    res.json({ success: true, user: updated, emailChanged });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password — send reset link
// ---------------------------------------------------------------------------
router.post('/forgot-password', authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ email: emailSchema }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { email: value.email } });
    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    const resetUrl = `${process.env.FRONTEND_URL ?? ''}/auth/reset-password?token=${token}`;
    await addEmailJob({
      to: user.email,
      subject: 'Reset your Ahava Healthcare password',
      html: `<p>Hi ${user.firstName},</p><p>We received a request to reset your password. Click the button below — this link expires in 1 hour.</p><p><a href="${resetUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password — apply new password via token
// ---------------------------------------------------------------------------
router.post('/reset-password', authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      token: Joi.string().required(),
      password: passwordComplexitySchema,
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await (prisma.user.findFirst as Function)({
      where: {
        passwordResetToken: value.token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });

    const passwordHash = await bcrypt.hash(value.password, 12);
    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpiry: null },
    });

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /auth/verify-email?token=... — verify email address
// ---------------------------------------------------------------------------
router.get('/verify-email', async (req, res, next) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ error: 'Verification token missing.' });

    const user = await (prisma.user.findFirst as Function)({
      where: { emailVerificationToken: token },
    });

    if (!user) return res.status(400).json({ error: 'Invalid or already-used verification link.' });

    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { isVerified: true, emailVerificationToken: null },
    });

    res.json({ success: true, message: 'Email verified successfully.' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/resend-verification — resend verification email
// ---------------------------------------------------------------------------
router.post('/resend-verification', authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ email: emailSchema }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { email: value.email } });
    if (!user || user.isVerified) return res.json({ success: true, message: 'If applicable, a verification email has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { emailVerificationToken: token },
    });

    const verifyUrl = `${process.env.FRONTEND_URL ?? ''}/auth/verify-email?token=${token}`;
    await addEmailJob({
      to: user.email,
      subject: 'Verify your Ahava Healthcare email',
      html: `<p>Hi ${user.firstName},</p><p>Please verify your email address:</p><p><a href="${verifyUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
    });

    res.json({ success: true, message: 'If applicable, a verification email has been sent.' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/manual-verify — bypass email verification (Trial/Dev mode)
// ---------------------------------------------------------------------------
router.post('/manual-verify', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    await (prisma.user.update as Function)({
      where: { id: userId },
      data: { isVerified: true, emailVerificationToken: null },
    });
    res.json({ success: true, message: 'Account manually verified.' });
  } catch (error) {
    res.status(500).json({ error: 'Manual verification failed.' });
  }
});

/** Parse expiry string (e.g. "15m", "7d") to seconds for jwt.SignOptions */
function parseExpiry(s: string): number {
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return 900;
  const val = parseInt(m[1], 10);
  switch (m[2]) {
    case 's': return val;
    case 'm': return val * 60;
    case 'h': return val * 3600;
    case 'd': return val * 86400;
    default: return 900;
  }
}

// Helper function to generate tokens
async function generateTokens(userId: string, role: string) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }

  const secret = process.env.JWT_SECRET as jwt.Secret;
  // Use numeric seconds to satisfy jsonwebtoken SignOptions (avoids StringValue type issue). Minimum 60s so load tests work.
  const accessExpiry = Math.max(60, process.env.JWT_EXPIRES_IN ? parseExpiry(process.env.JWT_EXPIRES_IN) : 900); // 15m default
  const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN ? parseExpiry(process.env.REFRESH_TOKEN_EXPIRES_IN) : 604800; // 7d
  const accessToken = jwt.sign({ userId, role }, secret, { expiresIn: accessExpiry });
  const refreshToken = jwt.sign({ userId, role }, secret, { expiresIn: refreshExpiry });
  const refreshTokenHash = hashRefreshToken(refreshToken);

  // Store refresh token in database
  const expiresAt = new Date(Date.now() + refreshExpiry * 1000);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenHash,
      userId,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

export default router;
