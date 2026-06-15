import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getBackendBaseUrl(): string {
  return process.env.BACKEND_URL || "http://localhost:4000";
}

function stripHopByHopHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "accept-encoding",
    "origin",
  ].forEach((h) => out.delete(h));
  return out;
}

async function proxy(req: NextRequest, path: string[]) {
  const baseUrl = getBackendBaseUrl().replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/api/${path.join("/")}${req.nextUrl.search}`;

  const headers = stripHopByHopHeaders(req.headers);

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("content-length");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
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
