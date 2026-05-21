# Changelog — Easy Sales Export

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [v1.3.2] — 2026-05-21

### Bug Fixes

- **[EXPORT]** Fixed session loading race condition in `export/onboarding/page.tsx`
  - Root cause: `useEffect` called `checkExportStatusAction()` before NextAuth resolved the session, causing `requireSession()` to fail silently and `setIsLoading(false)` to fire prematurely
  - Files changed: `src/app/export/onboarding/page.tsx`
  - Routes affected: `/export/onboarding`
  - Onboarding affected: Export onboarding (session guard)
  - Fix: Added `if (status === "loading") return` guard; changed dep array to `[status]`

- **[EXPORT]** Fixed stuck submit button on Export onboarding success path
  - Root cause: `setIsSubmitting(false)` was only called in `else`/`catch` branches; success path navigated without resetting the loading state
  - Files changed: `src/app/export/onboarding/page.tsx`
  - Routes affected: `/export/onboarding`
  - Fix: Added `setIsSubmitting(false)` before `router.replace()` on both success paths (revision + fresh submit); changed `router.push` → `router.replace` to prevent back-navigation to completed form

- **[ACADEMY]** Fixed session loading race condition in `academy/application/page.tsx`
  - Root cause: Used `if (session)` as a proxy for "session loaded" — incorrect because during loading, `session` is `null` and the `else` branch fired `setIsLoading(false)` immediately, showing the form before auth resolved
  - Files changed: `src/app/academy/application/page.tsx`
  - Routes affected: `/academy/application`
  - Fix: Destructured `status` from `useSession()`; replaced `if (session)` with proper `if (status === "loading") return` guard

- **[FARM-NATION]** Fixed session loading race condition in `farm-nation/onboarding/page.tsx`
  - Root cause: `checkFarmNationStatusAction()` fired on mount before NextAuth resolved, identical pattern to Export
  - Files changed: `src/app/farm-nation/onboarding/page.tsx`
  - Routes affected: `/farm-nation/onboarding`
  - Fix: Destructured `status` from `useSession()`; added `if (status === "loading") return` guard; changed dep array to `[status]`

---

## [v1.3.1] — 2026-05-21

### Bug Fixes

- **[COOPERATIVE]** Fixed abrupt crash on cooperative onboarding mount
  - Root cause: Status-check `useEffect` in `OnboardingClient.tsx` fired before NextAuth resolved the session. `requireSession()` inside `checkCooperativeStatusAction()` failed silently, producing an inconsistent half-loaded component state that appeared as a crash
  - Files changed: `src/app/cooperatives/onboarding/OnboardingClient.tsx`
  - Routes affected: `/cooperatives/onboarding`
  - Fix: Added `if (status === "loading") return` guard at top of `useEffect`; changed dependency array from `[]` to `[status]`

- **[COOPERATIVE]** Fixed infinite submit loop on cooperative onboarding
  - Root cause (A): `setIsSubmitting(false)` was never called on the success path, permanently disabling the Submit button. `isSubmitting` was only reset in the `else`/`catch` branches
  - Root cause (B): After a successful form submission, `checkCooperativeStatusAction()` returned `"pending"` (the same value used for users who have not yet submitted). The `useEffect` re-ran on next mount, saw `"pending"`, and stayed on the form — causing the user to face the blank form again as if their submission never happened
  - Files changed: `src/app/actions/cooperative/_actions.ts`, `src/app/cooperatives/onboarding/OnboardingClient.tsx`
  - Routes affected: `/cooperatives/onboarding`, `/cooperatives/onboarding/pending`
  - Payments affected: No payment logic changed
  - Fix (A): Added `setIsSubmitting(false)` before `router.replace()` on success path
  - Fix (B): `checkCooperativeStatusAction()` now returns distinct `"pending_review"` sentinel when `onboardingCompleted === true` and status is `"pending"`. Client handles `"pending_review"` with immediate `router.replace('/cooperatives/onboarding/pending')`

- **[COOPERATIVE]** Fixed cold-start Firestore failure silently forcing paid users back to payment screen
  - Root cause: Server page `page.tsx` catch block left `paymentStatus` as empty string `""` on any Firebase Admin error. Client component treated non-`"completed"` as unpaid, redirecting already-paid users to Paystack
  - Files changed: `src/app/cooperatives/onboarding/page.tsx`
  - Fix: Changed catch block fallback from `""` to `"unknown"` — client re-checks via `checkStatusFromBackend()` instead of assuming unpaid

---

## [v1.0.0–v1.3.0]

> Retroactive changelog not yet documented. 
> See `git log` for historical changes prior to governance adoption.

---

*Governance Note: All entries from v1.3.1 onward must follow this format.*
*Every production deployment must have a corresponding entry before release.*
