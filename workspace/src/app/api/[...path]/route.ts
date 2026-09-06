import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getBackendBaseUrl(): string {
  return process.env.BACKEND_URL || "http://localhost:4000";
}

const UPSTREAM_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS ?? 30_000);

/**
 * Headers we are willing to pass upstream.
 *
 * This used to be a denylist, which forwarded anything a caller invented -
 * including X-Forwarded-For, which the API keys rate limits on and records as
 * the client IP on every audit log entry. An allowlist means a header reaches
 * the API only because we decided it should.
 */
const FORWARDED_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "idempotency-key",
  "referer",
  "user-agent",
  "x-ahava-auth-mode",
  "x-request-id",
];

function buildUpstreamHeaders(req: NextRequest): Headers {
  const out = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value) out.set(name, value);
  }

  // The API's CSRF guard needs to know which page made this request. The raw
  // Origin is not forwarded because it would confuse the API's CORS layer, so
  // it travels under its own name.
  const origin = req.headers.get("origin");
  if (origin) out.set("x-forwarded-origin", origin);

  return out;
}

/** Reject traversal and absolute URLs smuggled through the catch-all segment. */
function isSafePathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\")
  );
}

async function proxy(req: NextRequest, path: string[]) {
  if (!path.every(isSafePathSegment)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const baseUrl = getBackendBaseUrl().replace(/\/+$/, "");
  const targetPath = path.map(encodeURIComponent).join("/");
  const targetUrl = `${baseUrl}/api/${targetPath}${req.nextUrl.search}`;

  const headers = buildUpstreamHeaders(req);

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.arrayBuffer();
  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const resHeaders = new Headers(upstream.headers);
    resHeaders.delete("content-length");
    resHeaders.delete("content-encoding");
    resHeaders.delete("transfer-encoding");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "The service took too long to respond. Please try again." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Could not reach the service. Please try again." },
      { status: 502 },
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}
