
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
} from "./_coop_identity";

export type {
    ActionState,
} from "./_payment";

export type {
    LoanApplication,
    RepaymentInstallment,
} from "@/lib/types/cooperative-loans";

// ─── Registration and applications (_coop_registration.ts) ───────────────────
export {
    registerCooperativeMemberAction,
    joinCooperativeAction,
    validateCooperativeInviteAction,
    getCooperativeApplicationAction,
    resubmitCooperativeApplicationAction,
} from "./_coop_registration";

// ─── Membership status and directory (_coop_membership.ts) ───────────────────
export {
    getMembershipAction,
    checkCooperativeStatusAction,
    getUserTierAction,
    getDirectoryMembersAction,
} from "./_coop_membership";

// ─── Money in and out (_coop_money.ts) ───────────────────────────────────────
export {
    initiateCooperativePaymentAction,
    makeContributionAction,
    submitWithdrawalAction,
    applyForLoanAction,
    createFixedSavingsAction,
    getTransactionsAction,
} from "./_coop_money";

// ─── Member identity and profile (_coop_identity.ts) ─────────────────────────
export {
    getCooperativeMemberIdCardAction,
    updatePassportPhotoAction,
    updateMemberProfileDetailsAction,
} from "./_coop_identity";

// ─── Admin: members (_coop_admin_members.ts) ─────────────────────────────────
export {
    getAllMembersAction,
    updateMemberStatusAction,
    getStandardCooperativeMembersAction,
    requestCooperativeRevisionAction,
} from "./_coop_admin_members";

// ─── Admin: reports and stats (_coop_admin_reports.ts) ───────────────────────
export {
    getCooperativeStatsAction,
    getContributionReportsAction,
    getRecentActivityAction,
} from "./_coop_admin_reports";

// ─── Admin: transactions and withdrawals (_coop_admin_money.ts) ──────────────
export {
    getAllTransactionsAction,
    approveWithdrawalAction,
    rejectWithdrawalAction,
} from "./_coop_admin_money";

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
// ─── Loans: applications (_loans_applications.ts) ────────────────────────────
export {
    submitLoanApplicationAction,
    getUserLoanApplicationsAction,
    getPendingLoanApplicationsAction,
    getAdminLoanApplicationsAction,
    getAdminLoanApplicationsExportAction,
    getAdminLoanStatsAction,
} from "./_loans_applications";

// ─── Loans: decisions (_loans_decisions.ts) ──────────────────────────────────
export {
    approveLoanAction,
    rejectLoanAction,
    disburseLoanAction,
} from "./_loans_decisions";

// ─── Loans: repayments (_loans_repayments.ts) ────────────────────────────────
export {
    getRepaymentScheduleAction,
    submitRepaymentAction,
    repayLoanFromSavingsAction,
    getRepaymentHistoryAction,
} from "./_loans_repayments";

// ─── Withdrawal actions (_withdrawal.ts) ──────────────────────────────────────
export {
    submitWithdrawalRequestAction,
} from "./_withdrawal";
