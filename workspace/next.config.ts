import type { NextConfig } from "next";

// Railway frontend: set BACKEND_URL=https://backend-production-9a3b.up.railway.app (no trailing slash). See RAILWAY.md.
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    // Proxy /api/* to backend → browser uses same-origin /api (no CORS, no NEXT_PUBLIC_API_URL)
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
