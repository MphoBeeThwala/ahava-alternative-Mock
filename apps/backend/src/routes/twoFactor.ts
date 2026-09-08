/**
 * Opt-in TOTP two-factor auth (AH-29).
 *
 * Setup flow: POST /setup generates and stores an (unverified) secret ->
 * POST /verify-setup proves possession of it and flips totpEnabled on,
 * handing back ten backup codes exactly once. From then on, POST
 * /auth/login returns a short-lived "twofa_pending" token instead of a
 * session for that user, and the client completes the login at
 * POST /login-verify with that token plus a TOTP or backup code.
 *
 * Disabling requires the current password AND a valid code — a hijacked
 * session alone cannot turn this off.
 */
import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import Joi from "joi";
import { authMiddleware, AuthenticatedRequest, invalidateCachedUser } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import prisma from "../lib/prisma";
import { getRedis } from "../services/redis";
import { verifyToken, TokenTypeError } from "../services/tokens";
import { setAuthCookies } from "../services/authSession";
import { generateTokens } from "./auth";
import {
  generateTotpSecret,
  getTotpProvisioningUri,
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from "../services/totp";

const router: Router = Router();

const LOGIN_VERIFY_MAX_ATTEMPTS = 5;
const LOGIN_VERIFY_LOCKOUT_SECONDS = 900;

const codeSchema = Joi.string().pattern(/^\d{6}$/).required().messages({
  "string.pattern.base": "Code must be 6 digits",
});
const backupCodeSchema = Joi.string().pattern(/^[0-9A-F]{5}-[0-9A-F]{5}$/i);

function buildAuthUser(user: {
  id: string; email: string; firstName: string; lastName: string;
  role: string; isActive: boolean; isVerified: boolean; preferredLanguage: string;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    isVerified: user.isVerified,
    preferredLanguage: user.preferredLanguage,
  };
}

function loginVerifyLockKey(userId: string): string {
  return `auth:2fa:lockout:${userId}`;
}

async function isLoginVerifyLocked(userId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const attempts = await redis.get(loginVerifyLockKey(userId));
    return Number(attempts ?? 0) >= LOGIN_VERIFY_MAX_ATTEMPTS;
  } catch {
    return false;
  }
}

async function recordLoginVerifyFailure(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = loginVerifyLockKey(userId);
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, LOGIN_VERIFY_LOCKOUT_SECONDS);
  } catch {
    /* redis unavailable — this attempt is simply not rate-limited */
  }
}

async function clearLoginVerifyFailures(userId: string): Promise<void> {
  try {
    await getRedis().del(loginVerifyLockKey(userId));
  } catch {
    /* redis unavailable — nothing to clear */
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/setup — generate a pending secret + QR provisioning URI
// ---------------------------------------------------------------------------
router.post("/setup", authMiddleware, authRateLimiter, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.totpEnabled) {
      return res.status(409).json({ error: "Two-factor authentication is already enabled" });
    }

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptTotpSecret(secret) },
    });

    res.json({
      success: true,
      secret,
      otpauthUrl: getTotpProvisioningUri(secret, user.email),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/verify-setup — prove possession of the secret, turn 2FA on
// ---------------------------------------------------------------------------
router.post("/verify-setup", authMiddleware, authRateLimiter, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { error, value } = Joi.object({ code: codeSchema }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.totpSecret) {
      return res.status(400).json({ error: "Call /2fa/setup first" });
    }
    if (user.totpEnabled) {
      return res.status(409).json({ error: "Two-factor authentication is already enabled" });
    }

    const secret = decryptTotpSecret(user.totpSecret);
    if (!verifyTotpCode(secret, value.code)) {
      return res.status(400).json({ error: "Invalid code" });
    }

    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpBackupCodes: hashedBackupCodes },
    });
    await invalidateCachedUser(user.id);

    res.json({
      success: true,
      message: "Two-factor authentication enabled",
      backupCodes, // shown exactly once — the client must display these now
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/disable — requires current password AND a valid code
// ---------------------------------------------------------------------------
router.post("/disable", authMiddleware, authRateLimiter, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { error, value } = Joi.object({
      password: Joi.string().required(),
      code: Joi.alternatives().try(codeSchema, backupCodeSchema).required(),
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.passwordHash || !user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ error: "Two-factor authentication is not enabled" });
    }

    const validPassword = await bcrypt.compare(value.password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const secret = decryptTotpSecret(user.totpSecret);
    const validTotp = verifyTotpCode(secret, value.code);
    const backupResult = validTotp
      ? null
      : await consumeBackupCode(value.code, user.totpBackupCodes);

    if (!validTotp && !backupResult?.matched) {
      return res.status(401).json({ error: "Invalid code" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });
    await invalidateCachedUser(user.id);

    res.json({ success: true, message: "Two-factor authentication disabled" });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/login-verify — completes a login that returned
// twoFactorRequired. Not behind authMiddleware: the caller has no session
// yet, only the short-lived pendingToken from /auth/login.
// ---------------------------------------------------------------------------
router.post("/login-verify", authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      pendingToken: Joi.string().required(),
      code: Joi.alternatives().try(codeSchema, backupCodeSchema).required(),
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    let userId: string;
    try {
      ({ userId } = verifyToken(value.pendingToken, "twofa_pending"));
    } catch (err) {
      if (err instanceof TokenTypeError) {
        return res.status(401).json({ error: "Invalid or expired login session" });
      }
      return res.status(401).json({ error: "Invalid or expired login session" });
    }

    if (await isLoginVerifyLocked(userId)) {
      return res.status(429).json({
        error: "Too many failed codes. Please log in again from the start.",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      return res.status(401).json({ error: "Invalid or expired login session" });
    }

    const secret = decryptTotpSecret(user.totpSecret);
    const validTotp = verifyTotpCode(secret, value.code);
    let remainingBackupCodes: string[] | null = null;

    if (!validTotp) {
      const backupResult = await consumeBackupCode(value.code, user.totpBackupCodes);
      if (!backupResult.matched) {
        await recordLoginVerifyFailure(userId);
        return res.status(401).json({ error: "Invalid code" });
      }
      remainingBackupCodes = backupResult.remaining;
    }

    await clearLoginVerifyFailures(userId);
    if (remainingBackupCodes) {
      await prisma.user.update({
        where: { id: user.id },
        data: { totpBackupCodes: remainingBackupCodes },
      });
    }

    const { accessToken, refreshToken } = await generateTokens(user.id, user.role);
    setAuthCookies(res, req, { accessToken, refreshToken });

    res.json({
      success: true,
      user: buildAuthUser(user),
      ...(req.get("X-Ahava-Auth-Mode") !== "cookie" ? { accessToken, refreshToken } : {}),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
