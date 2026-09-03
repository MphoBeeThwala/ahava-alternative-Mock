import { Request, Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { authRateLimiter } from "../middleware/rateLimiter";
import {
  authMiddleware,
  AuthenticatedRequest,
  invalidateCachedUser,
} from "../middleware/auth";
import Joi from "joi";
import { verifySancRegistration } from "../services/sancVerification";
import { seedBaselineForUser } from "../services/baselineSeed";
import { addEmailJob } from "../services/queue";
import prisma from "../lib/prisma";
import { getRedis } from "../services/redis";
import {
  clearAuthCookies,
  createWebSocketTicket,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from "../services/authSession";

const router: Router = Router();

// Allow any TLD including .test for mock/load-test users (IANA list excludes .test)
const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .required();

// Password must be 8+ chars with at least one uppercase, one digit, one special character
const passwordComplexitySchema = Joi.string()
  .min(8)
  .pattern(/[A-Z]/, "uppercase letter")
  .pattern(/[0-9]/, "number")
  .pattern(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "special character")
  .required()
  .messages({
    "string.pattern.name": "Password must contain at least one {#name}",
    "string.min": "Password must be at least 8 characters",
  });

// ---------------------------------------------------------------------------
// Account lockout helpers (Redis-backed, graceful fallback if Redis is down)
// ---------------------------------------------------------------------------
const LOCKOUT_MAX_ATTEMPTS = parseInt(
  process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? "5",
  10,
);
const LOCKOUT_TTL_SECONDS = parseInt(
  process.env.AUTH_LOCKOUT_TTL_SECONDS ?? "900",
  10,
); // 15 min

async function isAccountLocked(
  email: string,
): Promise<{ locked: boolean; remainingSeconds?: number }> {
  try {
    const redis = getRedis();
    const ttl = await redis.ttl(`auth:locked:${email}`);
    if (ttl > 0) return { locked: true, remainingSeconds: ttl };
  } catch {
    // Redis unavailable — fail open (do not block healthcare login)
    console.warn("[auth] Redis unavailable for lockout check, failing open");
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
      await redis.set(`auth:locked:${email}`, "1", "EX", LOCKOUT_TTL_SECONDS);
      await redis.del(key);
      console.warn(
        `[auth] Account locked after ${LOCKOUT_MAX_ATTEMPTS} failed attempts: ${email}`,
      );
    }
  } catch {
    console.warn("[auth] Redis unavailable for failure tracking");
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
  role: Joi.string().valid("PATIENT", "NURSE", "DOCTOR", "ADMIN").required(),
  phone: Joi.string().optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().optional(),
  preferredLanguage: Joi.string().default("en-ZA"),
  sancRegistrationNumber: Joi.string().when("role", {
    is: "NURSE",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  adminSecret: Joi.string().allow("").optional(), // allow empty string — patient forms send '' by default
});

const loginSchema = Joi.object({
  email: emailSchema,
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

type PrismaWriteClient = Prisma.TransactionClient | typeof prisma;

type SignedTokens = {
  accessToken: string;
  refreshToken: string;
  refreshTokenHash: string;
  expiresAt: Date;
};

const REFRESH_REPLAY_TTL_SECONDS = Math.max(
  1,
  parseInt(process.env.REFRESH_TOKEN_REPLAY_TTL_SECONDS ?? "30", 10) || 30,
);

function shouldExposeTokens(req: Request): boolean {
  return req.get("X-Ahava-Auth-Mode") !== "cookie";
}

function buildAuthResponse<
  TPayload extends Record<string, unknown>,
>(
  req: Request,
  payload: TPayload,
  tokens: { accessToken: string; refreshToken: string },
): TPayload & Partial<{ accessToken: string; refreshToken: string }> {
  if (!shouldExposeTokens(req)) {
    return payload;
  }

  return {
    ...payload,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

function getRefreshReplayCacheKey(tokenHash: string): string {
  return `auth:refresh:replay:${tokenHash}`;
}

async function getRefreshReplayTokens(tokenHash: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(getRefreshReplayCacheKey(tokenHash));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    };
  } catch {
    return null;
  }
}

async function setRefreshReplayTokens(
  tokenHash: string,
  tokens: { accessToken: string; refreshToken: string },
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(
      getRefreshReplayCacheKey(tokenHash),
      JSON.stringify(tokens),
      "EX",
      REFRESH_REPLAY_TTL_SECONDS,
    );
  } catch {
    // Best effort only — refresh still works without replay protection.
  }
}

function createSignedTokens(userId: string, role: string): SignedTokens {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not configured");
  }

  const secret = process.env.JWT_SECRET as jwt.Secret;
  const accessExpiry = Math.max(
    60,
    process.env.JWT_EXPIRES_IN ? parseExpiry(process.env.JWT_EXPIRES_IN) : 900,
  ); // 15m default
  const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN
    ? parseExpiry(process.env.REFRESH_TOKEN_EXPIRES_IN)
    : 604800; // 7d

  const accessToken = jwt.sign({ userId, role }, secret, {
    expiresIn: accessExpiry,
  });
  const refreshToken = jwt.sign({ userId, role }, secret, {
    expiresIn: refreshExpiry,
    jwtid: crypto.randomUUID(),
  });
  const refreshTokenHash = hashRefreshToken(refreshToken);

  return {
    accessToken,
    refreshToken,
    refreshTokenHash,
    expiresAt: new Date(Date.now() + refreshExpiry * 1000),
  };
}

async function storeRefreshToken(
  client: PrismaWriteClient,
  userId: string,
  refreshTokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await client.refreshToken.create({
    data: {
      token: refreshTokenHash,
      userId,
      expiresAt,
    },
  });
}

async function rotateRefreshToken(
  oldTokenHash: string,
  userId: string,
  role: string,
): Promise<SignedTokens | null> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.refreshToken.deleteMany({
      where: { token: oldTokenHash },
    });

    if (deleted.count === 0) {
      return null;
    }

    const signedTokens = createSignedTokens(userId, role);
    await storeRefreshToken(
      tx,
      userId,
      signedTokens.refreshTokenHash,
      signedTokens.expiresAt,
    );
    return signedTokens;
  });
}

// Register new user
router.post("/register", authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const {
      email: rawEmail,
      password,
      firstName,
      lastName,
      role,
      phone,
      dateOfBirth,
      gender,
      preferredLanguage,
      sancRegistrationNumber,
      adminSecret,
    } = value;
    const email = rawEmail.toLowerCase();

    // Security: Restrict ADMIN and DOCTOR/NURSE registration
    if (role === "ADMIN") {
      if (
        !adminSecret ||
        adminSecret !== process.env.ADMIN_REGISTRATION_SECRET
      ) {
        return res
          .status(403)
          .json({ error: "Unauthorized role registration" });
      }
    }

    // For staff, we restrict signup in production mode
    if (
      (role === "DOCTOR" || role === "NURSE") &&
      process.env.NODE_ENV === "production"
    ) {
      if (
        !adminSecret ||
        adminSecret !== process.env.STAFF_REGISTRATION_SECRET
      ) {
        return res
          .status(403)
          .json({ error: "Staff registration requires a secret token" });
      }
    }

    // NOTE: PATIENT role registration is always allowed without a secret.

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password — 10 rounds balances security with CPU cost under concurrent load.
    // 12 rounds doubles the time and causes timeouts when many users register simultaneously.
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
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
    const { accessToken, refreshToken } = await generateTokens(
      user.id,
      user.role,
    );

    // Send email verification (non-fatal — requires DB migration to be applied)
    try {
      const verificationToken = crypto.randomBytes(32).toString("hex");
      await (prisma.user.update as Function)({
        where: { id: user.id },
        data: { emailVerificationToken: verificationToken },
      });
      const frontendBase = (
        process.env.FRONTEND_URL ?? "https://app.ahavaon88.co.za"
      ).replace(/\/$/, "");
      const verifyUrl = `${frontendBase}/auth/verify-email?token=${verificationToken}`;
      addEmailJob({
        to: email,
        subject: "Verify your Ahava Healthcare email",
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
      console.warn(
        "[auth/register] Could not set email verification token (migration pending?):",
        verifyErr,
      );
    }

    // Post-registration async hooks (non-blocking)
    setImmediate(async () => {
      try {
        if (role === "PATIENT") {
          await seedBaselineForUser(user.id);
        }
        if (role === "NURSE" && sancRegistrationNumber) {
          await verifySancRegistration(
            user.id,
            sancRegistrationNumber,
            firstName,
            lastName,
          );
        }
      } catch (hookErr) {
        console.error("[auth/register] Post-registration hook error:", hookErr);
      }
    });

    setAuthCookies(res, req, { accessToken, refreshToken });

    res.status(201).json(
      buildAuthResponse(
        req,
        {
          success: true,
          user,
          sancVerification:
            role === "NURSE" && sancRegistrationNumber ? "PENDING" : undefined,
        },
        { accessToken, refreshToken },
      ),
    );
  } catch (error) {
    next(error);
  }
});

// Login user
router.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    // Check account lockout before doing any DB work
    const lockStatus = await isAccountLocked(email);
    if (lockStatus.locked) {
      const minutes = Math.ceil(
        (lockStatus.remainingSeconds ?? LOCKOUT_TTL_SECONDS) / 60,
      );
      return res.status(429).json({
        error: `Account temporarily locked due to too many failed login attempts. Try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`,
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      // Still record attempt to prevent email enumeration timing attacks
      await recordFailedAttempt(email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await recordFailedAttempt(email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    // Successful login — clear any failure counter
    await clearFailedAttempts(email);

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(
      user.id,
      user.role,
    );

    setAuthCookies(res, req, { accessToken, refreshToken });

    res.json(
      buildAuthResponse(
        req,
        {
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
        },
        { accessToken, refreshToken },
      ),
    );
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken =
      typeof req.body?.refreshToken === "string"
        ? req.body.refreshToken
        : getRefreshTokenFromRequest(req);
    const { error } = refreshTokenSchema.validate({ refreshToken });
    if (error || !refreshToken) {
      clearAuthCookies(res, req);
      return res.status(400).json({ error: "Refresh token is required" });
    }

    // Verify refresh token
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET not configured");
    }

    let decoded: { userId: string; role: string };
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET) as {
        userId: string;
        role: string;
      };
    } catch (verifyError) {
      const errName = (verifyError as { name?: string })?.name;
      return res.status(401).json({
        error: "Invalid or expired refresh token",
        code:
          errName === "TokenExpiredError"
            ? "REFRESH_TOKEN_EXPIRED"
            : "REFRESH_TOKEN_INVALID",
      });
    }

    const tokenHash = hashRefreshToken(refreshToken);

    // Check Redis first (fast path), fallback to DB
    let tokenRecord: any = null;
    let userId: string | null = null;
    try {
      const redis = getRedis();
      userId = await redis.get(`refresh:${tokenHash}`);
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) tokenRecord = { user, expiresAt: new Date(Date.now() + 86400000), token: tokenHash };
      }
    } catch {}
    if (!tokenRecord) {
      tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: tokenHash },
        include: { user: true },
      });
    }

    if (!tokenRecord) {
      const replayTokens = await getRefreshReplayTokens(tokenHash);
      if (replayTokens) {
        setAuthCookies(res, req, replayTokens);
        return res.json(
          buildAuthResponse(
            req,
            {
              success: true,
            },
            replayTokens,
          ),
        );
      }
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    if (tokenRecord.expiresAt < new Date()) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    if (!tokenRecord.user.isActive) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    const rotatedTokens = await rotateRefreshToken(
      tokenHash,
      tokenRecord.user.id,
      decoded.role || tokenRecord.user.role,
    );

    if (!rotatedTokens) {
      const replayTokens = await getRefreshReplayTokens(tokenHash);
      if (replayTokens) {
        setAuthCookies(res, req, replayTokens);
        return res.json(
          buildAuthResponse(
            req,
            {
              success: true,
            },
            replayTokens,
          ),
        );
      }

      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    try {
      const redis = getRedis();
      const refreshTtlSeconds = Math.max(
        1,
        Math.ceil((rotatedTokens.expiresAt.getTime() - Date.now()) / 1000),
      );
      await redis.del(`refresh:${tokenHash}`);
      await redis.set(
        `refresh:${rotatedTokens.refreshTokenHash}`,
        tokenRecord.user.id,
        "EX",
        refreshTtlSeconds,
      );
    } catch {
      // Redis is an optimization; DB state remains authoritative.
    }

    await setRefreshReplayTokens(tokenHash, {
      accessToken: rotatedTokens.accessToken,
      refreshToken: rotatedTokens.refreshToken,
    });

    setAuthCookies(res, req, {
      accessToken: rotatedTokens.accessToken,
      refreshToken: rotatedTokens.refreshToken,
    });

    res.json(
      buildAuthResponse(
        req,
        {
          success: true,
        },
        {
          accessToken: rotatedTokens.accessToken,
          refreshToken: rotatedTokens.refreshToken,
        },
      ),
    );
  } catch (error) {
    next(error);
  }
});

// Logout (invalidate refresh token)
router.post("/logout", async (req, res, next) => {
  try {
    const refreshToken =
      typeof req.body?.refreshToken === "string"
        ? req.body.refreshToken
        : getRefreshTokenFromRequest(req);

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      try { await getRedis().del(`refresh:${tokenHash}`); } catch {}
      await prisma.refreshToken.deleteMany({
        where: { token: tokenHash },
      }).catch(() => {});
    }

    clearAuthCookies(res, req);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/ws-ticket",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      res.json({
        success: true,
        ticket: createWebSocketTicket(user.id, user.role),
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get current user profile - uses authMiddleware cache (Redis + in-memory, 5m TTL)
router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
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
      return res.status(404).json({ error: "User not found" });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /auth/profile — update own profile details
// ---------------------------------------------------------------------------
router.put(
  "/profile",
  authMiddleware,
  async (req: any, res: any, next: any) => {
    try {
      const userId = req.user.id;
      const { error, value } = Joi.object({
        firstName: Joi.string().min(1).max(80),
        lastName: Joi.string().min(1).max(80),
        phone: Joi.string().allow("", null),
        dateOfBirth: Joi.string().isoDate().allow(null),
        gender: Joi.string()
          .valid("MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY")
          .allow(null),
        preferredLanguage: Joi.string().max(10).allow(null),
        email: emailSchema.optional(),
      }).validate(req.body);
      if (error)
        return res.status(400).json({ error: error.details[0].message });

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true },
      });
      if (!currentUser)
        return res.status(404).json({ error: "User not found" });

      const updateData: Record<string, unknown> = {};
      if (value.firstName !== undefined) updateData.firstName = value.firstName;
      if (value.lastName !== undefined) updateData.lastName = value.lastName;
      if (value.phone !== undefined) updateData.phone = value.phone;
      if (value.dateOfBirth !== undefined)
        updateData.dateOfBirth = value.dateOfBirth
          ? new Date(value.dateOfBirth)
          : null;
      if (value.gender !== undefined) updateData.gender = value.gender;
      if (value.preferredLanguage !== undefined)
        updateData.preferredLanguage = value.preferredLanguage;

      let emailChanged = false;
      if (
        value.email &&
        value.email.toLowerCase() !== currentUser.email.toLowerCase()
      ) {
        const taken = await prisma.user.findUnique({
          where: { email: value.email.toLowerCase() },
        });
        if (taken)
          return res
            .status(409)
            .json({ error: "That email address is already in use." });
        updateData.email = value.email.toLowerCase();
        updateData.isVerified = false;
        emailChanged = true;
        try {
          const verificationToken = crypto.randomBytes(32).toString("hex");
          (updateData as any).emailVerificationToken = verificationToken;
          const verifyUrl = `${process.env.FRONTEND_URL ?? ""}/auth/verify-email?token=${verificationToken}`;
          addEmailJob({
            to: value.email.toLowerCase(),
            subject: "Verify your new Ahava Healthcare email",
            html: `<p>Hi ${value.firstName ?? currentUser.firstName},</p><p>You changed your email address. Please verify your new address:</p><p><a href="${verifyUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify New Email</a></p>`,
          }).catch(() => {});
        } catch {
          /* non-fatal */
        }
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          dateOfBirth: true,
          gender: true,
          preferredLanguage: true,
          isVerified: true,
          role: true,
        },
      });
      await invalidateCachedUser(userId);

      res.json({ success: true, user: updated, emailChanged });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/forgot-password — send reset link
// ---------------------------------------------------------------------------
router.post("/forgot-password", authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ email: emailSchema }).validate(
      req.body,
    );
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({
      where: { email: value.email },
    });
    // Always return success to avoid email enumeration
    if (!user)
      return res.json({
        success: true,
        message: "If that email exists, a reset link has been sent.",
      });

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    const resetUrl = `${process.env.FRONTEND_URL ?? ""}/auth/reset-password?token=${token}`;
    await addEmailJob({
      to: user.email,
      subject: "Reset your Ahava Healthcare password",
      html: `<p>Hi ${user.firstName},</p><p>We received a request to reset your password. Click the button below — this link expires in 1 hour.</p><p><a href="${resetUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    res.json({
      success: true,
      message: "If that email exists, a reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password — apply new password via token
// ---------------------------------------------------------------------------
router.post("/reset-password", authRateLimiter, async (req, res, next) => {
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

    if (!user)
      return res.status(400).json({
        error: "Invalid or expired reset link. Please request a new one.",
      });

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    const passwordHash = await bcrypt.hash(value.password, saltRounds);
    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    res.json({
      success: true,
      message: "Password updated successfully. You can now log in.",
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /auth/verify-email?token=... — verify email address
// ---------------------------------------------------------------------------
router.get("/verify-email", async (req, res, next) => {
  try {
    const token = req.query.token as string;
    if (!token)
      return res.status(400).json({ error: "Verification token missing." });

    const user = await (prisma.user.findFirst as Function)({
      where: { emailVerificationToken: token },
    });

    if (!user)
      return res
        .status(400)
        .json({ error: "Invalid or already-used verification link." });

    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { isVerified: true, emailVerificationToken: null },
    });

    res.json({ success: true, message: "Email verified successfully." });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/resend-verification — resend verification email
// ---------------------------------------------------------------------------
router.post("/resend-verification", authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ email: emailSchema }).validate(
      req.body,
    );
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({
      where: { email: value.email },
    });
    if (!user || user.isVerified)
      return res.json({
        success: true,
        message: "If applicable, a verification email has been sent.",
      });

    const token = crypto.randomBytes(32).toString("hex");
    await (prisma.user.update as Function)({
      where: { id: user.id },
      data: { emailVerificationToken: token },
    });

    const verifyUrl = `${process.env.FRONTEND_URL ?? ""}/auth/verify-email?token=${token}`;
    await addEmailJob({
      to: user.email,
      subject: "Verify your Ahava Healthcare email",
      html: `<p>Hi ${user.firstName},</p><p>Please verify your email address:</p><p><a href="${verifyUrl}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
    });

    res.json({
      success: true,
      message: "If applicable, a verification email has been sent.",
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/manual-verify — bypass email verification
// Dev/trial convenience only: in production this is restricted to ADMINs.
// ---------------------------------------------------------------------------
router.post(
  "/manual-verify",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (
        process.env.NODE_ENV === "production" &&
        req.user!.role !== "ADMIN"
      ) {
        return res
          .status(403)
          .json({ error: "Manual verification is not available." });
      }
      const userId = req.user!.id;
      await (prisma.user.update as Function)({
        where: { id: userId },
        data: { isVerified: true, emailVerificationToken: null },
      });
      res.json({ success: true, message: "Account manually verified." });
    } catch (error) {
      res.status(500).json({ error: "Manual verification failed." });
    }
  },
);

/** Parse expiry string (e.g. "15m", "7d") to seconds for jwt.SignOptions */
function parseExpiry(s: string): number {
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return 900;
  const val = parseInt(m[1], 10);
  switch (m[2]) {
    case "s":
      return val;
    case "m":
      return val * 60;
    case "h":
      return val * 3600;
    case "d":
      return val * 86400;
    default:
      return 900;
  }
}

// Helper function to generate tokens
async function generateTokens(userId: string, role: string) {
  const signedTokens = createSignedTokens(userId, role);

  const refreshTtlSeconds = Math.max(
    1,
    Math.ceil((signedTokens.expiresAt.getTime() - Date.now()) / 1000),
  );
  try {
    const redis = getRedis();
    await redis.set(
      `refresh:${signedTokens.refreshTokenHash}`,
      userId,
      "EX",
      refreshTtlSeconds,
    );
  } catch {
    // Redis unavailable - DB remains the source of truth.
  }

  try {
    await storeRefreshToken(
      prisma,
      userId,
      signedTokens.refreshTokenHash,
      signedTokens.expiresAt,
    );
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;
  }

  return {
    accessToken: signedTokens.accessToken,
    refreshToken: signedTokens.refreshToken,
  };
}

export default router;
