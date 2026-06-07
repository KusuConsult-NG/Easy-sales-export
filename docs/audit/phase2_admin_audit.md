# Phase 2: Admin Suite Forensic Audit

This forensic audit evaluates the Administrative Suite ( Command Center) of the **Easy Sales Export** platform as a standalone control platform.

---

## 1. Dashboard & Analytics Validation

### 1.1 KPI & Metric Verification
- **KPI Summary Cards**: Real-time summary cards display Active Users, Platform Verified Participants, Month-over-Month Revenue Growth, and Pending Approvals.
- **Aggregation Source of Truth**: Metric cards fetch server-side Firestore `count()` aggregations directly instead of counting in-memory from paginated arrays (fixing the previous pagination-vs-count undercounting bug).
- **Calculations**:
  - `totalRevenue`: Summed from Paystack successful transactions in pages (`tx.amount / 100`). Falls back to Firestore `processedPayments` aggregation where `status == "completed"` if the Paystack API key is not present.
  - `pendingPayoutAmount`: Sum of `cooperative_withdrawals` and `wave_withdrawals` with status `approved_pending_payout`.
  - `userSegments`:
    - `active`: Users logged in within the last 30 days (`lastLoginAt >= Date.now() - 30 days`).
    - `pending`: Unverified users (`total - verified`).
    - `stalled`: Capped difference (`Math.max(0, verified - active)`).
- **Mathematical Inconsistency**: The calculation for `stalled` assumes active users and unverified users are disjoint, which is not necessarily true (active users can be unverified). This can lead to slightly skewed segmentation values in the user segment pie charts.

---

## 2. User Management & Governance

### 2.1 Pagination and Filtering
- **Pagination**: The User Management table pagination is described in specifications as "Cursor-Based Infinite Pagination" at the client level (`useAdminData`). However, the server action `_getUsersAction` computes pagination by calculating an offset in-memory: `const offset = page * pageSize` and slices the fetched query.
- **Performance Impact**: For page offsets, the query fetches up to `FETCH_LIMIT = (page + 1) * pageSize + 100` documents from Firestore. On very high page numbers, database read cost scales linearly rather than remaining constant (which is what a true Firestore `startAfter()` cursor would achieve).
- **Filtering**: Supports robust multi-dimensional filtering by `role`, `status` (`verified`/`unverified`), `state`, and `lga` in-memory to prevent missing composite indexes in Firestore.
- **Exports**: Extracted fields (Name, Email, Phone, Role, Verified Date) are exported directly into CSV format using `Blob` URLs in the browser.

### 2.2 Profile Edits & Role Updates
- **Profile Edits**: Manually updating name, email, phone, location, bio, or bank details is allowed. Identity fields like `gender` and `dateOfBirth` are excluded from standard profile updates to prevent identity manipulation (e.g. for WAVE demographic checks).
- **Role Updates**: Manual updates are restricted strictly to staff/admin roles (`general_user`, `field_officer`, `admin`, `super_admin`, `academy_admin`). User participant roles (e.g. `wave_participant`, `cooperative_member`) are automatically preserved during updates and cannot be toggled from this panel.
- **Audit Trails**: Every edit is recorded in `audit_logs` tracking the before and after state maps alongside the administrator's ID.

---

## 3. Operations & Support Systems

### 3.1 Communications Targeting
- **Segmentation**: The targeting engine maps user cohorts:
  - `"All Users"`
  - `"Active Last 30 Days"`
  - `"Fully Verified Sellers"`
  - `"WAVE Only"`
  - Custom CSV-uploaded lists of email addresses.
- **Broadcasts**: Live Alert banners are saved, including real-time previews and color-coded priority flags.

### 3.2 Content Approvals & disputes
- **Approval Queue**: Aggregates pending items from three collections: `products` (Marketplace), `land_listings` (Farm Nation), and `export_catalog` (Export Hub).
- **Rejection Workflow**: Enforces a strict Zod-validated `rejectionReason` (between 5 and 500 characters) via `rejectContentAction` before updating document statuses.
- **Disputes Escalation**: Unresolved buyer-seller dispute cases are assigned to a specific admin using `assignDisputeAction`. This writes a dispute log, sets the `assignedAdminId`, and dispatches an in-app notification to the assigned staff member.

### 3.3 Feature Toggles & Maintenance
- **Toggles Matrix**: Super-admins can manually toggle features globally or roll them out to targeted roles/users.
- **Rollback Audits**: Toggle changes trigger `createAdminAuditLog` containing previous state and new state keys.
- **Maintenance Gating**: Gated endpoints dynamically evaluate feature states using `hasFeatureAccess` before processing.

---

## 4. Finance & Ledgers

- **Ledger Verification**: Track all commissions, withdrawals, and loan products.
- **Paystack Webhook Sync**: Double-verifies completed checkouts by listening to webhooks, matching Paystack transaction references, and logging them in `processedPayments`.
- **Payout Approvals**: Withdrawal states are modified from `pending` -> `approved_pending_payout` -> `completed` / `rejected`.
