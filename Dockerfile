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

# Copy all source files
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

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
