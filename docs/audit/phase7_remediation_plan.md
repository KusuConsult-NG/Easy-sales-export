# Phase 7: Root Cause Remediation Plan

This remediation plan outlines the proposed fixes for all findings identified during Phases 1–6 of the platform audit. No codebase fixes will be applied until you approve this plan.

---

## User Review Required

> [!IMPORTANT]
> - **Staging Gating**: All proposed changes will be applied and validated first in the staging environment.
> - **Manual Role Restrictions**: We propose restricting the admin's manual role editor to staff and admin roles. Toggling participant roles manually (e.g. `cooperative_member`, `academy_participant`) will be blocked. They must instead be assigned automatically upon application approval or legacy onboarding.
> - **Missing Paystack Payments**: 20 successful payments (17 Cooperative, 3 other modules) are missing from Firestore. We propose executing a backfill script to ingest these payments and restore user access.

---

## Proposed Remediation Changes

### 1. Hub Middleware Activation
- **Problem**: Next.js middleware is currently named [proxy.ts](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/proxy.ts) instead of `middleware.ts`. Next.js ignores it, disabling all route gating, subdomain slug rewrites, and zombie session clearings.
- **Severity**: **Critical (Security Gaping)**
- **Proposed Fix**: Rename [proxy.ts](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/proxy.ts) back to `src/middleware.ts` so Next.js executes the middleware at runtime.

### 2. User Management Role Restrictions
- **Problem**: Admins can change user roles to participant roles (like `cooperative_member`, `academy_participant`, etc.) via the manual role checkbox form. This bypasses the onboarding application/payment flows, creating users who have the role but no membership documents or payment records (affecting 72 users). This subsequently locks them out or triggers corruption checks.
- **Severity**: **High (RBAC / Data Integrity)**
- **Proposed Fix**: Restrict `ROLES_LIST` in [users/page.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/admin/users/page.tsx#L46) to only administrative, staff, and core roles:
  - `"admin"`, `"super_admin"`, `"field_officer"`, `"general_user"`, `"cooperative_admin"`, `"academy_admin"`, `"wave_admin"`, `"marketplace_admin"`, `"farm_nation_admin"`, `"export_admin"`
  - Remove participant roles (`cooperative_member`, `academy_participant`, `wave_participant`, `export_participant`, `farmer`, `seller`, `buyer`, `marketplace_buyer`, `land_owner`, `investor`) from the manual editor.

### 3. Cooperative Onboarding Lockout & Legacy Defaults
- **Problem**: In [layout.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/cooperatives/(member)/layout.tsx#L87), if a user has the `cooperative_member` role but no `cooperative_members` record (which happens to the 72 manually assigned users), it is flagged as "corrupted". The layout deletes their record, resets `serviceRegistrations.cooperative.status` to `pending_repair`, and redirects them to onboarding. Because the status is reset, they are forced to onboard again, and since they lack a payment record, they are asked to pay again.
- **Severity**: **High (User Lockout)**
- **Proposed Fix**:
  - In [layout.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/cooperatives/(member)/layout.tsx), instead of purging the user doc and marking them `pending_repair`, redirect them to a profile-rebuild setup step that automatically creates a valid membership record if they have the role or legacy flag, without blowing away their payment status.
  - In [ImportLegacyModal.tsx](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/components/admin/ImportLegacyModal.tsx), keep `services.academy` defaulting strictly to `module === "academy"` (currently correct) and ensure that duplicate details (same email or phone number) do not abort onboarding but instead merge/link profiles (already defensively structured).

### 4. Database-to-Gateway Transaction Backfill
- **Problem**: 20 successful Paystack transactions (totaling 17 Cooperative memberships of ₦10,000 each and 3 other payments) exist in Paystack logs but are missing from the Firestore `processedPayments` collection. This prevents these users from accessing their respective member dashboards.
- **Severity**: **High (Financial Parity)**
- **Proposed Fix**: Create and run a backfill script that reads `missing_paystack_transactions.json` and writes the corresponding `processedPayments` documents to Firestore. The script will also provision the associated `cooperative_members` records (setting `paymentStatus` to `completed` and `membershipStatus` to `active`).

### 5. User Management Pagination Performance
- **Problem**: [getUsersAction](file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/admin.ts#L1292) uses in-memory slicing, retrieving up to `(page + 1) * pageSize + 100` documents from Firestore on every request. As page numbers grow, query performance and read costs degrade significantly.
- **Severity**: **Medium (Performance & Cost)**
- **Proposed Fix**: Refactor `getUsersAction` to use Firestore query cursors (`startAfter`) for true page-based pagination.

---

## Verification Plan

### Staging Verification
- **Middleware Gating**: Verify that unauthorized page access redirects to `/auth/login` after renaming the file.
- **Manual Role Change**: Open the Admin user management panel and verify that only staff/admin roles are editable.
- **Transaction Backfill**: Execute the backfill script in the staging sandbox and verify that the 20 missing users are successfully active.
- **E2E Test Suite**: Run `npm run test` and `npm run test:e2e` to confirm no regressions.
