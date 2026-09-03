import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

export const ACCESS_TOKEN_COOKIE = "ahava_access_token";
export const REFRESH_TOKEN_COOKIE = "ahava_refresh_token";
const WS_TICKET_EXPIRES_IN_SECONDS = Math.max(
  15,
  parseInt(process.env.WS_TICKET_EXPIRES_IN_SECONDS ?? "60", 10) || 60,
);

type WebSocketTicketPayload = {
  userId: string;
  role: string;
  scope: "websocket";
};

function parseExpiry(value: string, fallbackSeconds: number): number {
  const numericValue = parseInt(value, 10);
  if (!Number.isNaN(numericValue)) {
    return numericValue;
  }

  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    return fallbackSeconds;
  }

  const amount = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 3600;
    case "d":
      return amount * 86400;
    default:
      return fallbackSeconds;
  }
}

function getCookieDomain(): string | undefined {
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  return configuredDomain ? configuredDomain : undefined;
}

function getCookieSecureFlag(req?: Pick<Request, "headers">): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const forwardedProto = req?.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.includes("https");
  }
  if (Array.isArray(forwardedProto)) {
    return forwardedProto.some((value) => value.includes("https"));
  }
  return true;
}

function getCookieSameSite(secure: boolean): "lax" | "none" | "strict" {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  if (configured === "strict") return "strict";
  if (configured === "none" && secure) return "none";
  return "lax";
}

function getCookieOptions(req?: Pick<Request, "headers">) {
  const secure = getCookieSecureFlag(req);
  return {
    httpOnly: true,
    secure,
    sameSite: getCookieSameSite(secure),
    path: "/",
    domain: getCookieDomain(),
  } as const;
}

export function getAccessTokenTtlMs(): number {
  const seconds = process.env.JWT_EXPIRES_IN
    ? parseExpiry(process.env.JWT_EXPIRES_IN, 900)
    : 900;
  return Math.max(60, seconds) * 1000;
}

export function getRefreshTokenTtlMs(): number {
  const seconds = process.env.REFRESH_TOKEN_EXPIRES_IN
    ? parseExpiry(process.env.REFRESH_TOKEN_EXPIRES_IN, 604800)
    : 604800;
  return Math.max(300, seconds) * 1000;
}

function parseCookies(headerValue?: string): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(";").reduce<Record<string, string>>((cookies, part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!key) {
      return cookies;
    }

    cookies[key] = decodeURIComponent(rawValue);
    return cookies;
  }, {});
}

export function getCookieValue(
  req: Pick<Request, "headers">,
  cookieName: string,
): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader || Array.isArray(cookieHeader)) {
    return null;
  }

  return parseCookies(cookieHeader)[cookieName] ?? null;
}

export function getAccessTokenFromRequest(req: Pick<Request, "headers">): string | null {
  return getCookieValue(req, ACCESS_TOKEN_COOKIE);
}

export function getRefreshTokenFromRequest(req: Pick<Request, "headers">): string | null {
  return getCookieValue(req, REFRESH_TOKEN_COOKIE);
}

export function setAuthCookies(
  res: Response,
  req: Pick<Request, "headers"> | undefined,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const cookieOptions = getCookieOptions(req);
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...cookieOptions,
    maxAge: getAccessTokenTtlMs(),
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...cookieOptions,
    maxAge: getRefreshTokenTtlMs(),
  });
}

export function clearAuthCookies(
  res: Response,
  req?: Pick<Request, "headers">,
): void {
  const cookieOptions = getCookieOptions(req);
  res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
}

export function createWebSocketTicket(userId: string, role: string): string {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not configured");
  }

  return jwt.sign(
    { userId, role, scope: "websocket" satisfies WebSocketTicketPayload["scope"] },
    process.env.JWT_SECRET,
    { expiresIn: WS_TICKET_EXPIRES_IN_SECONDS },
  );
}

export function verifyWebSocketTicket(ticket: string): WebSocketTicketPayload {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not configured");
  }

  const decoded = jwt.verify(ticket, process.env.JWT_SECRET) as Partial<WebSocketTicketPayload>;
  if (
    !decoded ||
    typeof decoded.userId !== "string" ||
    typeof decoded.role !== "string" ||
    decoded.scope !== "websocket"
  ) {
    throw new Error("Invalid websocket ticket");
  }

  return {
    userId: decoded.userId,
    role: decoded.role,
    scope: "websocket",
  };
}
