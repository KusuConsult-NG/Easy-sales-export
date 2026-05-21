# Bug Investigation Report

**Date:** <!-- YYYY-MM-DD -->  
**Reported by:** <!-- Name / Support ticket / User report -->  
**Module:** <!-- Cooperative | Academy | WAVE | Marketplace | Export | Farm-Nation | Hub | Admin -->  
**Severity:** <!-- Critical | High | Medium | Low -->  
**Status:** <!-- Investigating | Root Cause Identified | Fix In Progress | Fix In Staging | Resolved -->

---

## Symptom

> What the user sees or reports. Exact error message if available.

---

## Reproduction Steps

1. 
2. 
3. 

---

## Root Cause

> **No guessing. Cite exact file paths and line numbers.**

The root cause is:

**File:** `src/app/...`  
**Lines:** L__ – L__  
**What is wrong:**  

---

## Affected Scope

### Modules
- [ ] Cooperative
- [ ] Academy
- [ ] WAVE
- [ ] Marketplace
- [ ] Export
- [ ] Farm-Nation
- [ ] Hub / Auth / Profile
- [ ] Admin
- [ ] Messaging
- [ ] Notifications

### Services
- [ ] Firebase Auth
- [ ] Firestore
- [ ] Firebase Storage
- [ ] Paystack (payments)
- [ ] Resend (email)
- [ ] Redis (cache/session)
- [ ] NextAuth session
- [ ] Railway (infrastructure)
- [ ] Sentry (observability)

### Routes Affected
- 

### Workflows Affected
> Which exact user journeys are broken?

- 

### Queries / Listeners Affected
> Specific Firestore queries or realtime listeners producing bad data.

- 

### Analytics Affected
- [ ] No analytics impact
- [ ] Affected: <!-- describe -->

### Payments Affected
- [ ] No payment impact
- [ ] Affected: <!-- which flows and how -->

---

## Proposed Fix

> The minimal, targeted change that resolves the root cause.
> Do NOT include unrelated refactoring.

**Files to change:**
- `src/app/...` — 

**What the fix does:**

---

## Cross-Module Risk Assessment

Does this fix touch code outside its home module?

- [ ] No — change is isolated to the module above
- [ ] Yes — CROSS-MODULE change (requires justification below)

**Justification (if cross-module):**

---

## Regression Risk

Which other modules or flows could be accidentally broken by this fix?

- 

---

## Validation Plan

### Staging Tests
- [ ] <!-- Specific flow to test in staging -->
- [ ] 

### Automated Tests
- [ ] Unit test added/updated: `__tests__/...`
- [ ] e2e test added/updated: `e2e/...`
- [ ] No automated test possible — reason: 

### Reconciliation
- [ ] Paystack reconciliation script run — result: 
- [ ] Firebase data integrity audit run — result: 

---

## Resolution

**Fix commit:** `<!-- git sha -->`  
**Staging deployed:** `<!-- timestamp -->`  
**Staging validated by:** `<!-- name -->`  
**Production deployed:** `<!-- timestamp -->`  
**Production version:** `<!-- vX.X.X -->`

---

*Filed under `/docs/bugs/` per Engineering Governance Directive — 2026-05-21*
