# Easy Sales Export Platform: Comprehensive AI Briefing

This document provides a high-assurance overview of the **Easy Sales Export** platform. It is designed to give an AI coding assistant (Gemini) the necessary context to maintain, debug, and expand the ecosystem without redundant discovery.

---

## 1. Core Identity & Mission
**Easy Sales Export** is a federated digital ecosystem for **Rated Rolling Rab-World Nig Ltd**. It serves as a unified hub for Nigerian agricultural exporters, providing a secure bridge between local production and global markets.

- **Primary Goal**: Standardize and secure the agricultural export value chain through technology.
- **Key Programs**: 
    - **WAVE**: Female empowerment in agro-exports.
    - **Farm Nation**: Agricultural land optimization and discovery.
    - **Academy**: Export-readiness training and certification.
    - **Marketplace**: Escrow-backed multi-vendor commodity trading.
    - **Cooperatives**: Financial inclusion, loans, and collective savings.

---

## 2. Technical Architecture
The platform utilizes a **Hub-and-Spoke** architecture with federated domains.

- **Framework**: Next.js 15 (App Router).
- **Language**: TypeScript (Strict Mode).
- **Styling**: Vanilla CSS + Tailwind CSS 4.0.
- **Infrastructure**: Railway (Node.js Runtime).
- **Domain Strategy**: 
    - Root: `easysalesexport.com`
    - Subdomains: `academy.`, `marketplace.`, `wave.`, `cooperatives.`, `admin.`.
- **Inter-Module Communication**: Handled via a centralized `proxy.ts` (Edge-compatible logic running in Node middleware) that manages domain rewrites and session propagation.

---

## 3. Authentication & Security (RBAC)
The security model is the platform's most complex and critical layer, managing 36,000+ users across multiple domains.

- **Engine**: NextAuth.js (v5 Beta) integrated with Firebase Auth via the REST API (to bypass gRPC Edge limitations).
- **Session Management**: Cross-domain sessions are maintained via a `session_token` cookie scoped to the root domain (`.easysalesexport.com`).
- **RBAC**: A 12-role system (e.g., `SUPER_ADMIN`, `COOPERATIVE_ADMIN`, `MARKETPLACE_VENDOR`, `STUDENT`).
- **Middleware Protection**: `middleware.ts` intercepting requests to ensure session validity and prevent "Zombie Sessions" (stale cookies without valid server-side state).

---

## 4. Federated Modules (The Spoke System)
1. **The Hub**: Central entry point for profile management, KYC (BVN/NIN via QoreID), and module discovery.
2. **Easy Sales Academy**: A full LMS with video streaming, quiz engines, automated grading, and PDF certificate generation.
3. **Export Marketplace**: Multi-vendor platform with tiered pricing, inventory management, and an **Escrow Payment System**.
4. **Cooperative Portal**: Manages member contributions, loan applications with automated eligibility checks, and withdrawal workflows.
5. **WAVE Portal**: Specialized for the WAVE program, focusing on empowerment metrics, shipment tracking, and earnings dashboards.
6. **Admin Suite**: A high-assurance control center for bulk data operations, user resolution, financial auditing, and broadcast communications (SMS/In-App).

---

## 5. Data & Logic Strategy
- **Primary Database**: Google Cloud Firestore (NoSQL).
- **Data Patterns**:
    - **Atomic Operations**: Heavy use of server actions with strict validation via Zod.
    - **Batch Processing**: Strict 100-document limit enforcement for Firestore `batchGet` and `db.getAll` operations to ensure stability.
    - **Sanitization**: Centralized `resolveUsers` helper for safe batch document resolution.
- **Error Handling**: Global `error.tsx` boundaries with built-in "Hard Logout" recovery mechanisms to clear identity conflicts.

---

## 6. Recent Critical Remediations (The "State of the App")
As of May 2026, the following major stabilization tasks were completed:

- **Auth Loop Remediation**: Resolved "Partial Logout" traps by implementing centralized root-domain cookie clearing and a "Zombie Session" detection layer in the middleware.
- **Firestore Hardening**: Eliminated intermittent batch failures by refactoring all administrative loops to use strictly chunked (100-doc) parallelized fetches.
- **Deployment Stabilization**: Resolved silent Vercel crashes caused by gRPC build-time omissions in the NextAuth framework.

---

## 7. Development & Design Standards
- **Aesthetics**: Premium, modern UI focusing on **Glassmorphism**, vibrant gradients, and smooth micro-animations.
- **Responsive Standard**: All tables use the `ResponsiveTable` pattern; forms use `LoadingButton` for consistent feedback.
- **SEO**: Automated title tags, meta descriptions, and semantic HTML5 structures on every page.
- **Repository**: Managed in a specialized structure that separates the legacy discovery code from the production Next.js application.

---

### 💡 Pro-Tip for Gemini
When working on this codebase:
1. **Always check the root domain**: When clearing cookies or setting session state, ensure the domain is `.easysalesexport.com`.
2. **Mind the Edge**: Middleware runs on Vercel Edge; avoid Node.js-only libraries (like `fs` or native gRPC).
3. **Batch with Care**: Never loop Firestore queries; always use the chunked `Promise.all` patterns established in `loans.ts` and `cooperative-admin.ts`.
4. **Identity First**: Use the `auth()` helper to verify the user role before performing any action, especially in the multi-tenant module silos.
