# Technical Architecture Document (TAD): Easy Sales Export Platform

> **Status:** Production Stable (Phase 10 Hardened)  
> **Last Updated:** May 2026  
> **Target Audience:** Developers, System Architects, Stakeholders

## 1. Executive Summary
The Easy Sales Export platform is a high-fidelity, multi-module digital ecosystem designed to facilitate agricultural export, capability building, and financial inclusion. Built on a modern **Next.js 15+** and **Firebase** stack, the platform integrates e-commerce (Marketplace), education (Academy LMS), fintech (Cooperative), and logistics (Export Engine) into a unified experience with high-assurance security and administrative oversight.

---

## 2. System Architecture Overview

The platform follows a **Serverless-First, Hybrid Cloud** architecture.

### 2.1 High-Level Architecture Diagram
```mermaid
graph TD
    User((End User))
    Admin((Administrator))

    subgraph "Frontend Layer (Vercel)"
        NextJS["Next.js 15+ App Router"]
        Tailwind["Tailwind CSS 4.0 (UI/UX)"]
        AuthJS["NextAuth.js v5 (Session Mgmt)"]
    end

    subgraph "Backend Services (Firebase / External)"
        Firestore[(Firestore NoSQL)]
        FAuth[Firebase Auth REST API]
        FStorage[Firebase Storage]
        FFunc[Firebase Functions]
        Redis[(Upstash Redis - Rate Limit/Cache)]
    end

    subgraph "Integrations"
        Paystack[Paystack API]
        Resend[Resend / Email]
        Sudo[Sudo Africa (Cards)]
        Sentry[Sentry (Monitoring)]
    end

    User --> NextJS
    Admin --> NextJS
    NextJS --> AuthJS
    NextJS --> Firestore
    NextJS --> Redis
    AuthJS --> FAuth
    NextJS --> Paystack
    NextJS --> Resend
    FFunc --> Firestore
```

---

## 3. Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Framework** | Next.js 15 (App Router) | React 19 support, Server Actions, Optimized Rendering. |
| **Language** | TypeScript | Type safety across complex module boundaries. |
| **Styling** | Tailwind CSS 4.0 | Performance, JIT compiler, Dark Mode support. |
| **Auth** | NextAuth v5 + Firebase REST | Robust session management without Edge runtime crashes. |
| **Database** | Firestore | Real-time synchronization, horizontal scalability. |
| **Caching** | Upstash Redis | Global low-latency rate limiting and profile caching. |
| **Payments** | Paystack | Localized financial settlement (Nigeria focus). |
| **Monitoring** | Sentry + Redis Telemetry | Deep visibility into serverless crashes and performance. |

---

## 4. Core Architectural Patterns

### 4.1 12-Role RBAC (Role-Based Access Control)
The platform utilizes a **Dual-Track Access Control** system:
1.  **JWT Custom Claims**: Injected via NextAuth session. Used for fast, edge-compatible route protection (e.g., `/admin`).
2.  **Service Registrations**: Firestore-based state (Approved/Pending/Rejected) for module-specific feature access (e.g., WAVE participation, Loan eligibility).

### 4.2 Server Actions & Safe Actions
Mutations are handled exclusively via **Next.js Server Actions**.
- **Auth Guard**: Every action validates the session before execution.
- **Zod Validation**: Input schemas are strictly enforced.
- **Optimistic Locking**: Prevents race conditions in financial transactions.

### 4.3 High-Assurance Data Path (Admin)
To ensure data integrity for administrators managing thousands of records:
- **Server-Side Aggregations**: Uses Firestore `count()` operators for headline metrics.
- **Cursor-Based Pagination**: Employs `lastVisible` document cursors to prevent record skipping during high-velocity updates.
- **Zero-Trust Validation**: Admin actions are logged with "Before/After" snapshots in the `audit_logs` collection.

---

## 5. Functional Module Breakdown

### 5.1 Digital Export Marketplace
- **B2B Engine**: Focuses on high-grade commodities (Yam, Sesame, Hibiscus).
- **Escrow Settlement**: Funds are held in a platform-managed ledger until delivery confirmation.
- **Tiered Pricing**: Dynamic price shifting based on MOQ (Retail vs. Bulk vs. Export).

### 5.2 Easy Sales Academy (LMS)
- **Sequential Learning**: Enforces module completion before exam unlocking.
- **Client-Side Certs**: Real-time PDF generation via `jsPDF`.
- **Public Verification**: QR-code backed verification portal for external validation.

### 5.3 Cooperative & Fintech
- **Loan Amortization**: Algorithmic eligibility based on savings-to-loan multipliers.
- **Tiered Subs**: Subscription-based benefits (Basic/Premium).
- **Automated Penalties**: Temporal locks on savings with penalty-based early withdrawal.

### 5.4 Farm Nation (Real Estate)
- **Verified Listings**: High-assurance plot discovery.
- **Geo-Fencing**: Integrated with Google Maps/Leaflet for spatial visualization.

---

## 6. Infrastructure & Security

### 6.1 Deployment Strategy
- **Frontend**: Vercel (Global Edge Network).
- **Backend Infrastructure**: Railway (CRON jobs, custom background workers).
- **Persistence**: Firebase (Google Cloud Platform).

### 6.2 Security Hardening
- **REST over gRPC**: Explicitly uses Firebase REST API to bypass Vercel's Node.js dependency limits.
- **Rate Limiting**: Sliding window rate limiting on login and payment endpoints via Redis.
- **CSRF Protection**: Native NextAuth session cookie security.

---

## 7. Data Flow: Payment Lifecycle
1.  **Initiation**: User triggers `initializePaymentAction`.
2.  **Redirect**: User settles via Paystack Inline Popup.
3.  **Verification**: Next.js Server Action verifies `reference` directly with Paystack API.
4.  **Fulfillment**: Atomic Firestore update creates `transaction` record and updates user `serviceRegistrations`.
5.  **Notification**: Real-time push (FCM) or Email (Resend) dispatched to user.

---

## 8. Maintenance & Monitoring
- **Error Tracking**: Sentry captures exceptions in real-time.
- **Audit Logs**: Every administrative change is recorded with metadata (IP, AdminID, Timestamp).
- **Backup**: Weekly Firestore automated exports to GCS.

---

> **Document Owner:** Architecture Team  
> **Contact:** tech-leads@easysalesexport.com
