/**
 * Admin Domain Action Barrel
 *
 * Single import point for ALL admin server actions. `@/app/actions/admin`
 * resolves here, so every existing import keeps working unchanged.
 *
 * WHAT THIS REPLACED
 * ------------------
 * One 5,604-line file — the largest in the repository, and the one
 * docs/audit/outstanding-work.md §5 names first: "Eighteen files exceed 1,000
 * lines, admin.ts at 5,473 with 40 exported actions." It had grown since that
 * was written.
 *
 * It split cleanly because none of the 39 private implementations called each
 * other. They shared a 40-import header, two date helpers and one type, and
 * nothing else, so this is a move rather than a rewrite: every function body is
 * byte-for-byte what it was, and the export surface is the same 39 actions and
 * one type it always was. admin-barrel-parity.test.ts pins that.
 *
 * The previous file here did `export * from '../admin'`, which resolved to
 * admin.ts because a file beats a directory of the same name. With that file
 * gone it would have resolved to this directory — itself — so it is a real
 * barrel now.
 *
 * Private files (_users, _withdrawals, _land, ...) must never be imported
 * directly from outside this domain, matching the cooperative and marketplace
 * domains.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────
export type { EditableApplicationFields } from "./_applications";

// ─── Withdrawals (_withdrawals.ts) ────────────────────────────────────────────
export {
    processWithdrawalAction,
    getPendingWithdrawalsAction,
} from "./_withdrawals";

// ─── Users (_users.ts) ────────────────────────────────────────────────────────
export {
    toggleUserVerificationAction,
    toggleUserKycVerificationAction,
    unlockUserAccount,
    getUsersAction,
    updateUserRolesAction,
    updateUserGenderAction,
} from "./_users";

// ─── Land verification (_land.ts) ─────────────────────────────────────────────
export {
    getPendingLandListings,
    verifyLandListing,
} from "./_land";

// ─── Cooperative loans (_loans.ts) ────────────────────────────────────────────
export {
    getPendingLoanApplications,
    approveLoanApplication,
    rejectLoanApplication,
} from "./_loans";

// ─── Export module (_exports.ts) ──────────────────────────────────────────────
export {
    getAllExportRequestsAction,
    approveExportOnboardingAction,
    requestExportApplicationRevisionAction,
    getExportApplicationsStatsAction,
    getStandardExportApplicationsAction,
    rejectExportApplicationAction,
} from "./_exports";

// ─── Academy (_academy.ts) ────────────────────────────────────────────────────
export {
    getAcademyApplicationsAction,
    approveAcademyApplicationAction,
    rejectAcademyApplicationAction,
    markAcademyApplicationUnderReviewAction,
    manualAcademyEnrollmentAction,
} from "./_academy";

// ─── Marketplace (_marketplace.ts) ────────────────────────────────────────────
export {
    approveSellerVerificationAction,
    toggleVerifiedBadgeAction,
    getStandardSellerVerificationsAction,
    getMarketplaceUsersAction,
    getAdminSellerStatsAction,
    approveMarketplaceUserAction,
    rejectMarketplaceUserAction,
    getAdminProductsAction,
    reviewProductAction,
} from "./_marketplace";

// ─── Platform settings (_settings.ts) ─────────────────────────────────────────
export {
    savePlatformSettingsAction,
    getPlatformSettingsAction,
    // #381 — the money knobs: fees, order bounds, USD→NGN, WAVE commission.
    getSystemSettingsAction,
    saveSystemSettingsAction,
} from "./_settings";

// ─── Application editing (_applications.ts) ───────────────────────────────────
export { editApplicationAction } from "./_applications";

// ─── Legacy member onboarding (_legacy.ts) ────────────────────────────────────
export {
    inviteLegacyMemberAction,
    onboardLegacyMemberAction,
} from "./_legacy";

// ─── WAVE ─────────────────────────────────────────────────────────────────────
// Forwarded straight from the wave domain, as admin.ts did. Deliberately not a
// _wave.ts of its own: a file whose only content is a re-export would be an
// action file with no session guard, which action-security-audit.test.ts would
// flag — correctly, since the guards live in wave/_admin.ts where the actions
// are actually defined. Barrels are exempt from that scan; a pass-through file
// pretending to be an action module should not be.
export {
    approveWaveApplicationAction,
    rejectWaveApplicationAction,
} from "../wave/_wv_admin_applications";

// ─── Diagnostics (_diagnostics.ts) ────────────────────────────────────────────
export { runSystemDiagnosticAction } from "./_diagnostics";
