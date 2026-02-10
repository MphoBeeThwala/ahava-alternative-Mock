import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // for Docker / production deploy
};

export default nextConfig;
