import { Request, Router } from "express";
import * as bcrypt from "@node-rs/bcrypt";
import crypto from "crypto";
import { Prisma, StaffInvite } from "@prisma/client";
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
import { isMfaRequired } from "../services/mfaPolicy";
import { auditSignIn } from "../services/signInAudit";
import { revokeAllSessions } from "../services/sessions";
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  hashOneTimeToken,
  newOneTimeToken,
} from "../services/oneTimeTokens";
import { verifyReauthentication } from "../services/reauth";
import { accessTokenSecondsFor, refreshRefusal } from "../services/sessionPolicy";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "../services/loginThrottle";
import { consumeInvite, findUsableInvite, isStaffInviteRequired } from "../services/staffInvites";
import { writeRequestAudit } from "../services/clinicalAudit";
import { RESEARCH_CONSENT_TYPE, RESEARCH_CONSENT_VERSION } from "../services/research/pseudonym";
import prisma, { TransactionClient } from "../lib/prisma";
import { getRedis } from "../services/redis";
import {
  clearAuthCookies,
  createWebSocketTicket,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from "../services/authSession";
import { signToken, verifyToken, TWOFA_PENDING_TTL_SECONDS } from "../services/tokens";

const router: Router = Router();

// Allow any TLD including .test for mock/load-test users (IANA list excludes .test)
export const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .required();

// Password must be 8+ chars with at least one uppercase, one digit, one special character
export const passwordComplexitySchema = Joi.string()
  .min(8)
  .pattern(/[A-Z]/, "uppercase letter")
  .pattern(/[0-9]/, "number")
  .pattern(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "special character")
  .required()
  .messages({
    "string.pattern.name": "Password must contain at least one {#name}",
    "string.min": "Password must be at least 8 characters",
  });

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
  // Optional, unticked-by-default research opt-in (services/research). Patients
  // only: staff accounts are not research subjects. Absent or false records
  // nothing. Anyone who skips it is asked again, once, after they sign in.
  researchConsent: Joi.boolean().when("role", {
    is: "PATIENT",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  sancRegistrationNumber: Joi.string().trim().max(40).when("role", {
    is: "NURSE",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  hpcsaNumber: Joi.string().trim().max(40).when("role", {
    is: "DOCTOR",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  // Staff (nurse, doctor, admin) accounts need an admin-issued invite
  // (services/staffInvites.ts).
  inviteToken: Joi.string().max(200).optional(),
  // The shared registration secrets were retired for invites. Older cached
  // sign-up pages still send this field (often as ''), so it is accepted
  // and dropped rather than failing their patient sign-ups.
  adminSecret: Joi.any().strip(),
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

type PrismaWriteClient = TransactionClient | typeof prisma;

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

export function buildAuthResponse<
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

function createSignedTokens(userId: string, role: string, authTime?: number): SignedTokens {
  // Staff get a shorter access token (services/sessionPolicy.ts).
  const accessExpiry = accessTokenSecondsFor(
    role,
    Math.max(60, process.env.JWT_EXPIRES_IN ? parseExpiry(process.env.JWT_EXPIRES_IN) : 900), // 15m default
  );
  // When the sign-in that started this session happened. A refresh passes the
  // original value through, so the absolute staff session limit holds.
  const sessionStart = authTime ?? Math.floor(Date.now() / 1000);
  const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN
    ? parseExpiry(process.env.REFRESH_TOKEN_EXPIRES_IN)
    : 604800; // 7d

  // `typ` is what stops these two being interchangeable — see services/tokens.ts.
  const accessToken = signToken(
    { userId, role, typ: "access" },
    { expiresInSeconds: accessExpiry },
  );
  const refreshToken = signToken(
    { userId, role, typ: "refresh", authTime: sessionStart },
    { expiresInSeconds: refreshExpiry, jwtid: crypto.randomUUID() },
  );
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
  authTime?: number,
): Promise<SignedTokens | null> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.refreshToken.deleteMany({
      where: { token: oldTokenHash },
    });

    if (deleted.count === 0) {
      return null;
    }

    const signedTokens = createSignedTokens(userId, role, authTime);
    await storeRefreshToken(
      tx,
      userId,
      signedTokens.refreshTokenHash,
      signedTokens.expiresAt,
    );
    return signedTokens;
  });
}

class InviteAlreadyUsedError extends Error {}

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
      hpcsaNumber,
      inviteToken,
      researchConsent,
    } = value;
    let email = rawEmail.toLowerCase();

    // Staff accounts are created only through a single-use invite an admin
    // sent to this person (services/staffInvites.ts). Patients sign up freely.
    let invite: StaffInvite | null = null;
    if (role !== "PATIENT" && (inviteToken || isStaffInviteRequired())) {
      if (!inviteToken) {
        return res.status(403).json({
          error: "Staff accounts are created by invitation. Ask your administrator to send you an invite link.",
          code: "INVITE_REQUIRED",
        });
      }
      invite = await findUsableInvite(inviteToken);
      if (!invite) {
        return res.status(400).json({
          error: "This invite link is invalid, has expired, or was already used. Ask your administrator for a new one.",
          code: "INVITE_INVALID",
        });
      }
      if (invite.role !== role) {
        return res.status(400).json({ error: "This invite is for a different role.", code: "INVITE_MISMATCH" });
      }
      if (invite.email !== email) {
        return res.status(400).json({ error: "Use the email address the invite was sent to.", code: "INVITE_MISMATCH" });
      }
      email = invite.email;
    }

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

    // Create user (and use up the invite in the same transaction)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
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
          // Entered by the doctor; unverified until an admin checks it.
          ...(role === "DOCTOR" && hpcsaNumber ? { hcpsaNumber: hpcsaNumber } : {}),
          // Opening the emailed invite link proves the address.
          ...(invite ? { isVerified: true } : {}),
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
      if (invite && !(await consumeInvite(tx, invite.id, created.id))) {
        throw new InviteAlreadyUsedError();
      }
      // The research opt-in is recorded with the account, so there is no window
      // in which the account exists and a stated choice was lost. It starts now:
      // only readings recorded from this moment are ever captured.
      if (role === "PATIENT" && researchConsent === true) {
        await tx.patientConsent.create({
          data: {
            userId: created.id,
            consentType: RESEARCH_CONSENT_TYPE,
            version: RESEARCH_CONSENT_VERSION,
            ipAddress: req.ip ?? null,
            userAgent: req.get("User-Agent") ?? null,
          },
        });
      }
      return created;
    }).catch((err) => {
      if (err instanceof InviteAlreadyUsedError) return null;
      throw err;
    });
    if (!user) {
      return res.status(400).json({
        error: "This invite link is invalid, has expired, or was already used. Ask your administrator for a new one.",
        code: "INVITE_INVALID",
      });
    }
    if (invite) {
      await writeRequestAudit({
        userId: user.id,
        userRole: user.role,
        action: "CREATE",
        resource: "StaffInvite",
        resourceId: invite.id,
        metadata: { event: "INVITE_ACCEPTED", role: user.role, invitedById: invite.createdById },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });
    }

    if (role === "PATIENT" && researchConsent === true) {
      await writeRequestAudit({
        userId: user.id,
        userRole: user.role,
        action: "CREATE",
        resource: "Consent",
        metadata: { consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, via: "SIGNUP" },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(
      user.id,
      user.role,
    );

    // Send email verification (non-fatal — requires DB migration to be applied).
    // Not needed when the account came from an emailed invite.
    if (!invite) {
      try {
        const { token: verificationToken, tokenHash } = newOneTimeToken();
        await prisma.user.update({
          where: { id: user.id },
          data: {
            emailVerificationToken: tokenHash,
            emailVerificationExpiry: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
          },
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

    return res.status(201).json(
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
    return next(error);
  }
});

// What a staff invite link is for, so the sign-up page can fill in and
// lock the email and role. The token is 256 bits of randomness, so this
// can't be used to discover invites.
router.get("/invites/:token", authRateLimiter, async (req, res, next) => {
  try {
    const invite = await findUsableInvite(req.params.token);
    if (!invite) {
      return res.status(404).json({
        error: "This invite link is invalid, has expired, or was already used. Ask your administrator for a new one.",
        code: "INVITE_INVALID",
      });
    }
    return res.json({
      invite: {
        email: invite.email,
        role: invite.role,
        firstName: invite.firstName,
        lastName: invite.lastName,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
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

    // Check throttling before doing any DB work
    const ip = req.ip ?? "";
    const block = await checkLoginAllowed(email, ip);
    if (block.blocked) {
      const minutes = Math.ceil(block.retryAfterSeconds / 60);
      res.set("Retry-After", String(block.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many failed login attempts. Try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`,
        code: "LOGIN_THROTTLED",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      // Still record attempt to prevent email enumeration timing attacks
      await recordLoginFailure(email, ip);
      await auditSignIn(req, "LOGIN_FAILED", null, { email, reason: "unknown_account" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await recordLoginFailure(email, ip);
      await auditSignIn(req, "LOGIN_FAILED", user, { reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isActive) {
      await auditSignIn(req, "LOGIN_FAILED", user, { reason: "deactivated" });
      return res.status(401).json({ error: "Account is deactivated" });
    }

    // Successful login — clear any failure counter
    await clearLoginFailures(email, ip);

    // AH-29: opt-in 2FA. Password alone is not enough for an account with it
    // enabled — issue a short-lived "twofa_pending" token (a distinct JWT
    // type, so it cannot be used as a real session) and require
    // POST /auth/2fa/login-verify with a TOTP or backup code before any
    // cookies are set.
    if (user.totpEnabled) {
      await auditSignIn(req, "LOGIN_2FA_PENDING", user);
      const pendingToken = signToken(
        { userId: user.id, role: user.role, typ: "twofa_pending" },
        { expiresInSeconds: TWOFA_PENDING_TTL_SECONDS },
      );
      return res.json({
        success: true,
        twoFactorRequired: true,
        pendingToken,
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(
      user.id,
      user.role,
    );
    await auditSignIn(req, "LOGIN_SUCCESS", user, { method: "password" });

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
          // Staff must set up 2FA before this session can do anything else
          // (services/mfaPolicy.ts); the client sends them to enrolment.
          mfaEnrollmentRequired: isMfaRequired(user.role),
        },
        { accessToken, refreshToken },
      ),
    );
  } catch (error) {
    return next(error);
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

    // Verify refresh token. `verifyToken` rejects an access token or a
    // WebSocket ticket presented here, even though all three are signed
    // with the same secret.
    let decoded: { userId: string; role: string; iat?: number; authTime?: number };
    try {
      decoded = verifyToken(refreshToken, "refresh");
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
    } catch { /* redis unavailable — fall back to the prisma lookup below */ }
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

    // Staff sessions end after a short idle period and after an absolute
    // lifetime (services/sessionPolicy.ts). The role comes from the database,
    // not the token, so a role change is not carried forward by a refresh.
    const refusal = refreshRefusal(tokenRecord.user.role, decoded.iat, decoded.authTime);
    if (refusal) {
      await prisma.refreshToken.deleteMany({ where: { token: tokenHash } }).catch(() => {});
      try { await getRedis().del(`refresh:${tokenHash}`); } catch { /* the database delete above is what revokes */ }
      clearAuthCookies(res, req);
      await auditSignIn(req, "SESSION_EXPIRED", tokenRecord.user, { reason: refusal });
      return res.status(401).json({
        error: refusal === "SESSION_IDLE_TIMEOUT"
          ? "You were signed out after a period of inactivity. Please sign in again."
          : "Your session has reached its time limit. Please sign in again.",
        code: refusal,
      });
    }

    const rotatedTokens = await rotateRefreshToken(
      tokenHash,
      tokenRecord.user.id,
      tokenRecord.user.role,
      decoded.authTime ?? decoded.iat,
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
    return next(error);
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
      try { await getRedis().del(`refresh:${tokenHash}`); } catch { /* redis unavailable — prisma delete below still revokes it */ }
      await prisma.refreshToken.deleteMany({
        where: { token: tokenHash },
      }).catch(() => {});
    }

    clearAuthCookies(res, req);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    return next(error);
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
      return next(error);
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
        totpEnabled: true,
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
    return next(error);
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
        // Step-up proof, required only when the email address changes.
        currentPassword: Joi.string().max(200).optional(),
        code: Joi.alternatives()
          .try(Joi.string().pattern(/^\d{6}$/), Joi.string().pattern(/^[0-9A-F]{5}-[0-9A-F]{5}$/i))
          .optional(),
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
      let previousEmail: string | null = null;
      if (
        value.email &&
        value.email.toLowerCase() !== currentUser.email.toLowerCase()
      ) {
        const taken = await prisma.user.findUnique({
          where: { email: value.email.toLowerCase() },
        });
        // The sign-in email is also where password-reset links go, so changing
        // it is an account-takeover step: a stolen session alone isn't enough.
        const reauth = await verifyReauthentication(userId, {
          currentPassword: value.currentPassword,
          code: value.code,
        });
        if (!reauth.ok) {
          await writeRequestAudit({
            userId, userRole: req.user!.role, action: "EMAIL_CHANGE_FAILED", resource: "Auth", resourceId: userId,
            metadata: { reason: reauth.code }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
          });
          return res.status(reauth.status).json({ error: reauth.error, code: reauth.code });
        }
        if (taken)
          return res
            .status(409)
            .json({ error: "That email address is already in use." });
        previousEmail = currentUser.email;
        updateData.email = value.email.toLowerCase();
        updateData.isVerified = false;
        emailChanged = true;
        try {
          const { token: verificationToken, tokenHash } = newOneTimeToken();
          updateData.emailVerificationToken = tokenHash;
          updateData.emailVerificationExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
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

      if (emailChanged && previousEmail) {
        // Sign out every other device (this one gets fresh tokens), audit it,
        // and tell the old address so an unexpected change is noticed.
        await revokeAllSessions(userId);
        const { accessToken, refreshToken } = await generateTokens(userId, updated.role);
        setAuthCookies(res, req, { accessToken, refreshToken });
        await writeRequestAudit({
          userId, userRole: updated.role, action: "EMAIL_CHANGED", resource: "Auth", resourceId: userId,
          metadata: { otherSessionsSignedOut: true }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
        });
        notifyEmailChanged(previousEmail, updated.firstName, updated.email);
        return res.json(buildAuthResponse(req, { success: true, user: updated, emailChanged }, { accessToken, refreshToken }));
      }

      res.json({ success: true, user: updated, emailChanged });
    } catch (error) {
      return next(error);
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

    const { token, tokenHash } = newOneTimeToken();
    const expiry = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: tokenHash, passwordResetExpiry: expiry },
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
    return next(error);
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

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashOneTimeToken(value.token),
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user)
      return res.status(400).json({
        error: "Invalid or expired reset link. Please request a new one.",
      });

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    const passwordHash = await bcrypt.hash(value.password, saltRounds);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });
    // Anyone signed in with the old password (the reason people reset) is
    // signed out. This used to leave every existing session running.
    await revokeAllSessions(user.id);
    await writeRequestAudit({
      userId: user.id, userRole: user.role, action: "PASSWORD_RESET", resource: "Auth", resourceId: user.id,
      metadata: { via: "email_link" }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
    });
    notifyPasswordChanged(user.email, user.firstName, "reset");

    res.json({
      success: true,
      message: "Password updated successfully. You can now log in.",
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/change-password — signed-in password change
// ---------------------------------------------------------------------------
// There was no way to change a password from inside the app, only the
// forgotten-password email. Requires the current password; signs out every
// other session (and this one gets fresh tokens), audits, and emails the
// account holder so an unexpected change is noticed.
router.post("/change-password", authMiddleware, authRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: passwordComplexitySchema,
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: "Password sign-in isn't set up for this account" });

    const valid = await bcrypt.compare(value.currentPassword, user.passwordHash);
    if (!valid) {
      await writeRequestAudit({
        userId: user.id, userRole: user.role, action: "PASSWORD_CHANGE_FAILED", resource: "Auth", resourceId: user.id,
        metadata: { reason: "bad_current_password" }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
      });
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    if (await bcrypt.compare(value.newPassword, user.passwordHash)) {
      return res.status(400).json({ error: "Choose a password you haven't used for this account" });
    }

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(value.newPassword, saltRounds), passwordResetToken: null, passwordResetExpiry: null },
    });
    const signedOut = await revokeAllSessions(user.id);
    // Keep the person who just changed it signed in on this device.
    const { accessToken, refreshToken } = await generateTokens(user.id, user.role);
    setAuthCookies(res, req, { accessToken, refreshToken });
    await writeRequestAudit({
      userId: user.id, userRole: user.role, action: "PASSWORD_CHANGED", resource: "Auth", resourceId: user.id,
      metadata: { otherSessionsSignedOut: Math.max(0, signedOut - 1) }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
    });
    notifyPasswordChanged(user.email, user.firstName, "change");

    return res.json(buildAuthResponse(req, { success: true, message: "Password changed. You've been signed out on all other devices." }, { accessToken, refreshToken }));
  } catch (error) {
    return next(error);
  }
});

/** Best-effort notice to the OLD address that the sign-in email changed — the cue for someone who didn't do it. */
function notifyEmailChanged(oldEmail: string, firstName: string, newEmail: string) {
  const safeName = firstName.replace(/[<>&"]/g, "");
  const masked = newEmail.replace(/^(.).*(@.*)$/, "$1***$2");
  addEmailJob({
    to: oldEmail,
    subject: "Your Ahava Healthcare sign-in email was changed",
    html: `<p>Hi ${safeName},</p><p>The sign-in email for your Ahava Healthcare account was just changed to <strong>${masked}</strong>, and all other devices were signed out.</p><p><strong>If this wasn't you</strong>, contact support immediately and reset your password.</p>`,
  }).catch((err) => console.warn("[auth] email-changed notice failed:", (err as Error)?.message ?? err));
}

/** Best-effort "your password changed" email — the cue for someone who didn't do it. */
function notifyPasswordChanged(email: string, firstName: string, kind: "change" | "reset") {
  const safeName = firstName.replace(/[<>&"]/g, "");
  addEmailJob({
    to: email,
    subject: "Your Ahava Healthcare password was changed",
    html: `<p>Hi ${safeName},</p><p>The password for your Ahava Healthcare account was just ${kind === "reset" ? "reset using an emailed link" : "changed"}, and all other devices were signed out.</p><p><strong>If this wasn't you</strong>, reset your password immediately using "Forgot password?" on the sign-in page, and contact support.</p>`,
  }).catch((err) => console.warn("[auth] password-changed email failed:", (err as Error)?.message ?? err));
}

// ---------------------------------------------------------------------------
// GET /auth/verify-email?token=... — verify email address
// ---------------------------------------------------------------------------
router.get("/verify-email", async (req, res, next) => {
  try {
    const token = req.query.token as string;
    if (!token)
      return res.status(400).json({ error: "Verification token missing." });

    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: hashOneTimeToken(token),
        emailVerificationExpiry: { gt: new Date() },
      },
    });

    if (!user)
      return res
        .status(400)
        .json({ error: "Invalid or already-used verification link." });

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, emailVerificationToken: null, emailVerificationExpiry: null },
    });

    res.json({ success: true, message: "Email verified successfully." });
  } catch (error) {
    return next(error);
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

    const { token, tokenHash } = newOneTimeToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: tokenHash,
        emailVerificationExpiry: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
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
    return next(error);
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
      await prisma.user.update({
        where: { id: userId },
        data: { isVerified: true, emailVerificationToken: null, emailVerificationExpiry: null },
      });
      return res.json({ success: true, message: "Account manually verified." });
    } catch (error) {
      return res.status(500).json({ error: "Manual verification failed." });
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
export async function generateTokens(userId: string, role: string) {
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
