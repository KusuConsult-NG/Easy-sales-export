
/**
 * Cooperative Domain Action Barrel
 *
 * Single import point for ALL Cooperative server actions AND types.
 * Private files (_actions, _admin, _payment, _dashboard, _loans, _withdrawal)
 * must never be imported directly from outside this domain.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────
export type {
    MemberIdCardData,
} from "./_actions";

export type {
    ActionState,
} from "./_payment";

export type {
    LoanApplication,
    RepaymentInstallment,
} from "./_loans";

// ─── Member-facing actions (_actions.ts) ──────────────────────────────────────
export {
    initiateCooperativePaymentAction,
    registerCooperativeMemberAction,
    joinCooperativeAction,
    makeContributionAction,
    submitWithdrawalAction,
    getMembershipAction,
    getTransactionsAction,
    getUserTierAction,
    checkCooperativeStatusAction,
    applyForLoanAction,
    createFixedSavingsAction,
    getDirectoryMembersAction,
    getCooperativeApplicationAction,
    resubmitCooperativeApplicationAction,
    getCooperativeMemberIdCardAction,
    updatePassportPhotoAction,
    updateMemberProfileDetailsAction,
    validateCooperativeInviteAction,
} from "./_actions";

// ─── Admin actions (_admin.ts) ────────────────────────────────────────────────
export {
    getCooperativeStatsAction,
    getAllMembersAction,
    updateMemberStatusAction,
    getAllTransactionsAction,
    getContributionReportsAction,
    getRecentActivityAction,
    approveWithdrawalAction,
    rejectWithdrawalAction,
    requestCooperativeRevisionAction,
    getStandardCooperativeMembersAction,
} from "./_admin";

// ─── Payment actions (_payment.ts) ────────────────────────────────────────────
export {
    initializeContributionPaymentAction,
    verifyContributionPaymentAction,
} from "./_payment";

// ─── Dashboard actions (_dashboard.ts) ────────────────────────────────────────
export {
    getDashboardDataAction,
} from "./_dashboard";

// ─── Loan actions (_loans.ts) ─────────────────────────────────────────────────
export {
    submitLoanApplicationAction,
    getUserLoanApplicationsAction,
    getPendingLoanApplicationsAction,
    getAdminLoanApplicationsAction,
    getAdminLoanApplicationsExportAction,
    getAdminLoanStatsAction,
    approveLoanAction,
    rejectLoanAction,
    disburseLoanAction,
    getRepaymentScheduleAction,
    submitRepaymentAction,
    repayLoanFromSavingsAction,
    getRepaymentHistoryAction,
} from "./_loans";

// ─── Withdrawal actions (_withdrawal.ts) ──────────────────────────────────────
export {
    submitWithdrawalRequestAction,
} from "./_withdrawal";
