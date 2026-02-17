import type { NextConfig } from "next";

// Set on Railway frontend service to your backend URL (e.g. https://backend-production-9a3b.up.railway.app). Used at build time for rewrites.
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone', // for Docker / production deploy
  async rewrites() {
    // Proxy /api/* to backend → browser uses same-origin /api (no CORS, no NEXT_PUBLIC_API_URL)
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
