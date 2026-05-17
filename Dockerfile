# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

# Install libc compatibility for native modules
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy lockfile and package manifest
COPY package.json package-lock.json ./

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
ARG CACHEBUST=20260517-v6
RUN echo "Cache bust: $CACHEBUST"

# Copy all source files (this layer is invalidated whenever CACHEBUST changes)
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# ── NEXT_PUBLIC_* vars must be available at BUILD TIME so Next.js can inline
#    real values into the client-side JS bundle.  Declare as ARG (Railway passes
#    these from the service's environment variables during the Docker build),
#    then export as ENV so the `next build` process can read them.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXTAUTH_URL
ARG NEXTAUTH_SECRET

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET

# Build the Next.js app (outputs to .next/standalone due to output: "standalone")
RUN npm run build


# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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
