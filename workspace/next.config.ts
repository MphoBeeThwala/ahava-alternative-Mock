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
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:10000",
  },
};

export default nextConfig;
