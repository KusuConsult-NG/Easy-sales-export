import type { NextConfig } from "next";
import withBundleAnalyzer from '@next/bundle-analyzer';

const nextConfig: NextConfig = {
  // Reduce serverless function bundle sizes by excluding packages
  // that are available natively in the Vercel runtime or unused server-side
  outputFileTracingExcludes: {
    '*': [
      // Sharp is not used server-side (Next.js image optimization uses its own)
      'node_modules/sharp/**',
      // SWC native binaries are only needed at build time, not runtime
      'node_modules/@next/swc-*/**',
      // Prisma (if accidentally installed)
      'node_modules/.prisma/**',
      'node_modules/prisma/**',
      // Test frameworks
      'node_modules/jest/**',
      'node_modules/@jest/**',
    ],
  },

  // Misc
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",

  // Experimental
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },

  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 365, // 1 year
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
  },

  // Compression
  compress: true,

  // Security headers
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
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'  // Changed from SAMEORIGIN to DENY for better security
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self)'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.paystack.co https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.paystack.co wss://*.firebaseio.com https://firebasestorage.googleapis.com https://storage.googleapis.com",
              "frame-src 'self' https://js.paystack.co https://checkout.paystack.com https://www.youtube.com https://youtube.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests"
            ].join('; ')
          }
        ]
      }
    ];
  },
};

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withAnalyzer(nextConfig);

