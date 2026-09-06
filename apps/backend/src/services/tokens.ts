/**
 * Token issuing and verification.
 *
 * Every JWT this service issues carries a `typ` claim naming what it is for,
 * and every verifier states which type it will accept. Before this module
 * existed, access tokens, refresh tokens and WebSocket tickets were signed
 * with the same secret and the same payload, so any one of them was accepted
 * anywhere a token was read — which meant a 7-day refresh token worked as an
 * API credential and survived logout, because revocation only ever deleted
 * the stored refresh-token row.
 *
 * Verification is also pinned: a fixed algorithm allowlist plus issuer and
 * audience, so moving to asymmetric keys later cannot become an algorithm
 * confusion bug.
 *
 * NOTE: tokens issued before this module shipped carry no `typ`, `iss` or
 * `aud` and are rejected. Deploying this signs every current session out.
 */
import jwt from "jsonwebtoken";

export const TOKEN_ISSUER = "ahava-api";
export const TOKEN_AUDIENCE = "ahava-app";
export const TOKEN_ALGORITHM = "HS256" as const;

export type TokenType = "access" | "refresh" | "websocket";

export interface AhavaTokenPayload {
  userId: string;
  role: string;
  typ: TokenType;
}

/** Raised when a token verifies cryptographically but is the wrong kind. */
export class TokenTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenTypeError";
  }
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
  return secret;
}

export function signToken(
  payload: { userId: string; role: string; typ: TokenType },
  options: { expiresInSeconds: number; jwtid?: string },
): string {
  return jwt.sign(
    { userId: payload.userId, role: payload.role, typ: payload.typ },
    getJwtSecret(),
    {
      algorithm: TOKEN_ALGORITHM,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: options.expiresInSeconds,
      ...(options.jwtid ? { jwtid: options.jwtid } : {}),
    },
  );
}

/**
 * Verify a token and assert it is the expected kind.
 *
 * Throws jsonwebtoken's own errors for signature/expiry problems (callers
 * already branch on `TokenExpiredError`), and TokenTypeError when the token
 * is valid but was issued for a different purpose.
 */
export function verifyToken(token: string, expected: TokenType): AhavaTokenPayload {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: [TOKEN_ALGORITHM],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  }) as Partial<AhavaTokenPayload> | string;

  if (!decoded || typeof decoded === "string" || typeof decoded.userId !== "string" || !decoded.userId) {
    throw new TokenTypeError("Token payload is missing a user");
  }

  if (decoded.typ !== expected) {
    throw new TokenTypeError(
      `Expected a ${expected} token but received ${decoded.typ ?? "an untyped token"}`,
    );
  }

  return {
    userId: decoded.userId,
    role: typeof decoded.role === "string" ? decoded.role : "",
    typ: expected,
  };
}
