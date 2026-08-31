export function getRealtimeBackendBaseUrl(): string | null {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/api\/?$/, "");

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return null;
  }

  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://localhost:4000";
  }

  return null;
}

export function getRealtimeWebSocketUrl(token: string): string | null {
  const baseUrl = getRealtimeBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const wsBase = baseUrl
    .replace(/^https/, "wss")
    .replace(/^http/, "ws")
    .replace(/\/+$/, "");

  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}
