# Phase 2: Route Certification Loop

| File | Issues Found |
|---|---|
| `src/app/academy/(learner)/my-courses/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/(learner)/progress/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/[courseId]/lesson/[lessonId]/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/[courseId]/quiz/[moduleId]/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/application/success/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/certificate/[certificateId]/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/courses/[courseId]/quiz/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/academy/live/[courseId]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/academy/payment/callback/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/academy/setup/page.tsx` | TODO comments found, Potential mock data/placeholder strings found |
| `src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/academy/courses/[courseId]/quiz/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/academy/create/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/academy/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/audit-logs/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/communications/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/content-approval/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/admin/cooperatives/loan-products/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/cooperatives/loans/loans/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/admin/cooperatives/loans/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/cooperatives/members/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/cooperatives/transactions/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/disputes/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/export/edit/[id]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/farm-nation/land-verification/land-verification/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/farm-nation/sellers/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/feature-toggles/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/marketplace/disputes/[id]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/marketplace/disputes/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/marketplace/reviews/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/marketplace/sellers/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/settings/general/page.tsx` | TODO comments found |
| `src/app/admin/settings/maintenance/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/admin/verify-id/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/wave/resources/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/wave/training/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/admin/withdrawals/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/auth/forgot-password/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/auth/reset-password/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/contact/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/(member)/contribute/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/cooperatives/(member)/dashboard/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/(member)/directory/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/cooperatives/(member)/history/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/cooperatives/(member)/loans/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/cooperatives/(member)/my-savings/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/(member)/withdraw/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/cooperatives/landing/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/cooperatives/onboarding/page.tsx` | Async data fetch without try/catch |
| `src/app/cooperatives/onboarding/pending/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/onboarding/success/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/payment/callback/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/cooperatives/verify-payment/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/dashboard/disputes/new/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/dashboard/messages/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/dashboard/orders/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/dashboard/reviews/new/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/dashboard/reviews/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/escrow/[id]/chat/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/escrow/[id]/dispute/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/export/(app)/investments/[id]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/export/buyer/cart/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/export/buyer/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/export/onboarding/pending/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/export/windows/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/farm-nation/checkout/[propertyId]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/farm-nation/list-land/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/farm-nation/map/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/farm-nation/properties/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/farm-nation/property/[id]/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/help/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/land/submit/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/land/verify/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/loans/success/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/marketplace/buyer/orders/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/marketplace/buyer/products/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/checkout/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/marketplace/onboarding/pending/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/marketplace/orders/[id]/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/marketplace/products/[id]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/products/add/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/products/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/sell/create/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/sell/orders/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/seller-verification/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/marketplace/seller/orders/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/marketplace/seller/products/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/marketplace/success/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/marketplace/verify/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/messages/[id]/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/messages/layout.tsx` | Potential mock data/placeholder strings found |
| `src/app/messages/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/profile/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/settings/security/mfa/page.tsx` | Unsafe non-null assertion (!), Potential mock data/placeholder strings found |
| `src/app/vendor/products/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/vendor/settings/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/verify-id/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/wave/(member)/earnings/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/wave/(member)/resources/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/wave/(member)/training/page.tsx` | Unsafe non-null assertion (!) |
| `src/app/wave/application/review-pending/page.tsx` | Potential mock data/placeholder strings found |
| `src/app/wave/briefing/page.tsx` | Potential mock data/placeholder strings found |
