import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../../worker-configuration";

export interface User {
  id: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  createdAt?: Date;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const sessionCookie = getCookie(c, "ahava_auth_session");

  console.log("Session check - Cookie header:", sessionCookie ? "present" : "missing");

  if (!sessionCookie) {
    console.log("Session check - No token found, returning null user");
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Get session from database
    const sessionResult = await (c.env as Env).DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?"
    )
      .bind(sessionCookie, new Date().toISOString())
      .first<{ user_id: string; expires_at: string }>();

    if (!sessionResult) {
      console.log("Session check - Session not found or expired");
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Get user from database
    const userResult = await (c.env as Env).DB.prepare(
      "SELECT id, email FROM user WHERE id = ?"
    )
      .bind(sessionResult.user_id)
      .first<{ id: string; email: string }>();

    if (!userResult) {
      console.log("Session check - User not found");
      return c.json({ error: "Unauthorized" }, 401);
    }

    console.log("Session check - Token found: true");
    console.log("Session check - Session data found: true");
    console.log("Session check - Returning user:", userResult);

    // Attach user to context
    c.set("user", {
      id: userResult.id,
      email: userResult.email,
    } as any);

    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as User | undefined;
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Get user profile to check role
    const profile = await (c.env as Env).DB.prepare(
      "SELECT role FROM profiles WHERE user_id = ?"
    )
      .bind(user.id)
      .first<{ role: string }>();

    if (!profile || !roles.includes(profile.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}

