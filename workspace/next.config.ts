import type { NextConfig } from "next";
import path from "path";

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
};

export default nextConfig;
