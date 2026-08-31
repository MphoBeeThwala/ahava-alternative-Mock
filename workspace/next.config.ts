import type { NextConfig } from "next";

// `output: "standalone"` is required by the Docker/Railway production image.
// On Windows hosts without Developer Mode, creating the standalone symlinks
// fails with EPERM - set NEXT_OUTPUT_STANDALONE=false for local builds.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_OUTPUT_STANDALONE === "false"
    ? {}
    : { output: "standalone" as const }),
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
