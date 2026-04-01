import type { NextConfig } from "next";
import path from "path";

// Railway frontend: set BACKEND_URL=https://backend-production-9a3b.up.railway.app (no trailing slash). See RAILWAY.md.
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Output standalone server for Docker deployment
  output: 'standalone',
  // Avoid Railpack excluding ".next" from deploy artifacts by using a non-dot dist dir
  distDir: 'next',
  // Monorepo: trace from repo root so Next.js doesn't warn about multiple lockfiles (pnpm at root, workspace has no lockfile or has package-lock.json)
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Suppress lockfile warnings in monorepo setup
  experimental: {
    optimizePackageImports: ['@mui/material', '@mui/icons-material'],
  },
  async rewrites() {
    // Proxy /api/* to backend → browser uses same-origin /api (no CORS, no NEXT_PUBLIC_API_URL)
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
