/**
 * Farm Nation Domain Action Barrel
 *
 * Single import point for the Farm Nation server actions.
 * `@/app/actions/farm-nation` resolves here, so every existing import keeps
 * working unchanged — the same arrangement admin.ts got in #202.
 *
 * Replaced actions/farm-nation.ts, 1,735 lines. The four shared types moved to
 * @/lib/types/farm-nation-actions and are re-exported below.
 *
 * Note the two siblings that are NOT part of this domain folder:
 * actions/farm-nation-admin.ts and actions/farm-nation-payment.ts are separate
 * modules with their own callers, and are left where they are.
 *
 *   #913 AND ITS PRIVATE FILES ARE PRIVATE. Nothing outside this folder imports
 *   `./_*` directly — that is swept and pinned in
 *   __tests__/unit/eight-barrels-and-two-tests, across all eight action domains.
 *   Four of the eight stated this rule and four, including this one, only obeyed
 *   it; a rule enforced by a test nobody reads is not a rule a contributor can
 *   follow.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────
export type {
    Property,
    PropertyListingInput,
    FarmNationOnboardingData,
    FarmNationDashboardStats,
} from "@/lib/types/farm-nation-actions";

// ─── Listings (_fn_listings.ts) ──────────────────────────────────────────────
export {
    getPropertiesAction,
    getPropertyByIdAction,
    listPropertyAction,
    getMyPropertiesAction,
    deletePropertyAction,
    updatePropertyAction,
    uploadPropertyDocumentsAction,
} from "./_fn_listings";

// ─── Purchases (_fn_purchases.ts) ────────────────────────────────────────────
export {
    initiatePropertyPurchaseAction,
    getMyPurchaseRequestsAction,
    cancelPurchaseRequestAction,
} from "./_fn_purchases";

// ─── Onboarding and applications (_fn_onboarding.ts) ─────────────────────────
export {
    submitFarmNationOnboardingAction,
    checkFarmNationStatusAction,
    getFarmNationApplicationAction,
    resubmitFarmNationApplicationAction,
    checkFarmNationAccessAction,
    //   #947 The door an approved member had none of — resubmit admits only
    //   pending/rejected/revision_required, so somebody already approved was
    //   turned away rather than un-approved.
    changeFarmNationRoleAction,
} from "./_fn_onboarding";

// ─── Admin review (_fn_admin.ts) ─────────────────────────────────────────────
export {
    approveFarmNationSellerAction,
    rejectFarmNationSellerAction,
    verifyPropertyAction,
} from "./_fn_admin";

// ─── Dashboard (_fn_dashboard.ts) ────────────────────────────────────────────
export { getFarmNationDashboardStatsAction } from "./_fn_dashboard";
