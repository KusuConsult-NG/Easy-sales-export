# Phase 8: Staging Validation

This document defines the staging validation protocols, test checklists, and expected outcomes to verify the remediation fixes proposed in Phase 7.

---

## 1. Staging Environment Checklist

All tests must be conducted on the Staging environment matching the production database structure.

| Verification Item | Target File / Area | Validation Method | Expected Result |
|---|---|---|---|
| **Middleware Gating** | `/src/middleware.ts` | Try accessing `/dashboard` or `/cooperatives/dashboard` without logging in. | Redirects automatically to `/auth/login`. |
| **Domain Slug Rewrites** | `/src/middleware.ts` | Access a simulated subdomain path (e.g. `wave.easysalesexport.com/`). | Rewrites internally to `/wave` without URL change. |
| **Manual Role Gating** | `src/app/admin/users/page.tsx` | Open the "Manage Roles" modal in the admin users list. | Only administrative/staff roles appear. Participant roles are hidden. |
| **Transaction Backfill** | Firestore `processedPayments` | Execute database verification query for the 20 Paystack transactions. | Transactions exist, matching users have `status: active` and `paymentStatus: completed`. |
| **Onboarding Bypasses** | `/cooperatives/onboarding` | Log in as a legacy member and browse to cooperatives onboarding. | Skip directly to profile details / dashboard without checkout prompts. |
| **Pagination Query** | `src/app/actions/admin.ts` | Load the users management table on page 2, 5, and 10. | Table loads successfully with correct pagination tokens/cursors. |

---

## 2. Test Step Details

### Step 2.1: Middleware Security Gating
1. Log out of the application in staging.
2. Direct-access the following paths:
   - `/cooperatives/dashboard`
   - `/academy/dashboard`
   - `/farm-nation/dashboard`
   - `/admin`
3. Verify that the application redirects you to `/auth/login` for each.
4. Verify that NextAuth cookies are correctly set and no infinite redirect loops occur.

### Step 2.2: Admin User Role Restrictions
1. Log in as a super admin.
2. Browse to the Admin Users Management panel (`/admin/users`).
3. Click "Manage Roles" on any user.
4. Verify that you can only toggle staff roles (`admin`, `super_admin`, `field_officer`, etc.).
5. Check if `cooperative_member`, `academy_participant`, or `wave_participant` checkboxes are completely removed.

### Step 2.3: Paystack Transaction Reconciliation & Backfill
1. Run the backfill script using:
   ```bash
   npx tsx scripts/backfill-paystack-transactions.js
   ```
2. Query the users collection for the 20 affected accounts.
3. Verify that `serviceRegistrations.cooperatives.status` is `"approved"` and `paymentStatus` is `"completed"`.
4. Verify that the users can now successfully log in and enter the cooperatives dashboard without being kicked out.

---

## 3. Rollback Procedures
If any regressions occur during staging validation:
1. Revert changes to `middleware.ts` by renaming it back to `proxy.ts`.
2. Revert `src/app/admin/users/page.tsx` to restore the full `ROLES_LIST`.
3. In Firestore, run a rollback query to mark backfilled transactions as `reverted_backfill` if required.
