# App Router Route Inventory

| Route Path | File Path | Route Type | Server Action? | API Route? | Requires Auth? |
|---|---|---|---|---|---|
| /about | `src/app/about/page.tsx` | Page | No | No | No |
| /academy | `src/app/academy/(learner)` | DEAD ROUTE (Missing Page) | - | - | - |
| /academy | `src/app/academy/(learner)/layout.tsx` | Layout (Grouped) | No | No | Yes |
| /academy/my-courses | `src/app/academy/(learner)/my-courses/page.tsx` | Page (Grouped) | No | No | No |
| /academy/progress | `src/app/academy/(learner)/progress/page.tsx` | Page (Grouped) | Yes | No | Yes |
| /academy/[courseId]/lesson/[lessonId] | `src/app/academy/[courseId]/lesson/[lessonId]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /academy/[courseId] | `src/app/academy/[courseId]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /academy/[courseId]/quiz/[moduleId] | `src/app/academy/[courseId]/quiz/[moduleId]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /academy/application | `src/app/academy/application/page.tsx` | Page | Yes | No | Yes |
| /academy/application/pending | `src/app/academy/application/pending/page.tsx` | Page | No | No | No |
| /academy/application/success | `src/app/academy/application/success/page.tsx` | Page | No | No | No |
| /academy/certificate/[certificateId] | `src/app/academy/certificate/[certificateId]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /academy/courses/[courseId]/quiz | `src/app/academy/courses/[courseId]/quiz/page.tsx` | Page (Dynamic) | No | Yes | No |
| /academy/dashboard | `src/app/academy/dashboard/page.tsx` | Page | No | Yes | No |
| /academy | `src/app/academy/error.tsx` | Error | No | No | No |
| /academy/live/[courseId] | `src/app/academy/live/[courseId]/page.tsx` | Page (Dynamic) | No | Yes | Yes |
| /academy | `src/app/academy/page.tsx` | Page | No | No | No |
| /academy/payment/callback | `src/app/academy/payment/callback/page.tsx` | Page | Yes | No | No |
| /academy/setup | `src/app/academy/setup/layout.tsx` | Layout | No | No | Yes |
| /academy/setup | `src/app/academy/setup/page.tsx` | Page | Yes | No | Yes |
| /academy/verify/[certificateId] | `src/app/academy/verify/[certificateId]/page.tsx` | Page (Dynamic) | No | Yes | No |
| /admin/academy/[courseId] | `src/app/admin/academy/[courseId]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /admin/academy/[courseId]/quiz/[quizId] | `src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx` | Page (Dynamic) | No | No | No |
| /admin/academy/applications | `src/app/admin/academy/applications/page.tsx` | Page | Yes | No | No |
| /admin/academy/courses/[courseId]/quiz | `src/app/admin/academy/courses/[courseId]/quiz/page.tsx` | Page (Dynamic) | No | Yes | No |
| /admin/academy/create | `src/app/admin/academy/create/page.tsx` | Page | Yes | No | No |
| /admin/academy | `src/app/admin/academy/page.tsx` | Page | Yes | No | No |
| /admin/analytics | `src/app/admin/analytics/page.tsx` | Page | Yes | No | No |
| /admin/audit-logs | `src/app/admin/audit-logs/page.tsx` | Page | Yes | No | Yes |
| /admin/communications | `src/app/admin/communications/page.tsx` | Page | Yes | No | No |
| /admin/content-approval | `src/app/admin/content-approval/page.tsx` | Page | Yes | No | No |
| /admin/cooperatives/contributions | `src/app/admin/cooperatives/contributions/page.tsx` | Page | Yes | No | No |
| /admin/cooperatives/dashboard | `src/app/admin/cooperatives/dashboard/page.tsx` | Page | Yes | No | No |
| /admin/cooperatives/loan-products | `src/app/admin/cooperatives/loan-products/page.tsx` | Page | No | Yes | No |
| /admin/cooperatives/loans/loans | `src/app/admin/cooperatives/loans/loans/page.tsx` | Page | Yes | No | No |
| /admin/cooperatives/loans | `src/app/admin/cooperatives/loans/page.tsx` | Page | Yes | Yes | No |
| /admin/cooperatives/members | `src/app/admin/cooperatives/members/page.tsx` | Page | No | Yes | No |
| /admin/cooperatives | `src/app/admin/cooperatives/page.tsx` | Page | No | No | No |
| /admin/cooperatives/transactions | `src/app/admin/cooperatives/transactions/page.tsx` | Page | Yes | No | No |
| /admin/disputes | `src/app/admin/disputes/page.tsx` | Page | No | No | No |
| /admin | `src/app/admin/error.tsx` | Error | No | No | No |
| /admin/export/edit/[id] | `src/app/admin/export/edit/[id]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /admin/export | `src/app/admin/export/page.tsx` | Page | Yes | No | No |
| /admin/farm-nation/land-verification/land-verification | `src/app/admin/farm-nation/land-verification/land-verification/page.tsx` | Page | Yes | No | No |
| /admin/farm-nation/land-verification | `src/app/admin/farm-nation/land-verification/page.tsx` | Page | No | Yes | No |
| /admin/farm-nation/listings | `src/app/admin/farm-nation/listings/page.tsx` | Page | Yes | No | No |
| /admin/farm-nation | `src/app/admin/farm-nation/page.tsx` | Page | No | No | No |
| /admin/farm-nation/sellers | `src/app/admin/farm-nation/sellers/page.tsx` | Page | Yes | No | No |
| /admin/feature-toggles | `src/app/admin/feature-toggles/page.tsx` | Page | Yes | No | No |
| /admin/finance | `src/app/admin/finance/page.tsx` | Page | Yes | No | No |
| /admin | `src/app/admin/layout.tsx` | Layout | No | No | Yes |
| /admin/marketplace/disputes/[id] | `src/app/admin/marketplace/disputes/[id]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /admin/marketplace/disputes | `src/app/admin/marketplace/disputes/page.tsx` | Page | Yes | No | No |
| /admin/marketplace | `src/app/admin/marketplace/page.tsx` | Page | No | No | No |
| /admin/marketplace/reviews | `src/app/admin/marketplace/reviews/page.tsx` | Page | Yes | No | No |
| /admin/marketplace/sellers | `src/app/admin/marketplace/sellers/page.tsx` | Page | No | Yes | No |
| /admin/orphaned-users | `src/app/admin/orphaned-users/page.tsx` | Page | No | Yes | No |
| /admin | `src/app/admin/page.tsx` | Page | Yes | No | No |
| /admin/settings/general | `src/app/admin/settings/general/page.tsx` | Page | No | No | No |
| /admin/settings/localization | `src/app/admin/settings/localization/page.tsx` | Page | No | No | No |
| /admin/settings/logs | `src/app/admin/settings/logs/page.tsx` | Page | Yes | No | No |
| /admin/settings/maintenance | `src/app/admin/settings/maintenance/page.tsx` | Page | Yes | No | No |
| /admin/settings/notifications | `src/app/admin/settings/notifications/page.tsx` | Page | No | No | No |
| /admin/settings | `src/app/admin/settings/page.tsx` | Page | No | No | No |
| /admin/settings/security | `src/app/admin/settings/security/page.tsx` | Page | No | No | No |
| /admin/users | `src/app/admin/users/page.tsx` | Page | Yes | No | No |
| /admin/verify-id | `src/app/admin/verify-id/page.tsx` | Page | No | Yes | No |
| /admin/wave/applications | `src/app/admin/wave/applications/page.tsx` | Page | Yes | No | No |
| /admin/wave/compliance | `src/app/admin/wave/compliance/page.tsx` | Page | No | Yes | No |
| /admin/wave | `src/app/admin/wave/page.tsx` | Page | No | No | No |
| /admin/wave/registrations | `src/app/admin/wave/registrations/page.tsx` | Page | Yes | No | No |
| /admin/wave/resources | `src/app/admin/wave/resources/page.tsx` | Page | Yes | No | Yes |
| /admin/wave/training | `src/app/admin/wave/training/page.tsx` | Page | Yes | No | No |
| /admin/withdrawals | `src/app/admin/withdrawals/page.tsx` | Page | Yes | No | No |
| /api/academy/certificate/generate | `src/app/api/academy/certificate/generate/route.ts` | API Route | No | No | Yes |
| /api/academy/dashboard | `src/app/api/academy/dashboard/route.ts` | API Route | No | No | Yes |
| /api/academy/quiz/[courseId] | `src/app/api/academy/quiz/[courseId]/route.ts` | API Route (Dynamic) | No | No | Yes |
| /api/academy/quiz/submit | `src/app/api/academy/quiz/submit/route.ts` | API Route | No | No | Yes |
| /api/academy/verify-payment | `src/app/api/academy/verify-payment/route.ts` | API Route | Yes | No | No |
| /api/academy/verify/[certificateId] | `src/app/api/academy/verify/[certificateId]/route.ts` | API Route (Dynamic) | No | No | No |
| /api/admin/academy/quiz/create | `src/app/api/admin/academy/quiz/create/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/approve-loan | `src/app/api/admin/cooperative/approve-loan/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/approve-member | `src/app/api/admin/cooperative/approve-member/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/create-loan-product | `src/app/api/admin/cooperative/create-loan-product/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/delete-loan-product | `src/app/api/admin/cooperative/delete-loan-product/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/loan-applications | `src/app/api/admin/cooperative/loan-applications/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/loan-products | `src/app/api/admin/cooperative/loan-products/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/members | `src/app/api/admin/cooperative/members/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/reject-loan | `src/app/api/admin/cooperative/reject-loan/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/reject-member | `src/app/api/admin/cooperative/reject-member/route.ts` | API Route | No | No | Yes |
| /api/admin/cooperative/update-loan-product | `src/app/api/admin/cooperative/update-loan-product/route.ts` | API Route | No | No | Yes |
| /api/admin/farm-nation/approve-land | `src/app/api/admin/farm-nation/approve-land/route.ts` | API Route | No | No | Yes |
| /api/admin/farm-nation/land-verifications | `src/app/api/admin/farm-nation/land-verifications/route.ts` | API Route | No | No | Yes |
| /api/admin/farm-nation/reject-land | `src/app/api/admin/farm-nation/reject-land/route.ts` | API Route | No | No | Yes |
| /api/admin/marketplace/approve-seller | `src/app/api/admin/marketplace/approve-seller/route.ts` | API Route | No | No | Yes |
| /api/admin/marketplace/reject-seller | `src/app/api/admin/marketplace/reject-seller/route.ts` | API Route | No | No | Yes |
| /api/admin/marketplace/seller-verifications | `src/app/api/admin/marketplace/seller-verifications/route.ts` | API Route | No | No | Yes |
| /api/admin/marketplace/suspend-seller | `src/app/api/admin/marketplace/suspend-seller/route.ts` | API Route | No | No | Yes |
| /api/admin/orphaned-users | `src/app/api/admin/orphaned-users/route.ts` | API Route | No | No | Yes |
| /api/admin/schema-fix | `src/app/api/admin/schema-fix/route.ts` | API Route | Yes | No | Yes |
| /api/admin/verify-integrity | `src/app/api/admin/verify-integrity/route.ts` | API Route | No | No | Yes |
| /api/admin/wave/compliance | `src/app/api/admin/wave/compliance/route.ts` | API Route | No | No | Yes |
| /api/admin/wave/reports/export | `src/app/api/admin/wave/reports/export/route.ts` | API Route | No | No | Yes |
| /api/ai | `src/app/api/ai/route.ts` | API Route | No | No | Yes |
| /api/auth/[...nextauth] | `src/app/api/auth/[...nextauth]/route.ts` | API Route (Dynamic) | No | No | No |
| /api/auth/mfa/disable | `src/app/api/auth/mfa/disable/route.ts` | API Route | No | No | Yes |
| /api/auth/mfa/enable | `src/app/api/auth/mfa/enable/route.ts` | API Route | No | No | Yes |
| /api/auth/mfa/setup | `src/app/api/auth/mfa/setup/route.ts` | API Route | No | No | Yes |
| /api/auth/mfa/status | `src/app/api/auth/mfa/status/route.ts` | API Route | No | No | Yes |
| /api/auth/mfa/verify | `src/app/api/auth/mfa/verify/route.ts` | API Route | No | No | Yes |
| /api/cache/monitor | `src/app/api/cache/monitor/route.ts` | API Route | No | No | Yes |
| /api/certificates/[id] | `src/app/api/certificates/[id]/route.ts` | API Route (Dynamic) | No | No | Yes |
| /api/certificates/download | `src/app/api/certificates/download/route.ts` | API Route | No | No | Yes |
| /api/certificates | `src/app/api/certificates/route.ts` | API Route | No | No | Yes |
| /api/certificates/upload | `src/app/api/certificates/upload/route.ts` | API Route | No | No | Yes |
| /api/contact | `src/app/api/contact/route.ts` | API Route | No | No | No |
| /api/cooperative/apply-loan | `src/app/api/cooperative/apply-loan/route.ts` | API Route | No | No | Yes |
| /api/cooperative/check-membership | `src/app/api/cooperative/check-membership/route.ts` | API Route | No | No | Yes |
| /api/cooperative/contribute | `src/app/api/cooperative/contribute/route.ts` | API Route | No | No | Yes |
| /api/cooperative/create-fixed-savings | `src/app/api/cooperative/create-fixed-savings/route.ts` | API Route | No | No | Yes |
| /api/cooperative/fixed-savings | `src/app/api/cooperative/fixed-savings/route.ts` | API Route | No | No | Yes |
| /api/cooperative/loan-products | `src/app/api/cooperative/loan-products/route.ts` | API Route | No | No | No |
| /api/cooperative/my-loan-applications | `src/app/api/cooperative/my-loan-applications/route.ts` | API Route | No | No | Yes |
| /api/cooperative/verify-payment | `src/app/api/cooperative/verify-payment/route.ts` | API Route | No | No | Yes |
| /api/cooperative/withdraw | `src/app/api/cooperative/withdraw/route.ts` | API Route | No | No | Yes |
| /api/cooperatives/register | `src/app/api/cooperatives/register/route.ts` | API Route | No | No | Yes |
| /api/cron/process-email-queue | `src/app/api/cron/process-email-queue/route.ts` | API Route | No | No | No |
| /api/cron/release-escrow | `src/app/api/cron/release-escrow/route.ts` | API Route | No | No | No |
| /api/farm-nation/create-listing | `src/app/api/farm-nation/create-listing/route.ts` | API Route | No | No | Yes |
| /api/farm-nation/listings | `src/app/api/farm-nation/listings/route.ts` | API Route | No | No | No |
| /api/marketplace/create-product | `src/app/api/marketplace/create-product/route.ts` | API Route | No | No | Yes |
| /api/marketplace/delete-product | `src/app/api/marketplace/delete-product/route.ts` | API Route | No | No | Yes |
| /api/marketplace/my-products | `src/app/api/marketplace/my-products/route.ts` | API Route | No | No | Yes |
| /api/marketplace/products | `src/app/api/marketplace/products/route.ts` | API Route | No | No | No |
| /api/marketplace/seller-status | `src/app/api/marketplace/seller-status/route.ts` | API Route | No | No | Yes |
| /api/marketplace/submit-verification | `src/app/api/marketplace/submit-verification/route.ts` | API Route | No | No | Yes |
| /api/marketplace/update-product | `src/app/api/marketplace/update-product/route.ts` | API Route | No | No | Yes |
| /api/onboarding/complete | `src/app/api/onboarding/complete/route.ts` | API Route | No | No | Yes |
| /api/qr/verify | `src/app/api/qr/verify/route.ts` | API Route | No | No | Yes |
| /api/upload | `src/app/api/upload/route.ts` | API Route | No | No | Yes |
| /api/users/[userId] | `src/app/api/users/[userId]/route.ts` | API Route (Dynamic) | No | No | Yes |
| /api/wave/check-eligibility | `src/app/api/wave/check-eligibility/route.ts` | API Route | No | No | Yes |
| /api/webhooks/paystack | `src/app/api/webhooks/paystack/route.ts` | API Route | No | No | No |
| /auth/error | `src/app/auth/error/page.tsx` | Page | No | No | No |
| /auth/forgot-password | `src/app/auth/forgot-password/page.tsx` | Page | Yes | No | No |
| /auth/get-started | `src/app/auth/get-started/page.tsx` | Page | No | No | Yes |
| /auth/login | `src/app/auth/login/page.tsx` | Page | No | No | No |
| /auth/register | `src/app/auth/register/page.tsx` | Page | No | No | No |
| /auth/reset-password | `src/app/auth/reset-password/page.tsx` | Page | Yes | No | No |
| /contact | `src/app/contact/page.tsx` | Page | No | Yes | No |
| /cooperatives | `src/app/cooperatives/(member)` | DEAD ROUTE (Missing Page) | - | - | - |
| /cooperatives/contribute | `src/app/cooperatives/(member)/contribute/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives/dashboard | `src/app/cooperatives/(member)/dashboard/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives/directory | `src/app/cooperatives/(member)/directory/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives/fixed-savings | `src/app/cooperatives/(member)/fixed-savings/page.tsx` | Page (Grouped) | No | Yes | No |
| /cooperatives/history | `src/app/cooperatives/(member)/history/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives | `src/app/cooperatives/(member)/layout.tsx` | Layout (Grouped) | No | No | Yes |
| /cooperatives/loans | `src/app/cooperatives/(member)/loans/page.tsx` | Page (Grouped) | Yes | Yes | No |
| /cooperatives/my-loans | `src/app/cooperatives/(member)/my-loans/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives/my-savings | `src/app/cooperatives/(member)/my-savings/page.tsx` | Page (Grouped) | Yes | Yes | No |
| /cooperatives/withdraw | `src/app/cooperatives/(member)/withdraw/page.tsx` | Page (Grouped) | Yes | No | No |
| /cooperatives/withdrawals | `src/app/cooperatives/(member)/withdrawals/page.tsx` | Page (Grouped) | No | Yes | No |
| /cooperatives | `src/app/cooperatives/error.tsx` | Error | No | No | No |
| /cooperatives/landing | `src/app/cooperatives/landing/layout.tsx` | Layout | No | No | No |
| /cooperatives/landing | `src/app/cooperatives/landing/page.tsx` | Page | No | No | No |
| /cooperatives/onboarding | `src/app/cooperatives/onboarding/layout.tsx` | Layout | No | No | Yes |
| /cooperatives/onboarding | `src/app/cooperatives/onboarding/page.tsx` | Page | No | No | Yes |
| /cooperatives/onboarding/pending-payment | `src/app/cooperatives/onboarding/pending-payment/page.tsx` | Page | No | No | No |
| /cooperatives/onboarding/pending | `src/app/cooperatives/onboarding/pending/page.tsx` | Page | No | No | No |
| /cooperatives/onboarding/success | `src/app/cooperatives/onboarding/success/page.tsx` | Page | No | No | No |
| /cooperatives | `src/app/cooperatives/page.tsx` | Page | No | No | No |
| /cooperatives/payment/callback | `src/app/cooperatives/payment/callback/page.tsx` | Page | No | Yes | No |
| /cooperatives/payment | `src/app/cooperatives/payment/layout.tsx` | Layout | No | No | Yes |
| /cooperatives/payment | `src/app/cooperatives/payment/page.tsx` | Page | Yes | No | Yes |
| /cooperatives/verify-payment | `src/app/cooperatives/verify-payment/page.tsx` | Page | Yes | No | No |
| /dashboard/certificates | `src/app/dashboard/certificates/page.tsx` | Page | No | Yes | Yes |
| /dashboard/digital-id | `src/app/dashboard/digital-id/page.tsx` | Page | No | No | Yes |
| /dashboard/disputes/new | `src/app/dashboard/disputes/new/page.tsx` | Page | Yes | No | No |
| /dashboard | `src/app/dashboard/layout.tsx` | Layout | No | No | Yes |
| /dashboard/messages | `src/app/dashboard/messages/page.tsx` | Page | Yes | No | Yes |
| /dashboard/notifications | `src/app/dashboard/notifications/page.tsx` | Page | Yes | No | Yes |
| /dashboard/orders | `src/app/dashboard/orders/page.tsx` | Page | Yes | No | No |
| /dashboard | `src/app/dashboard/page.tsx` | Page | No | No | Yes |
| /dashboard/reviews/new | `src/app/dashboard/reviews/new/page.tsx` | Page | Yes | No | No |
| /dashboard/reviews | `src/app/dashboard/reviews/page.tsx` | Page | Yes | No | No |
| / | `src/app/error.tsx` | Error | No | No | No |
| /escrow/[id]/chat | `src/app/escrow/[id]/chat/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /escrow/[id]/dispute | `src/app/escrow/[id]/dispute/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /escrow | `src/app/escrow/layout.tsx` | Layout | No | No | No |
| /escrow | `src/app/escrow/page.tsx` | Page | Yes | No | No |
| /export | `src/app/export/(app)` | DEAD ROUTE (Missing Page) | - | - | - |
| /export/dashboard | `src/app/export/(app)/dashboard/page.tsx` | Page (Grouped) | Yes | No | No |
| /export/investments/[id] | `src/app/export/(app)/investments/[id]/page.tsx` | Page (Dynamic) (Grouped) | No | No | No |
| /export | `src/app/export/(app)/layout.tsx` | Layout (Grouped) | No | No | Yes |
| /export/opportunities | `src/app/export/(app)/opportunities/page.tsx` | Page (Grouped) | Yes | No | No |
| /export/portfolio | `src/app/export/(app)/portfolio/page.tsx` | Page (Grouped) | Yes | No | No |
| /export/transactions | `src/app/export/(app)/transactions/page.tsx` | Page (Grouped) | No | No | No |
| /export/buyer/cart | `src/app/export/buyer/cart/page.tsx` | Page | Yes | No | No |
| /export/buyer | `src/app/export/buyer/layout.tsx` | Layout | No | No | No |
| /export/buyer | `src/app/export/buyer/page.tsx` | Page | No | No | No |
| /export/onboarding | `src/app/export/onboarding/page.tsx` | Page | Yes | No | No |
| /export/onboarding/pending | `src/app/export/onboarding/pending/page.tsx` | Page | No | No | No |
| /export/onboarding/rejected | `src/app/export/onboarding/rejected/page.tsx` | Page | No | No | No |
| /export | `src/app/export/page.tsx` | Page | No | No | No |
| /export/payment/callback | `src/app/export/payment/callback/page.tsx` | Page | Yes | No | No |
| /export/windows/[id] | `src/app/export/windows/[id]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /export/windows | `src/app/export/windows/page.tsx` | Page | Yes | No | No |
| /farm-nation | `src/app/farm-nation/(member)` | DEAD ROUTE (Missing Page) | - | - | - |
| /farm-nation/dashboard | `src/app/farm-nation/(member)/dashboard/page.tsx` | Page (Grouped) | No | No | Yes |
| /farm-nation | `src/app/farm-nation/(member)/layout.tsx` | Layout (Grouped) | No | No | Yes |
| /farm-nation/checkout/[propertyId] | `src/app/farm-nation/checkout/[propertyId]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /farm-nation/edit-property/[id] | `src/app/farm-nation/edit-property/[id]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /farm-nation/inquiries/[id] | `src/app/farm-nation/inquiries/[id]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /farm-nation/inquiries | `src/app/farm-nation/inquiries/page.tsx` | Page | Yes | No | Yes |
| /farm-nation/list-land | `src/app/farm-nation/list-land/page.tsx` | Page | Yes | No | Yes |
| /farm-nation/map | `src/app/farm-nation/map/error.tsx` | Error | No | No | No |
| /farm-nation/map | `src/app/farm-nation/map/page.tsx` | Page | No | Yes | No |
| /farm-nation/my-properties | `src/app/farm-nation/my-properties/page.tsx` | Page | Yes | No | Yes |
| /farm-nation/my-purchases | `src/app/farm-nation/my-purchases/page.tsx` | Page | Yes | No | Yes |
| /farm-nation/onboarding | `src/app/farm-nation/onboarding/page.tsx` | Page | Yes | No | No |
| /farm-nation/onboarding/pending | `src/app/farm-nation/onboarding/pending/page.tsx` | Page | No | No | No |
| /farm-nation | `src/app/farm-nation/page.tsx` | Page | No | No | No |
| /farm-nation/payment/callback | `src/app/farm-nation/payment/callback/page.tsx` | Page | Yes | No | No |
| /farm-nation/properties | `src/app/farm-nation/properties/page.tsx` | Page | Yes | No | No |
| /farm-nation/property/[id] | `src/app/farm-nation/property/[id]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /help | `src/app/help/page.tsx` | Page | No | No | No |
| /land | `src/app/land/page.tsx` | Page | Yes | No | No |
| /land/submit | `src/app/land/submit/page.tsx` | Page | Yes | No | Yes |
| /land/verify | `src/app/land/verify/page.tsx` | Page | Yes | No | No |
| / | `src/app/layout.tsx` | Layout | No | No | No |
| / | `src/app/loading.tsx` | Loading | No | No | No |
| /loans/apply | `src/app/loans/apply/page.tsx` | Page | Yes | No | No |
| /loans/approve | `src/app/loans/approve/page.tsx` | Page | Yes | No | No |
| /loans | `src/app/loans/page.tsx` | Page | Yes | No | No |
| /loans/success | `src/app/loans/success/page.tsx` | Page | No | No | No |
| /marketplace/buyer | `src/app/marketplace/buyer` | DEAD ROUTE (Missing Page) | - | - | - |
| /marketplace/buyer/dashboard | `src/app/marketplace/buyer/dashboard/page.tsx` | Page | Yes | No | No |
| /marketplace/buyer | `src/app/marketplace/buyer/layout.tsx` | Layout | No | No | Yes |
| /marketplace/buyer/orders | `src/app/marketplace/buyer/orders/page.tsx` | Page | Yes | No | No |
| /marketplace/buyer/products | `src/app/marketplace/buyer/products/page.tsx` | Page | No | No | No |
| /marketplace/checkout | `src/app/marketplace/checkout/page.tsx` | Page | Yes | No | Yes |
| /marketplace | `src/app/marketplace/error.tsx` | Error | No | No | No |
| /marketplace/onboarding | `src/app/marketplace/onboarding/layout.tsx` | Layout | No | No | Yes |
| /marketplace/onboarding | `src/app/marketplace/onboarding/page.tsx` | Page | Yes | No | Yes |
| /marketplace/onboarding/pending | `src/app/marketplace/onboarding/pending/page.tsx` | Page | No | No | No |
| /marketplace/onboarding/rejected | `src/app/marketplace/onboarding/rejected/page.tsx` | Page | No | No | No |
| /marketplace/orders/[id] | `src/app/marketplace/orders/[id]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /marketplace | `src/app/marketplace/page.tsx` | Page | Yes | No | No |
| /marketplace/payment/callback | `src/app/marketplace/payment/callback/page.tsx` | Page | Yes | No | No |
| /marketplace/product/[id] | `src/app/marketplace/product/[id]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /marketplace/products/[id] | `src/app/marketplace/products/[id]/page.tsx` | Page (Dynamic) | Yes | No | No |
| /marketplace/products/add | `src/app/marketplace/products/add/page.tsx` | Page | No | Yes | No |
| /marketplace/products | `src/app/marketplace/products/page.tsx` | Page | No | No | No |
| /marketplace/sell/create | `src/app/marketplace/sell/create/page.tsx` | Page | Yes | No | Yes |
| /marketplace/sell/orders | `src/app/marketplace/sell/orders/page.tsx` | Page | Yes | No | No |
| /marketplace/sell | `src/app/marketplace/sell/page.tsx` | Page | Yes | No | Yes |
| /marketplace/seller | `src/app/marketplace/seller` | DEAD ROUTE (Missing Page) | - | - | - |
| /marketplace/seller-verification | `src/app/marketplace/seller-verification/page.tsx` | Page | No | Yes | No |
| /marketplace/seller/analytics | `src/app/marketplace/seller/analytics/page.tsx` | Page | Yes | No | No |
| /marketplace/seller/dashboard | `src/app/marketplace/seller/dashboard/page.tsx` | Page | Yes | No | No |
| /marketplace/seller | `src/app/marketplace/seller/layout.tsx` | Layout | No | No | Yes |
| /marketplace/seller/orders | `src/app/marketplace/seller/orders/page.tsx` | Page | Yes | No | No |
| /marketplace/seller/products | `src/app/marketplace/seller/products/page.tsx` | Page | Yes | No | No |
| /marketplace/success | `src/app/marketplace/success/page.tsx` | Page | No | No | No |
| /marketplace/verify | `src/app/marketplace/verify/page.tsx` | Page | Yes | No | Yes |
| /messages/[id] | `src/app/messages/[id]/page.tsx` | Page (Dynamic) | Yes | No | Yes |
| /messages | `src/app/messages/layout.tsx` | Layout | Yes | No | Yes |
| /messages | `src/app/messages/page.tsx` | Page | Yes | No | Yes |
| / | `src/app/not-found.tsx` | Not Found | No | No | No |
| / | `src/app/page.tsx` | Page | No | No | No |
| /privacy | `src/app/privacy/page.tsx` | Page | No | No | No |
| /profile | `src/app/profile/page.tsx` | Page | Yes | No | Yes |
| /refund-policy | `src/app/refund-policy/page.tsx` | Page | No | No | No |
| /settings/security/mfa | `src/app/settings/security/mfa/page.tsx` | Page | No | Yes | No |
| /terms | `src/app/terms/page.tsx` | Page | No | No | No |
| /vendor/orders | `src/app/vendor/orders/page.tsx` | Page | Yes | No | No |
| /vendor/overview | `src/app/vendor/overview/page.tsx` | Page | Yes | No | No |
| /vendor | `src/app/vendor/page.tsx` | Page | No | No | No |
| /vendor/products | `src/app/vendor/products/page.tsx` | Page | Yes | No | No |
| /vendor/settings | `src/app/vendor/settings/page.tsx` | Page | Yes | No | No |
| /verify-id | `src/app/verify-id/page.tsx` | Page | No | No | No |
| /verify-id/scan | `src/app/verify-id/scan/page.tsx` | Page | No | Yes | No |
| /verify-status | `src/app/verify-status/page.tsx` | Page | No | No | Yes |
| /wave | `src/app/wave/(member)` | DEAD ROUTE (Missing Page) | - | - | - |
| /wave/certificates | `src/app/wave/(member)/certificates/page.tsx` | Page (Grouped) | Yes | No | No |
| /wave/dashboard | `src/app/wave/(member)/dashboard/page.tsx` | Page (Grouped) | Yes | No | No |
| /wave/earnings | `src/app/wave/(member)/earnings/page.tsx` | Page (Grouped) | Yes | No | Yes |
| /wave | `src/app/wave/(member)/layout.tsx` | Layout (Grouped) | No | No | Yes |
| /wave/live-training | `src/app/wave/(member)/live-training/page.tsx` | Page (Grouped) | No | Yes | No |
| /wave/profile | `src/app/wave/(member)/profile/page.tsx` | Page (Grouped) | Yes | No | Yes |
| /wave/resources | `src/app/wave/(member)/resources/page.tsx` | Page (Grouped) | Yes | No | Yes |
| /wave/shipments | `src/app/wave/(member)/shipments/page.tsx` | Page (Grouped) | Yes | No | Yes |
| /wave/training | `src/app/wave/(member)/training/page.tsx` | Page (Grouped) | Yes | No | No |
| /wave/access-denied | `src/app/wave/access-denied/page.tsx` | Page | No | No | No |
| /wave/application | `src/app/wave/application/layout.tsx` | Layout | No | No | Yes |
| /wave/application | `src/app/wave/application/page.tsx` | Page | Yes | No | Yes |
| /wave/application/review-pending | `src/app/wave/application/review-pending/page.tsx` | Page | No | No | No |
| /wave/application/success | `src/app/wave/application/success/page.tsx` | Page | No | No | Yes |
| /wave/briefing | `src/app/wave/briefing/page.tsx` | Page | Yes | No | No |
| /wave | `src/app/wave/error.tsx` | Error | No | No | No |
| /wave/landing | `src/app/wave/landing/page.tsx` | Page | No | No | No |
| /wave | `src/app/wave/layout.tsx` | Layout | No | No | No |
| /wave | `src/app/wave/page.tsx` | Page | No | No | No |
