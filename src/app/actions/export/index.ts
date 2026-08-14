/**
 * Export Domain Action Barrel
 *
 * Single import point for the Export module's server actions.
 * `@/app/actions/export` resolves here, so every existing import keeps working
 * unchanged — the arrangement admin.ts got in #202 and farm-nation.ts in #207.
 *
 * Replaced actions/export.ts, 1,534 lines. The action states and the two zod
 * input schemas moved to @/lib/types/export-actions and are re-exported below.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────
export type {
    ExportWindowFormData,
    CreateExportActionState,
    UpdateStatusActionState,
    UpdateExportStatusState,
    GetExportsActionState,
} from "@/lib/types/export-actions";

// ─── Export windows (_ex_windows.ts) ─────────────────────────────────────────
export {
    createExportWindowAction,
    updateExportStatusAction,
    updateExportWindowAction,
    getExportWindowsAction,
    getExportRequestByIdAction,
    getExportWindowDetailsAction,
} from "./_ex_windows";

// ─── Onboarding and applications (_ex_onboarding.ts) ─────────────────────────
export {
    submitExportOnboardingAction,
    checkExportStatusAction,
    getExportApplicationAction,
    requestExportRevisionAction,
    approveExportApplicationAction,
    resubmitExportApplicationAction,
    checkExportAccessAction,
} from "./_ex_onboarding";

// ─── Investments and escrow (_ex_investments.ts) ─────────────────────────────
export {
    getUserExportInvestmentsAction,
    getUserExportStatsAction,
    investInExportAction,
    verifyExportInvestmentAction,
    getMyExportInvestmentsAction,
    extendEscrowAction,
} from "./_ex_investments";
