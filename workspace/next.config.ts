import type { NextConfig } from "next";

// `output: "standalone"` is required by the Docker/Railway production image.
// On Windows hosts without Developer Mode, creating the standalone symlinks
// fails with EPERM - set NEXT_OUTPUT_STANDALONE=false for local builds.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_OUTPUT_STANDALONE === "false"
    ? {}
    : { output: "standalone" as const }),
  // Google's sign-in popup talks back to the page with postMessage. The
  // default browser policy for some setups blocks that; this is the value
  // Google documents for pages that use Sign in with Google.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
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
