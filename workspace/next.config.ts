import type { NextConfig } from "next";

// `output: "standalone"` is required by the Docker/Railway production image.
// On Windows hosts without Developer Mode, creating the standalone symlinks
// fails with EPERM - set NEXT_OUTPUT_STANDALONE=false for local builds.

// Baseline browser protections for every page. Script/style 'unsafe-inline' is
// there because Next.js emits inline bootstrap scripts; there is no
// dangerouslySetInnerHTML in the app. Moving to nonces is the next hardening
// step. Google is allowed for Sign in with Google only.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Reset and verification links carry a token in the URL: never leak it.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework in every response.
  poweredByHeader: false,
  ...(process.env.NEXT_OUTPUT_STANDALONE === "false"
    ? {}
    : { output: "standalone" as const }),
  // The triage flow was "AI Doctor" at /patient/ai-doctor; keep old links working.
  async redirects() {
    return [{ source: "/patient/ai-doctor", destination: "/patient/symptom-check", permanent: true }];
  },
  // Google's sign-in popup talks back to the page with postMessage. The
  // default browser policy for some setups blocks that; this is the value
  // Google documents for pages that use Sign in with Google.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          ...securityHeaders,
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:10000"),
    NEXT_PUBLIC_BACKEND_URL:
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_URL ||
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000"),
  },
};

export default nextConfig;
