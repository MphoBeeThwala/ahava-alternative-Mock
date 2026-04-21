/**
 * Custom Authentication System for Cloudflare Workers
 * Replaces Mocha with a simple, working solution
 */

import { GoogleAuth } from "arctic";
import { generateId } from "arctic";

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: number;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
  token: string;
}

/**
 * Create Google OAuth client
 */
export function createGoogleAuth(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials not configured");
  }

  return new GoogleAuth(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${env.APP_URL || "http://localhost:5173"}/api/auth/callback/google`
  );
}

/**
 * Generate session token
 */
export function generateSessionToken(): string {
  return generateId(32);
}

/**
 * Create or get user from database
 */
export async function getOrCreateUser(
  db: D1Database,
  email: string,
  name: string,
  emailVerified: boolean = true
): Promise<User> {
  // Check if user exists
  const existing = await db
    .prepare("SELECT * FROM user WHERE email = ?")
    .bind(email)
    .first<User>();

  if (existing) {
    return existing;
  }

  // Create new user
  const id = generateId(15);
  const now = Date.now();

  await db
    .prepare(
      "INSERT INTO user (id, email, emailVerified, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, email, emailVerified ? 1 : 0, name, now, now)
    .run();

  return {
    id,
    email,
    name,
    emailVerified,
    createdAt: now,
  };
}

/**
 * Create session in database
 */
export async function createSession(
  db: D1Database,
  userId: string,
  token: string,
  expiresIn: number = 60 * 60 * 24 * 7 // 7 days
): Promise<Session> {
  const id = generateId(15);
  const expiresAt = Date.now() + expiresIn * 1000;
  const now = Date.now();

  await db
    .prepare(
      "INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, userId, token, expiresAt, now, now)
    .run();

  return {
    id,
    userId,
    expiresAt,
    token,
  };
}

/**
 * Get session from token
 */
export async function getSessionByToken(
  db: D1Database,
  token: string
): Promise<{ session: Session; user: User } | null> {
  const session = await db
    .prepare("SELECT * FROM session WHERE token = ? AND expiresAt > ?")
    .bind(token, Date.now())
    .first<Session>();

  if (!session) {
    return null;
  }

  const user = await db
    .prepare("SELECT * FROM user WHERE id = ?")
    .bind(session.userId)
    .first<User>();

  if (!user) {
    return null;
  }

  return { session, user };
}

/**
 * Delete session
 */
export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM session WHERE token = ?").bind(token).run();
}

/**
 * Get session from cookie
 */
export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const sessionCookie = cookies.find((c) => c.startsWith("ahava_auth_session="));

  if (!sessionCookie) return null;

  return sessionCookie.split("=")[1] || null;
}

