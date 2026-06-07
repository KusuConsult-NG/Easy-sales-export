# Phase 7: Root Cause Remediation Plan

This remediation plan outlines the proposed fixes for all findings identified during Phases 1–6 of the platform audit, including the root cause of the missing onboarding details bug. No codebase fixes will be applied until you approve this plan.

---

## User Review Required

> [!IMPORTANT]
> - **Self-Healing Profile Recovery**: Instead of deleting member profiles when name fields are missing or `"undefined"`, the system will preserve all other data (BVN, address, next of kin, documents) and put the user in a `pending_repair` onboarding state. This loads their existing data in the onboarding client so they can easily fix their first/last names and resubmit.
> - **Legacy Auto-Provision Guard**: We will restrict the legacy member auto-provisioning function (`autoProvisionLegacyCooperative`) to only execute when `userData.legacyOnboardedBy` is explicitly set in their user document, and we will prevent it from overwriting records where the user has already submitted/completed onboarding.
> - **Strict userId Database Integrity**: We will ensure that the `userId` field is explicitly written to every cooperative member record in all actions (`registerCooperativeMemberAction`, `resubmitCooperativeApplicationAction`, etc.) so that queries checking `where("userId", "==", userId)` consistently return correct records.

---

## Proposed Remediation Changes

### 1. Cooperative Onboarding Details & Destructive Layout Purge
- **Problem**: 
  1. `registerCooperativeMemberAction` and `resubmitCooperativeApplicationAction` write to `cooperative_members` but do not include the `userId` field in the document payload. Thus, queries looking for `.where("userId", "==", userId)` (such as `getMembershipAction` and `getCooperativeApplicationAction`) return empty, falsely claiming "no membership found" and returning blank forms to users.
  2. `autoProvisionLegacyCooperative` was running for normal paid users, overwriting their status and details with generic name fields from user documents, which sometimes contained `"undefined"` string values.
  3. `layout.tsx` performed a destructive check: if names were `"undefined"` or missing, it deleted the `cooperative_members` document from Firestore entirely. This caused users who completed onboarding to lose all their next-of-kin, BVN, address, and document uploads.
- **Severity**: **Critical (Data Loss & Lockout)**
- **Proposed Fix**:
  - **In `_actions.ts`**:
    - Include `userId: userId` inside `registerCooperativeMemberAction`'s write payload.
    - Include `userId: session.user.id` inside `resubmitCooperativeApplicationAction`'s write payload.
    - Restrict `autoProvisionLegacyCooperative` to only run for users with `legacyOnboardedBy` set, and prevent overwrites if `onboardingCompleted` is already true.
    - Add direct document ID lookup fallbacks to `getMembershipAction`, `getCooperativeApplicationAction`, and `resubmitCooperativeApplicationAction`, healing the document by adding the missing `userId` field on the fly.
    - Wrap the returned application data in `getCooperativeApplicationAction` in `{ application: data, revisionNote: data.revisionNote || null }` to resolve the frontend mismatch.
  - **In `layout.tsx`**:
    - Remove the destructive `delete()` calls. Instead, mark the user doc status as `"pending_repair"` and redirect them to `/cooperatives/onboarding?notice=complete-your-registration&edit=true`.
  - **In `OnboardingClient.tsx`**:
    - Allow `"pending_repair"` to trigger the edit pre-population mode so the user can see their existing details, fix their names, and resubmit.

### 2. Hub Middleware Activation
- **Problem**: Next.js middleware is currently named `proxy.ts` instead of `middleware.ts`. Next.js ignores it, disabling all route gating, subdomain slug rewrites, and zombie session clearings.
- **Severity**: **Critical (Security Gaping)**
- **Proposed Fix**: Rename `proxy.ts` to `src/middleware.ts`.

### 3. User Management Role Restrictions
- **Problem**: Admins can change user roles to participant roles (like `cooperative_member`, `academy_participant`, etc.) via the manual role checkbox form. This bypasses the onboarding application/payment flows, creating users who have the role but no membership documents or payment records (affecting 72 users).
- **Severity**: **High (RBAC / Data Integrity)**
- **Proposed Fix**: Restrict `ROLES_LIST` in `users/page.tsx` to only administrative, staff, and core roles. Remove participant roles from the manual editor.

### 4. Database-to-Gateway Transaction Backfill
- **Problem**: 20 successful Paystack transactions (17 Cooperative, 3 other modules) exist in Paystack logs but are missing from the Firestore `processedPayments` collection.
- **Severity**: **High (Financial Parity)**
- **Proposed Fix**: Create and run a backfill script that reads `missing_paystack_transactions.json` and writes the corresponding `processedPayments` and `cooperative_members` documents to Firestore.

---

## Verification Plan

### Staging Verification
- **Middleware Gating**: Verify that unauthorized page access redirects to `/auth/login` after renaming the file.
- **Cooperative Restoration**: Simulate a corrupted profile, verify it is redirected to onboarding, edit page loads existing data, and resubmission heals the database record with the `userId` field present.
- **E2E Test Suite**: Run `npm run test` and `npm run test:e2e` to confirm no regressions.
