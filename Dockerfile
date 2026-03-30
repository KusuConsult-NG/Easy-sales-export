# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

# Install libc compatibility for native modules
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy lockfile and package manifest
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps needed for build)
RUN npm install


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

# Copy built standalone output
COPY --from=builder /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public folder
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
