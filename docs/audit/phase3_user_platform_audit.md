# Phase 3: User Platform Audit

This audit evaluates each of the six user-facing modules of the **Easy Sales Export** platform independently.

---

## 1. Digital Export Marketplace

- **Onboarding & KYC**: Verification requires a 5-step pipeline: (1) Profile completeness, (2) Corporate Affairs Commission (CAC) document uploads, (3) Identity verification (NIN/BVN via QoreID), (4) Admin queue review, (5) Storefront activation.
- **Storefront & Product Catalog**: Verified sellers manage product lists. Catalog displays items with dynamic Tiered Pricing (Retail, Bulk, Export Tonnage) calculated based on purchase quantity.
- **Orders state machine**: Tracks orders across 8 states:
  `pending_payment` → `payment_secured` → `processing` → `in_transit` → `delivered` → `completed` (funds cleared) / `rejected` (releasing escrow locks).
- **Escrow & disputes**: Checkout checks place funds into an intermediate escrow account. Dispute triggers freeze release, locking payouts until admin review.

---

## 2. Cooperatives

- **Membership payments**: Requires a Paystack payment of ₦10,000 (Basic) or ₦20,000 (Premium). Subscriptions map unique member IDs (`${cooperativeId}_${userId}`) to prevent double registrations.
- **Savings lifecycle**: Goals have locked terms (1, 3, 6, 12 months) with early-withdrawal penalties. Natural maturity appends interest APR bonuses.
- **Loans eligibility**: Maximum loan limit is computed algorithmically: `(Total Savings * Tier Multiplier) - Overdrafts`. Repayments apply a custom compound interest amortization calculation.
- **Credit bridging**: Approved members can checkout in the Marketplace using cooperative credit balance directly.

---

## 3. Easy Sales Academy (LMS)

- **Enrollment**: Access is gated by course registration and payments.
- **Progression**: Sequential player blocks users from skipping lessons.
- **Assessments**: Timed quiz pages with auto-submission guards upon window focus loss. Progression is weighted: 70% lesson completion, 30% quiz scores.
- **Certification**: Generates certificates using `jsPDF` and `html2canvas` in-browser. Verification utilizes unique URLs (`/academy/verify/[id]`) and QR codes matching the `certificates` collection.

---

## 4. Farm Nation

- **Listing & Discovery**: Gated real-estate search. Owner info is hidden until a buyer formally logs purchase interest to prevent off-platform transactions.
- **Purchases & Escrow**: Initiating a purchase locks the listing (`status = "pending"`) and sets up an escrow transaction. Requires agreement to zoning terms.

---

## 5. Women’s Agripreneur Value-Chain (WAVE)

- **Gender Gating**: The `/wave` path is guarded. Client application checks gender; male applicants are blocked during form validation or auto-rejected in server actions.
- **Dashboard & Resources**: Active female members access SME resources, announcements, and demographic visualizations.

---

## 6. Export Logistics

- **Slot Booking**: stepper workflow covering specs (moisture, quality), incoterms (FOB/CIF), shipping line slots, and certificate checklist (phytosanitary, origin).
- **Export Calendar**: date picker mapping ship schedules and active export windows.
