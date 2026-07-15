# Easy Sales Export - Platform Architecture & Developer Handover Guide

This repository contains the Next.js hub application for the **Easy Sales Export** platform. It operates as a monorepo leveraging npm workspaces for modular package distribution.

---

## 1. Directory Structure & Architecture

```text
easy-sales-export-nextjs/
├── src/
│   ├── app/                  # Next.js App Router pages and Server Actions
│   │   ├── actions/          # Server Actions for modules (auth, analytics, payment, etc.)
│   │   ├── api/              # API Route Handlers (health, webhooks, auth callbacks)
│   │   └── (routes)/         # UI route segments (admin, academy, marketplace, etc.)
│   ├── components/           # Client/Server React UI Components
│   ├── infrastructure/       # Interfaces to third-party integrations (sms, chatbot)
│   ├── lib/                  # Central core libraries and utility integrations
│   │   ├── auth.ts           # NextAuth v5 configuration and authorize logic
│   │   ├── supabase.ts       # Supabase Client initializers
│   │   ├── supabase-db.ts    # Custom PostgREST / Firestore-like database query adapter
│   │   ├── user-cache.ts     # User profile caching layer (Redis-backed)
│   │   └── session-guard.ts  # Middleware security checks and self-healing sessions
│   └── services/             # Core business logic service layers (analytics, etc.)
├── scripts/                  # Project utilities (data seeding, webp optimizations)
└── packages/                 # Monorepos workspaces (@easysales/types, @easysales/ui, etc.)
```

---

## 2. Core Workflows & Logic

### A. Authentication & Just-In-Time (JIT) Migration
The platform uses **NextAuth v5** for session management and **Supabase Auth** as the primary identity provider, with a fallback database connection to **Firebase Auth** for accounts created prior to the Supabase migration.

1. **Pre-Validation (`src/app/actions/auth.ts`)**:
   - Validates user input schemas using Zod.
   - Runs a login attempt check against the rate limiter.
   - Attempts password validation via Supabase Auth.
   - **JIT Migration**: If the user is not found in Supabase Auth, the system validates the credentials against Firebase Auth via REST API. If successful, it provisions the user in Supabase Auth and migrates their legacy profiles.

2. **NextAuth Authorize (`src/lib/auth.ts`)**:
   - Manages credentials sign-in and resolves the user ID mapping.
   - Returns the user session token objects.
   - Safely guards against infinite self-referential redirection loops if the user’s legacy `_migratedTo` metadata references their current Supabase ID.

3. **Session Guard (`src/lib/session-guard.ts`)**:
   - Active middleware helper running checks on session active flags, bans/suspensions, and profile completion states.

---

### B. Rate Limiting (`src/lib/rate-limit.ts`)
We use **Upstash Redis** to maintain sliding-window rate limiters.
- **Login Rate Limiter**: Enforces a strict maximum of 5 failed login attempts in a sliding 15-minute window.
- **Key Schema**: Uses `@upstash/login_limit:login_<email>*` to isolate lockouts per email address.
- **Fallback Store**: Automatically falls back to a thread-safe, in-memory `Map` (via `rate-limiter-fallback.ts`) if the Redis connection is unavailable.

---

### C. Analytics Service (`src/services/analytics.service.ts`)
The admin dashboard performs rolling aggregations across all users (active/onboarding splits, status segments, and module registrations).
- **Subfield JSONB Selection**: Utilizes PostgREST JSONB subfield filters (`select('raw_data->serviceRegistrations,...')`) to load minimal user documents, enabling fast in-memory segmentation of all 41,000+ users.
- **Caching Layer**: Persists the calculated dashboard counts in Redis (`admin:user-segments-counts`) for 10 minutes to guarantee instantaneous subsequent page loads.

---

## 3. Local Development

### Prerequisites
- Node.js >= 22.12.0
- npm >= 10.8.2
- A local `.env.local` containing Supabase, Firebase, and Redis connection keys.

### Running the App
```bash
# Install dependencies
npm install

# Run the Next.js development server
npm run dev

# Run unit and integration tests (Jest)
npm run test
```

### Running Seeding and Seeding Tasks
```bash
# Seed products, wave, land, or cooperatives
npm run seed

# Run the data integrity auditing scripts
npm run audit:data
```

---

## 4. Deployments

Deployments are hosted on **Railway** utilizing Docker containerization.
- **Production Pipeline**: Auto-builds from pushes to `origin/main`.
- **Staging Pipeline**: Pushes to the `staging` remote on `main` branch.
- **Manual Force Deployment**:
  ```bash
  railway up
  ```
