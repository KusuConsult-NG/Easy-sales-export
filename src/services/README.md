# Centralized Services Layer

## CRITICAL DATA INTEGRITY DIRECTIVE

This directory contains the centralized aggregation services for the platform.
These services enforce the following NON-NEGOTIABLE rules:

1. **FIREBASE IS THE ONLY SOURCE OF TRUTH FOR:**
   - Users, Roles, Onboarding status, KYC status, Module membership, Escrow states, Cooperative balances, Loans, Certificates, Communications targeting, Analytics source data.

2. **PAYSTACK IS THE ONLY SOURCE OF TRUTH FOR:**
   - Payment confirmation, Transaction success, Settlement references, Financial verification.
   - NO payment is marked successful unless verified directly through Paystack.

3. **NO GUESS-BASED OR DERIVED UI LOGIC:**
   - The frontend must NEVER assume payments succeeded, infer balances, estimate metrics, or calculate financial truth independently.

4. **CENTRALIZED METRIC CALCULATIONS:**
   - All dashboards and admin pages MUST consume these shared services:
     - `finance.service.ts`
     - `analytics.service.ts`
     - `communications.service.ts`
     - `userMetrics.service.ts`

5. **IMMUTABLE LEDGER ARCHITECTURE:**
   - Financial records must never overwrite balances directly. All money movement must exist as immutable ledger entries (deposits, withdrawals, escrow locks/releases, commissions, loan disbursements/repayments).
   - Balances must be derived from ledger totals only.

6. **NO DUPLICATE QUERY LOGIC:**
   - No page should independently calculate approved users, pending users, escrow totals, revenue, or balances. All calculations originate here.

7. **CACHE INVALIDATION & REAL-TIME SYNCHRONIZATION:**
   - After any mutation, revalidate affected routes, refresh stale data, and force synchronization with Firebase truth.

8. **RECONCILIATION REQUIREMENT:**
   - Implement reconciliation checks comparing Paystack verified transactions VS Firestore stored records. Mismatches must be flagged automatically.

9. **VALIDATION BEFORE DEPLOYMENT:**
   - Compare dashboard data directly against Firebase collections.
   - Compare financial data directly against verified Paystack transactions.

10. **FINAL RULE:**
    - No UI metric, dashboard value, balance, or status should exist unless it can be traced directly back to Firebase or Paystack authoritative data.
