
/**
 * WAVE Domain Action Barrel
 *
 * Single import point for ALL WAVE server actions AND types.
 *
 * All consumers import from "@/app/actions/wave" — not from sub-files.
 * The underscore-prefixed files (_actions, _admin, _member) are private
 * to this domain and should never be imported directly.
 */

// ─── Domain types (from domain action files) ──────────────────────────────────
// These are the "view-layer" shapes used by pages — slightly different from the
// canonical Firestore types in @/lib/types/wave which are the persistence shapes.
export type {
    WaveResource,
    WaveTrainingEvent,
    ShipmentTracking,
    MemberEarnings,
    WaveCertificate,
} from "@/lib/types/wave-actions";

// Briefing types
export type {
    BriefingRegistrationData,
    BriefingStatus,
} from "@/app/actions/briefing";

export type {
    BriefingRegistration,
    BriefingRegistrationsResult,
    BriefingRegistrationOpts,
} from "@/app/actions/briefing-admin";

// ─── Member-facing actions ────────────────────────────────────────────────────
// ─── Applications (_wv_applications.ts) ──────────────────────────────────────
export {
    submitMultiStepWaveApplicationAction,
    resubmitWaveApplicationAction,
    getWaveApplicationStatusAction,
    getWaveApplicationAction,
    requestWaveRevisionAction,
} from "./_wv_applications";

// ─── Membership and eligibility (_wv_membership.ts) ──────────────────────────
export {
    checkWaveStatusAction,
    checkWaveEligibilityAction,
    enrollInWaveAction,
    checkWaveAccessAction,
} from "./_wv_membership";

// ─── Resources and training (_wv_resources.ts) ───────────────────────────────
export {
    getWaveResourcesAction,
    uploadWaveResourceAction,
    incrementResourceDownloadAction,
    getWaveTrainingEventsAction,
    registerForTrainingAction,
} from "./_wv_resources";

// ─── Shipment tracking (_wv_shipments.ts) ────────────────────────────────────
export {
    getShipmentTrackingAction,
    updateShipmentStatusAction,
    syncShipmentWithCarrierAction,
} from "./_wv_shipments";

// ─── Earnings and withdrawals (_wv_earnings.ts) ──────────────────────────────
export {
    calculateEarningsAction,
    withdrawEarningsAction,
} from "./_wv_earnings";

// ─── Certificates (_wv_certificates.ts) ──────────────────────────────────────
export {
    generateCertificateAction,
    getMemberCertificatesAction,
    getCurrentUserCertificatesAction,
} from "./_wv_certificates";

// ─── Member utility actions ───────────────────────────────────────────────────
export {
    checkWaveMembershipAction,
    getWaveMemberStatsAction,
    trackResourceAccessAction,
    getUserTrainingRegistrationsAction,
} from "./_member";

// ─── Admin actions ────────────────────────────────────────────────────────────
// ─── Admin: resources and training (_wv_admin_resources.ts) ─────────────────
export {
    createResourceAction,
    updateResourceAction,
    deleteResourceAction,
    createTrainingEventAction,
    updateTrainingEventAction,
    deleteTrainingEventAction,
    getEventParticipantsAction,
} from "./_wv_admin_resources";

// ─── Admin: live sessions (_wv_admin_live.ts) ───────────────────────────────
export {
    startWaveLiveSessionAction,
    endWaveLiveSessionAction,
} from "./_wv_admin_live";

// ─── Admin: applications (_wv_admin_applications.ts) ────────────────────────
export {
    getWaveApplicationsAction,
    approveWaveApplicationAction,
    rejectWaveApplicationAction,
    getStandardWaveApplicationsAction,
} from "./_wv_admin_applications";

// ─── Admin: withdrawals (_wv_admin_withdrawals.ts) ──────────────────────────
export {
    getStandardWaveWithdrawalsAction,
    processWaveWithdrawalAction,
} from "./_wv_admin_withdrawals";

// ─── Admin: shipments (_wv_admin_shipments.ts) ──────────────────────────────
export {
    createWaveShipmentAction,
    getWaveShipmentsAction,
} from "./_wv_admin_shipments";


// ─── Briefing actions ─────────────────────────────────────────────────────────
export {
    registerForBriefingAction,
} from "@/app/actions/briefing";

export {
    getBriefingRegistrationsAction,
} from "@/app/actions/briefing-admin";
