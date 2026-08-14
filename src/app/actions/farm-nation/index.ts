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
} from "./_fn_onboarding";

// ─── Admin review (_fn_admin.ts) ─────────────────────────────────────────────
export {
    approveFarmNationSellerAction,
    rejectFarmNationSellerAction,
    verifyPropertyAction,
} from "./_fn_admin";

// ─── Dashboard (_fn_dashboard.ts) ────────────────────────────────────────────
export { getFarmNationDashboardStatsAction } from "./_fn_dashboard";
