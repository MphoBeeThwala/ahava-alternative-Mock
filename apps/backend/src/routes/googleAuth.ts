/**
 * Sign in with Google, for patients only (docs/ENGINEERING_PLAN.md §43).
 *
 * Rules that make this safe in a healthcare app:
 *  - Staff are never reachable through Google. Nurses, doctors and admins
 *    keep invite + password + mandatory 2FA; a Google identity can only
 *    create or resolve a PATIENT, and an email that belongs to a staff
 *    account is refused. The role never comes from the client.
 *  - Identities are matched on Google's `sub`, never on email, and the email
 *    must be verified by Google.
 *  - An existing password account is NEVER linked automatically. The patient
 *    must confirm that account's password (and a 2FA code if they've turned
 *    it on) first. That blocks pre-hijacking: someone registering a victim's
 *    email with a password, or a Google account that merely claims the same
 *    address, can't take over or be merged into a real record.
 *  - A patient who has opted into 2FA still gets the 2FA step after Google.
 *  - A nonce held in an httpOnly cookie ties the ID token to the browser that
 *    asked for it, so a token can't be injected into someone else's session.
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import * as bcrypt from "@node-rs/bcrypt";
import Joi from "joi";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { authMiddleware, AuthenticatedRequest, requirePatient } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { buildAuthResponse, generateTokens } from "./auth";
import {
  GOOGLE_PROVIDER, GoogleProfile, GoogleTokenError, googleWebClientId, isGoogleSignInEnabled,
  namesFrom, verifyGoogleIdToken,
} from "../services/googleIdentity";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "../services/loginThrottle";
import { clearTransientCookie, getCookieValue, setAuthCookies, setTransientCookie } from "../services/authSession";
import { signToken, verifyToken, TWOFA_PENDING_TTL_SECONDS } from "../services/tokens";
import { verifyReauthentication } from "../services/reauth";
import { auditSignIn } from "../services/signInAudit";
import { writeRequestAudit } from "../services/clinicalAudit";
import { seedBaselineForUser } from "../services/baselineSeed";
import { addEmailJob } from "../services/queue";

const router: Router = Router();

const NONCE_COOKIE = "ahava_google_nonce";
const NONCE_TTL_MS = 5 * 60 * 1000;
const LINK_TOKEN_TTL_SECONDS = 600;

const SESSION_USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, role: true,
  isActive: true, isVerified: true, preferredLanguage: true, totpEnabled: true,
} as const;

type SessionUser = Prisma.UserGetPayload<{ select: typeof SESSION_USER_SELECT }>;

const sessionUserView = (u: SessionUser) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role,
  isActive: u.isActive, isVerified: u.isVerified, preferredLanguage: u.preferredLanguage,
});

/** Every Google endpoint is a 404 until GOOGLE_CLIENT_ID is configured. */
const requireEnabled = (_req: Request, res: Response, next: () => void) => {
  if (!isGoogleSignInEnabled()) return res.status(404).json({ error: "Google sign-in is not available.", code: "GOOGLE_DISABLED" });
  return next();
};

const NOT_AVAILABLE = {
  error: "Google sign-in isn't available for this account. Sign in with your email and password.",
  code: "GOOGLE_NOT_AVAILABLE",
} as const;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Issue the normal session, or the 2FA step if this patient turned 2FA on. */
async function completeSignIn(req: Request, res: Response, user: SessionUser, method: string) {
  if (user.totpEnabled) {
    await auditSignIn(req, "LOGIN_2FA_PENDING", user, { method });
    const pendingToken = signToken(
      { userId: user.id, role: user.role, typ: "twofa_pending" },
      { expiresInSeconds: TWOFA_PENDING_TTL_SECONDS },
    );
    return res.json({ success: true, twoFactorRequired: true, pendingToken });
  }
  const { accessToken, refreshToken } = await generateTokens(user.id, user.role);
  await auditSignIn(req, "LOGIN_SUCCESS", user, { method });
  setAuthCookies(res, req, { accessToken, refreshToken });
  return res.json(buildAuthResponse(req, { success: true, user: sessionUserView(user) }, { accessToken, refreshToken }));
}

function notifyGoogleChange(email: string, firstName: string, kind: "linked" | "unlinked") {
  const safeName = firstName.replace(/[<>&"]/g, "");
  addEmailJob({
    to: email,
    subject: `Google sign-in ${kind} on your Ahava Healthcare account`,
    html: `<p>Hi ${safeName},</p><p>Sign in with Google was just <strong>${kind}</strong> ${kind === "linked" ? "to" : "from"} your Ahava Healthcare account.</p><p><strong>If this wasn't you</strong>, reset your password using "Forgot password?" on the sign-in page and contact support.</p>`,
  }).catch((err) => console.warn("[google] notice email failed:", (err as Error)?.message ?? err));
}

// What the sign-in page needs to decide whether to show the button.
router.get("/config", (_req, res) => {
  res.json({ enabled: isGoogleSignInEnabled(), clientId: googleWebClientId() });
});

// Issue a nonce for the page to hand to Google, and remember it in a cookie.
router.post("/nonce", requireEnabled, authRateLimiter, (req, res) => {
  const nonce = crypto.randomBytes(24).toString("base64url");
  setTransientCookie(res, req, NONCE_COOKIE, nonce, NONCE_TTL_MS);
  res.json({ nonce });
});

const signInSchema = Joi.object({ credential: Joi.string().max(4096).required() });

router.post("/", requireEnabled, authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = signInSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const expectedNonce = getCookieValue(req, NONCE_COOKIE);
    clearTransientCookie(res, req, NONCE_COOKIE); // single use, whatever happens next

    let profile: GoogleProfile;
    try {
      profile = await verifyGoogleIdToken(value.credential);
    } catch (err) {
      if (err instanceof GoogleTokenError) {
        await auditSignIn(req, "LOGIN_FAILED", null, { reason: "google_token_invalid", method: "google" });
        return res.status(401).json({ error: "We couldn't verify your Google sign-in. Please try again.", code: "GOOGLE_TOKEN_INVALID" });
      }
      throw err;
    }
    if (!expectedNonce || !profile.nonce || !safeEqual(expectedNonce, profile.nonce)) {
      await auditSignIn(req, "LOGIN_FAILED", null, { reason: "google_nonce_mismatch", method: "google" });
      return res.status(401).json({ error: "This sign-in attempt expired. Please try again.", code: "GOOGLE_NONCE_INVALID" });
    }
    if (!profile.emailVerified) {
      return res.status(401).json({ error: "Your Google email address isn't verified.", code: "GOOGLE_EMAIL_UNVERIFIED" });
    }

    // 1. A Google account we already know.
    const identity = await prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: GOOGLE_PROVIDER, subject: profile.subject } },
      include: { user: { select: SESSION_USER_SELECT } },
    });
    if (identity) {
      const user = identity.user;
      if (user.role !== "PATIENT") {
        await auditSignIn(req, "LOGIN_FAILED", user, { reason: "google_staff_blocked", method: "google" });
        return res.status(403).json(NOT_AVAILABLE);
      }
      if (!user.isActive) {
        await auditSignIn(req, "LOGIN_FAILED", user, { reason: "deactivated", method: "google" });
        return res.status(401).json({ error: "Account is deactivated" });
      }
      await prisma.authIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date(), email: profile.email } });
      return completeSignIn(req, res, user, "google");
    }

    // 2. An existing account with this email: never merge silently.
    const existing = await prisma.user.findUnique({ where: { email: profile.email }, select: SESSION_USER_SELECT });
    if (existing) {
      if (existing.role !== "PATIENT") {
        await auditSignIn(req, "LOGIN_FAILED", existing, { reason: "google_staff_blocked", method: "google" });
        return res.status(403).json(NOT_AVAILABLE);
      }
      if (!existing.isActive) return res.status(401).json({ error: "Account is deactivated" });
      const linkToken = signToken(
        { userId: existing.id, role: existing.role, typ: "google_link", idpSubject: profile.subject },
        { expiresInSeconds: LINK_TOKEN_TTL_SECONDS },
      );
      return res.json({
        success: false,
        linkRequired: true,
        linkToken,
        email: existing.email,
        needsTwoFactorCode: existing.totpEnabled,
      });
    }

    // 3. Nobody has this email: create a patient. Role is fixed here, not taken from the client.
    const { firstName, lastName } = namesFrom(profile);
    let created: SessionUser;
    try {
      created = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email: profile.email, passwordHash: null, firstName, lastName, role: "PATIENT", isVerified: true },
          select: SESSION_USER_SELECT,
        });
        await tx.authIdentity.create({
          data: { userId: u.id, provider: GOOGLE_PROVIDER, subject: profile.subject, email: profile.email, lastUsedAt: new Date() },
        });
        return u;
      });
    } catch (err) {
      // Two sign-ins racing on the same new account: the loser tries again as a returning user.
      if ((err as { code?: string })?.code === "P2002") {
        return res.status(409).json({ error: "Please try signing in again.", code: "GOOGLE_RETRY" });
      }
      throw err;
    }
    await writeRequestAudit({
      userId: created.id, userRole: created.role, action: "CREATE", resource: "Auth", resourceId: created.id,
      metadata: { event: "GOOGLE_SIGNUP" }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
    });
    setImmediate(() => { seedBaselineForUser(created.id).catch((e) => console.error("[google] baseline seed failed:", e)); });
    return completeSignIn(req, res, created, "google");
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/google/link — confirm the existing account's password to link
// ---------------------------------------------------------------------------
const linkSchema = Joi.object({
  linkToken: Joi.string().max(4096).required(),
  password: Joi.string().max(200).required(),
  code: Joi.alternatives()
    .try(Joi.string().pattern(/^\d{6}$/), Joi.string().pattern(/^[0-9A-F]{5}-[0-9A-F]{5}$/i))
    .optional(),
});

router.post("/link", requireEnabled, authRateLimiter, async (req, res, next) => {
  try {
    const { error, value } = linkSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    let userId: string;
    let subject: string | undefined;
    try {
      ({ userId, idpSubject: subject } = verifyToken(value.linkToken, "google_link"));
    } catch {
      return res.status(401).json({ error: "This link request expired. Start again with Google sign-in.", code: "GOOGLE_LINK_EXPIRED" });
    }
    if (!subject) return res.status(401).json({ error: "This link request expired. Start again with Google sign-in.", code: "GOOGLE_LINK_EXPIRED" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_USER_SELECT });
    if (!user || user.role !== "PATIENT" || !user.isActive) return res.status(403).json(NOT_AVAILABLE);

    // This is password guessing, so it shares the login throttle.
    const ip = req.ip ?? "";
    const block = await checkLoginAllowed(user.email, ip);
    if (block.blocked) {
      res.set("Retry-After", String(block.retryAfterSeconds));
      return res.status(429).json({ error: "Too many failed attempts. Try again later.", code: "LOGIN_THROTTLED" });
    }
    const proof = await verifyReauthentication(user.id, { currentPassword: value.password, code: value.code });
    if (!proof.ok) {
      if (proof.status === 401) {
        await recordLoginFailure(user.email, ip);
        await auditSignIn(req, "LOGIN_FAILED", user, { reason: "google_link_bad_proof", method: "google" });
      }
      return res.status(proof.status).json({ error: proof.error, code: proof.code });
    }
    await clearLoginFailures(user.email, ip);

    const already = await prisma.authIdentity.findFirst({ where: { userId: user.id, provider: GOOGLE_PROVIDER } });
    if (already && already.subject !== subject) {
      return res.status(409).json({ error: "A different Google account is already linked. Unlink it first.", code: "GOOGLE_ALREADY_LINKED" });
    }
    if (!already) {
      try {
        await prisma.authIdentity.create({
          data: { userId: user.id, provider: GOOGLE_PROVIDER, subject, email: user.email, lastUsedAt: new Date() },
        });
      } catch (err) {
        if ((err as { code?: string })?.code === "P2002") {
          return res.status(409).json({ error: "That Google account is already linked to another account.", code: "GOOGLE_IN_USE" });
        }
        throw err;
      }
      await writeRequestAudit({
        userId: user.id, userRole: user.role, action: "UPDATE", resource: "Auth", resourceId: user.id,
        metadata: { event: "GOOGLE_LINKED" }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
      });
      notifyGoogleChange(user.email, user.firstName, "linked");
    }

    // Password (and 2FA code, if enabled) were just proven, so no second 2FA step.
    const { accessToken, refreshToken } = await generateTokens(user.id, user.role);
    await auditSignIn(req, "LOGIN_SUCCESS", user, { method: "google_link" });
    setAuthCookies(res, req, { accessToken, refreshToken });
    return res.json(buildAuthResponse(req, { success: true, user: sessionUserView(user) }, { accessToken, refreshToken }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Signed-in patient: see and remove the Google link
// ---------------------------------------------------------------------------
router.get("/status", authMiddleware, requirePatient, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [identity, user] = await Promise.all([
      prisma.authIdentity.findFirst({ where: { userId: req.user!.id, provider: GOOGLE_PROVIDER }, select: { email: true, createdAt: true } }),
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } }),
    ]);
    res.json({ success: true, enabled: isGoogleSignInEnabled(), linked: !!identity, googleEmail: identity?.email ?? null, hasPassword: !!user?.passwordHash });
  } catch (error) { return next(error); }
});

// Unlinking needs the password, and refuses if there isn't one: a Google-only
// patient who unlinked would have no way left to sign in.
router.delete("/", authMiddleware, requirePatient, authRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = Joi.object({
      password: Joi.string().max(200).required(),
      code: Joi.alternatives().try(Joi.string().pattern(/^\d{6}$/), Joi.string().pattern(/^[0-9A-F]{5}-[0-9A-F]{5}$/i)).optional(),
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, role: true, email: true, firstName: true, passwordHash: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.passwordHash) {
      return res.status(400).json({ error: "Set a password first (use \"Forgot password?\" on the sign-in page) so you can still sign in.", code: "PASSWORD_REQUIRED" });
    }
    const proof = await verifyReauthentication(user.id, { currentPassword: value.password, code: value.code });
    if (!proof.ok) return res.status(proof.status).json({ error: proof.error, code: proof.code });

    const { count } = await prisma.authIdentity.deleteMany({ where: { userId: user.id, provider: GOOGLE_PROVIDER } });
    if (count > 0) {
      await writeRequestAudit({
        userId: user.id, userRole: user.role, action: "UPDATE", resource: "Auth", resourceId: user.id,
        metadata: { event: "GOOGLE_UNLINKED" }, ipAddress: req.ip, userAgent: req.get("User-Agent"),
      });
      notifyGoogleChange(user.email, user.firstName, "unlinked");
    }
    return res.json({ success: true, unlinked: count > 0 });
  } catch (error) { return next(error); }
});

export default router;
