# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

# Install libc compatibility for native modules
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy lockfile and package manifest
COPY package.json package-lock.json ./

# Copy workspace package manifests for resolution
COPY packages/config/package.json ./packages/config/
COPY packages/export/package.json ./packages/export/
COPY packages/farm-nation/package.json ./packages/farm-nation/
COPY packages/marketplace/package.json ./packages/marketplace/
COPY packages/services/package.json ./packages/services/
COPY packages/types/package.json ./packages/types/

# Install ALL dependencies (including devDeps needed for build)
# --legacy-peer-deps matches Vercel's build behaviour for the nodemailer<->next-auth peer dep mismatch
RUN npm install --legacy-peer-deps


# ---- Stage 2: Build ----
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Cache-bust: Railway sets CACHEBUST to a unique value (e.g. timestamp) on every
# deploy via a build variable, ensuring COPY . . is never served from a stale layer.
# To set this in Railway: add a build variable CACHEBUST with value ${new Date().getTime()}
# or simply use the Railway UI "Redeploy" with "Clear build cache" option.
ARG CACHEBUST=20260520-v5
RUN echo "Cache bust: $CACHEBUST"

# Copy all source files (this layer is invalidated whenever CACHEBUST changes)
COPY . .

# Refresh workspace symlinks since source files are now copied
RUN npm install --legacy-peer-deps --prefer-offline --no-audit

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# ── Build memory ──────────────────────────────────────────────────────────────
# Node picks a default heap from the container's reported memory, and on Railway
# that lands well below what this build needs: ~836 TypeScript files compiled by
# webpack (next build --webpack), plus the Sentry plugin generating and widening
# source maps. The build died with
#   "FATAL ERROR: Ineffective mark-compacts near heap limit — heap out of memory".
#
# 4 GB is comfortably above observed usage. If the build still OOMs, raise the
# SERVICE memory in Railway first — this value cannot exceed what the container
# actually has.
ENV NODE_OPTIONS="--max-old-space-size=4096"

# ── NEXT_PUBLIC_* vars must be available at BUILD TIME so Next.js can inline
#    real values into the client-side JS bundle.  Declare as ARG (Railway passes
#    these from the service's environment variables during the Docker build),
#    then export as ENV so the `next build` process can read them.
#    Only the six (now unused) Firebase variables were declared here. Every
#    NEXT_PUBLIC_* variable NOT listed is inlined as undefined into the browser
#    bundle — it cannot be supplied at runtime. Missing ones included
#    NEXT_PUBLIC_APP_URL (referenced 28 times), the Supabase pair, Cloudinary,
#    Google Maps, and every per-module URL. Empty module URLs are the likely
#    origin of the production ERR_NAME_NOT_RESOLVED navigation failures that
#    were previously worked around in the module domain resolver.

# Core
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_URL
ARG NEXTAUTH_URL
ARG NEXTAUTH_SECRET

# Supabase — the live database and auth backend
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Uploads
ARG NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME

# Maps
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

# Per-module domains
ARG NEXT_PUBLIC_ACADEMY_URL
ARG NEXT_PUBLIC_COOPERATIVES_URL
ARG NEXT_PUBLIC_EXPORT_URL
ARG NEXT_PUBLIC_FARM_NATION_URL
ARG NEXT_PUBLIC_MARKETPLACE_URL
ARG NEXT_PUBLIC_WAVE_URL

# Misc
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_AT_SANDBOX_MODE

# Legacy Firebase values. Firebase is shimmed to Supabase and these are read by
# nothing; retained only so an existing Railway configuration keeps working.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_ACADEMY_URL=$NEXT_PUBLIC_ACADEMY_URL
ENV NEXT_PUBLIC_COOPERATIVES_URL=$NEXT_PUBLIC_COOPERATIVES_URL
ENV NEXT_PUBLIC_EXPORT_URL=$NEXT_PUBLIC_EXPORT_URL
ENV NEXT_PUBLIC_FARM_NATION_URL=$NEXT_PUBLIC_FARM_NATION_URL
ENV NEXT_PUBLIC_MARKETPLACE_URL=$NEXT_PUBLIC_MARKETPLACE_URL
ENV NEXT_PUBLIC_WAVE_URL=$NEXT_PUBLIC_WAVE_URL
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_AT_SANDBOX_MODE=$NEXT_PUBLIC_AT_SANDBOX_MODE
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

# ── TypeScript type-check (standalone tsc — works correctly in Docker).
# next build uses ignoreBuildErrors:true because Next.js's internal TypeScript
# worker cannot resolve files within the packages/ workspace in this environment.
# This standalone check maintains full type safety before the build.
RUN npx tsc --noEmit

# Build the Next.js app (outputs to .next/standalone due to output: "standalone")
RUN npm run build


# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner

# Install fontconfig and standard true-type fonts for server-side SVG text rendering
RUN apk add --no-cache fontconfig ttf-dejavu ttf-liberation

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy built standalone output (chown so nextjs user can write cache)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Pre-create the image cache directory so Next.js can write to it at runtime
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
