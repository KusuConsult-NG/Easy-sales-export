import type { NextConfig } from "next";
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },



  // Stamp the build time into the environment so Railway containers can be
  // distinguished from each other by DeploymentWatcher / /api/health.
  env: {
    BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },

  // Reduce serverless function bundle sizes by excluding packages
  // that are available natively in the Vercel runtime or unused server-side
  outputFileTracingExcludes: {
    '*': [
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
  
  // Exclude native binaries and packages causing build issues
  serverExternalPackages: [
    'firebase-admin',
    '@sentry/node',
    '@sentry/nextjs',
    '@opentelemetry/instrumentation',
    '@prisma/instrumentation'
  ],

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
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
  },

  // Compression
  compress: true,

  // Redirects
  async redirects() {
    return [
      {
        source: '/marketplace/product/:id',
        destination: '/marketplace/products/:id',
        permanent: true,
      },
      {
        source: '/login',
        destination: '/auth/login',
        permanent: true,
      },
      {
        source: '/register',
        destination: '/auth/register',
        permanent: true,
      },
    ];
  },

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
            value: 'camera=*, microphone=*, display-capture=*, geolocation=(self), payment=(self)'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ""} 'unsafe-inline' https://js.paystack.co https://www.googletagmanager.com https://meet.jit.si https://maps.googleapis.com`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              `connect-src 'self' ${process.env.NODE_ENV === 'development' ? "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*" : ""} https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.paystack.co https://api.cloudinary.com wss://*.firebaseio.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://*.jit.si wss://*.jit.si https://maps.googleapis.com https://maps.google.com`,
              "frame-src 'self' https://js.paystack.co https://checkout.paystack.com https://www.youtube.com https://youtube.com https://firebasestorage.googleapis.com https://docs.google.com https://*.jit.si",
              "media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              ...(process.env.NODE_ENV === 'development' ? [] : ["upgrade-insecure-requests"])
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

export default withSentryConfig(
  withAnalyzer(nextConfig),
  {
    // Suppress Sentry CLI output in build logs
    silent: !process.env.CI,

    // Automatically tree-shake Sentry logger statements in production
    disableLogger: true,

    // Upload wider set of files so stack traces resolve correctly
    widenClientFileUpload: true,

    // Tunnel Sentry requests through /monitoring to bypass ad-blockers
    tunnelRoute: '/monitoring',

    // Upload source maps to Sentry then delete them from the public bundle
    sourcemaps: { deleteSourcemapsAfterUpload: true },

    // Annotate React component names for session replay breadcrumbs
    reactComponentAnnotation: { enabled: true },

    // Disable automatic instrumentation overlay (we do it manually in instrumentation.ts)
    autoInstrumentServerFunctions: false,
  },
);

