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
} from "./_actions";

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
export {
    checkWaveStatusAction,
    checkWaveEligibilityAction,
    submitMultiStepWaveApplicationAction,
    enrollInWaveAction,
    getWaveResourcesAction,
    getWaveTrainingEventsAction,
    getShipmentTrackingAction,
    updateShipmentStatusAction,
    syncShipmentWithCarrierAction,
    calculateEarningsAction,
    generateCertificateAction,
    getMemberCertificatesAction,
    getCurrentUserCertificatesAction,
    uploadWaveResourceAction,
    incrementResourceDownloadAction,
    registerForTrainingAction,
    withdrawEarningsAction,
    getWaveApplicationStatusAction,
    getWaveApplicationAction,
    requestWaveRevisionAction,
    resubmitWaveApplicationAction,
    checkWaveAccessAction,
} from "./_actions";

// ─── Member utility actions ───────────────────────────────────────────────────
export {
    checkWaveMembershipAction,
    getWaveMemberStatsAction,
    trackResourceAccessAction,
    getUserTrainingRegistrationsAction,
} from "./_member";

// ─── Admin actions ────────────────────────────────────────────────────────────
export {
    createResourceAction,
    updateResourceAction,
    deleteResourceAction,
    createTrainingEventAction,
    updateTrainingEventAction,
    getEventParticipantsAction,
    getWaveApplicationsAction,
    approveWaveApplicationAction,
    rejectWaveApplicationAction,
    getStandardWaveApplicationsAction,
    getStandardWaveWithdrawalsAction,
    processWaveWithdrawalAction,
} from "./_admin";

// ─── Briefing actions ─────────────────────────────────────────────────────────
export {
    registerForBriefingAction,
} from "@/app/actions/briefing";

export {
    getBriefingRegistrationsAction,
} from "@/app/actions/briefing-admin";
