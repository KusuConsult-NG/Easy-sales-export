/**
 * WAVE Domain Types
 *
 * @easy-sales/wave/types
 *
 * Re-exports from the canonical @easy-sales/types/wave.
 * This package adds WAVE-specific composite types and view-model shapes.
 */

// Re-export all base types from the shared types package
export type {
    WaveApplication,
    WaveCertificate,
    WaveShipment,
    WaveResource,
    WaveWithdrawal,
    WaveEarning,
    BriefingSubmission,
} from "../../types/src/wave";

// ─── WAVE View Models (UI-specific composite types) ───────────────────────────

/** Summary card shown on the member dashboard */
export interface WaveMemberDashboardSummary {
    memberId: string;
    fullName: string;
    enrolledAt: Date;
    totalEarnings: number;
    pendingEarnings: number;
    certificatesCount: number;
    trainingsCompleted: number;
    shipmentsActive: number;
    applicationStatus: WaveApplication["status"];
}

/** Stats block shown on the admin WAVE overview page */
export interface WaveAdminStats {
    totalApplications: number;
    pendingApplications: number;
    approvedApplications: number;
    rejectedApplications: number;
    totalEnrolled: number;
    pendingWithdrawals: number;
    totalWithdrawn: number;
    totalResources: number;
}

/** Training event summary (used in admin + member views) */
export interface WaveTrainingEventSummary {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
    location: string;
    capacity: number;
    registeredCount: number;
    status: "upcoming" | "ongoing" | "completed" | "cancelled";
}

type WaveApplication = import("../../types/src/wave").WaveApplication;
