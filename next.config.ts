import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
    unoptimized: false,
  },
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  // Enable React strict mode for better performance debugging
  reactStrictMode: true,
  // Experimental features for better performance
  experimental: {
    optimizePackageImports: ['@heygen/liveavatar-web-sdk'],
  },
  // Headers for better caching
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
        ],
      },
    ];
  },
};

export default nextConfig;
