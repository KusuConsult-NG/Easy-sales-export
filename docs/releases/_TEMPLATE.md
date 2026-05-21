# Release Certification Checklist

**Release Version:** <!-- vX.X.X -->  
**Release Date:** <!-- YYYY-MM-DD -->  
**Certified by:** <!-- Name -->  
**Deployed by:** <!-- Name -->

---

## 1. Automated Validation

Run and confirm all pass:

```bash
npx tsc --noEmit          # TypeScript type check
npm run lint               # ESLint
npm test -- --passWithNoTests  # Unit tests
```

- [ ] TypeScript — PASS
- [ ] ESLint — PASS
- [ ] Unit tests — PASS (`__tests__/`)

---

## 2. Staging Deployment

- [ ] Changes deployed to Railway staging service
- [ ] Staging environment is on the same commit as this release
- [ ] No critical Sentry errors in staging in last 24 hours

---

## 3. Onboarding Flow Validation (Staging)

Test each affected module's onboarding from start to finish in staging:

| Module | Tested | Pass/Fail | Tester |
|---|---|---|---|
| Cooperative onboarding → pending | | | |
| Academy application → payment → pending | | | |
| WAVE application → pending | | | |
| Marketplace seller onboarding → pending | | | |
| Marketplace buyer onboarding → dashboard | | | |
| Export onboarding → pending | | | |
| Farm-Nation onboarding → pending | | | |

---

## 4. Authentication (Staging)

- [ ] Login with email/password — works
- [ ] Register new account — works
- [ ] Password reset flow — works
- [ ] Session persists on page refresh — works
- [ ] Protected routes redirect unauthenticated users — works

---

## 5. Payment Flows (Staging — Paystack Test Mode)

- [ ] Paystack payment initiation — works
- [ ] Paystack callback → Firestore update — works
- [ ] Webhook receipt — verified
- [ ] Payment status reflected in user profile — correct

---

## 6. RBAC Validation (Staging)

- [ ] Non-member cannot access member-only pages
- [ ] Member cannot access admin pages
- [ ] Admin can access admin dashboard
- [ ] Module-specific RBAC enforced (e.g., cooperative member ≠ WAVE member)

---

## 7. Admin System (Staging)

- [ ] Approve member action — works
- [ ] Reject member action — works
- [ ] Admin dashboard data accurate — confirmed

---

## 8. Data Reconciliation

Run reconciliation scripts against production (read-only):

```bash
npx ts-node scripts/compare-paystack-firebase.ts
npx ts-node scripts/audit-data-integrity.ts
```

- [ ] Paystack vs Firebase: **0** critical discrepancies
- [ ] Onboarding state audit: **0** stuck users
- [ ] Member count audit: within 2% of expected

---

## 9. Communications (Staging)

- [ ] Email delivery verified (Resend sandbox)
- [ ] Notification delivery verified
- [ ] No email/notification failures in staging Sentry

---

## 10. e2e Regression Suite

```bash
npx playwright test --reporter=html
```

- [ ] e2e suite run against staging
- [ ] Pass rate: ___% (target: >80%)
- [ ] All critical path tests pass

---

## 11. CHANGELOG

- [ ] `CHANGELOG.md` updated with this release entry
- [ ] All changed files documented
- [ ] All affected routes documented
- [ ] All affected payments documented

---

## 12. Rollback Readiness

- [ ] Previous production deployment URL noted (for Railway rollback): ___________
- [ ] Git tag of previous release noted: ___________
- [ ] On-call person identified for post-deploy monitoring: ___________

---

## Sign-off

By signing below, I confirm that all checklist items above have been completed and this release is certified for production deployment.

**Certified by:** _______________  
**Signature date:** _______________  
**GitHub Actions workflow triggered:** `deploy-production.yml` with version `<!-- vX.X.X -->`

---

*File this document at `/docs/releases/YYYY-MM-DD-vX.X.X.md` before triggering deployment.*
