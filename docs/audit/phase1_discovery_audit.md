# Phase 1: Platform Discovery & Architecture Audit

This document establishes the ecosystem architecture map for the **Easy Sales Export** platform, evaluating the Hub, module mapping, and infrastructure services.

---

## 1. Hub Audit

The Hub functions as the central point of authentication, registration, onboarding redirection, and role-based access control (RBAC).

### 1.1 Authentication & Session Handling
- **Engine**: NextAuth.js (v5 Beta) integrated with Firebase Authentication REST API.
- **REST-based Auth**: Rather than relying on gRPC/sockets (which encounter build/edge compilation issues on Vercel), credentials are authenticated via a POST request to `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=...`.
- **Session Cookie Strategy**: Cross-domain sessions are preserved using a wildcard session cookie (`domain: ".easysalesexport.com"`, `path: "/"`, `sameSite: "lax"`, `secure: true`) so that authentication persists across subdomains.

### 1.2 Registration & Onboarding Redirection
- **Registration**: Handles Zod schema validation, phone number deduplication checks, and splits the name parameters (`firstName`, `lastName`, `otherName`) before writing to Firestore.
- **Auth Rollback**: If the Firestore write fails, the script triggers `adminAuth.deleteUser(uid)` to delete the newly created Firebase Auth account, preventing "Ghost User" (Auth exists, DB doc does not) states.
- **Redirection Logic**: Post-registration redirection uses `determinePostRegistrationRedirect` to check the user's selected platform:
  - Single platform select: Routes directly to the onboarding route (e.g. `/marketplace/onboarding`).
  - Multi-platform select: Uses role-based priority (e.g., WAVE, Cooperatives, Academy).
  - Defaults to `/dashboard`.
- **Profile Completeness**: Users are forced to fill in required fields through `updateUserProfileAction` in `src/app/actions/profile.ts`, which sets `profileComplete: true` in Firestore.

### 1.3 RBAC & Role Assignment
- **RBAC**: Handled via JWT token custom claims. A user's roles array determines permissions.
- **Legacy Password Reset Gating**: Onboarded legacy users have `requiresPasswordChange: true` set on their profile, forcing a redirect to `/auth/reset-legacy-password` on their first login.
- **Protected Actions**: Server actions implement security guards validating `auth()` and checking role arrays.
- **Manual Role Restrictions**: The role update modal restricts manual assignments to staff/admin roles (`general_user`, `field_officer`, `admin`, `super_admin`, `academy_admin`) to prevent administrators from manually toggling participant roles (which should only be set on application approval or legacy import).

### 1.4 Critical Architectural Defect: Inactive Middleware
> [!CAUTION]
> **Severe Issue: Inactive Middleware (`src/proxy.ts` vs `src/middleware.ts`)**
> - In commit `d440b863`, the Next.js middleware was renamed from `src/middleware.ts` to `src/proxy.ts`.
> - **Impact**: Next.js only executes middleware defined in `src/middleware.ts` or `middleware.ts`. Because it is named `proxy.ts`, Next.js compiles the build without middleware.
> - **Consequences**:
>   - Gated route protection (`isProtectedPath`) is completely bypassed in the middleware.
>   - Apex redirects (`easysalesexport.com` -> `www.easysalesexport.com`) do not run.
>   - Subdomain slug rewrites (e.g., mapping `academy.easysalesexport.com/` to `/academy`) are inactive.
>   - Zombie Session recovery never fires, locking users with expired cookies into login/redirect deadlocks.

---

## 2. Module Mapping

The ecosystem consists of six modules operating in a hub-and-spoke configuration:

| Module | URL Slug | Primary Firestore Collections | Key Onboarding Requirements | Dependencies |
|---|---|---|---|---|
| **Marketplace** | `marketplace` | `marketplace_products`, `seller_verifications`, `orders` | 5-step KYC pipeline (CAC doc, QoreID NIN verification, admin approval) | Paystack inline payments, Escrow ledgers |
| **Cooperatives** | `cooperatives` | `cooperative_members`, `cooperative_transactions`, `loans` | Tier Subscription payment (₦10k or ₦20k) | Compound interest credit limit calculator, Paystack |
| **Academy** | `academy` | `academy_courses`, `academy_applications`, `enrollments`, `certificates` | Course fee payment, sequential module completion | PDF certificate generation (`jsPDF`, `html2canvas`), LinkedIn OAuth sharing |
| **Farm Nation** | `farm-nation` | `land_listings`, `land_purchases`, `escrow` | Premium cooperative membership, legal zoning/zoning T&C agreement | Interactive maps (`leaflet`), verification queues |
| **WAVE** | `wave` | `wave_applications`, `wave_members`, `wave_briefing_registrations` | Live briefing attendance, female-gender verification check | Manual admin verification, NGO reporting metrics |
| **Export** | `export` | `export_bookings`, `export_opportunities` | Verified exporter status | Incoterms, Port slots date calendar |

---

## 3. Infrastructure Audit

Key backend infrastructure services:

- **Messaging**: Implemented in `messages.ts` with layout structures tracking active conversations.
- **Notifications**: Triggers database notifications for orders, approvals, and system broadcasts, tracking read/unread states.
- **Chatbot**: Logged in the `ai_chat_history` collection, tracking user context parameters.
- **Analytics Engine**: Centralized in `admin-analytics.ts` and `forensics.ts`, collecting counts and growth rates.
- **Escrow Engine**: Intermediate ledger mapping in the `escrow` collection, holding funds securely until buyer confirmation or dispute resolution.
- **Payment Engine**: Handled via Paystack inline API checkouts and custom webhooks in `api/webhooks/paystack/route.ts` to log completed transactions in `processedPayments`.
- **Communications**: Segmented cohort targeting (CSV, user roles) and announcements banner rendering with live previews.
- **Audit Logs**: Non-deletable tracking records saved in the `audit_logs` collection, logging `action`, `adminId`, `targetId`, and data maps.
