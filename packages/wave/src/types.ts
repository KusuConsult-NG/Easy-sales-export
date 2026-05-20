/**
 * WAVE Domain Types
 *
 * @easy-sales/wave/types
 *
 * Base persistence types are inlined here to avoid cross-package imports
 * that fail in the Docker/Railway build environment.
 */

// ─── Base Persistence Types (inlined from @easy-sales/types/wave) ────────────

export interface WaveApplication {
    id: string;
    userId: string;
    userEmail?: string;
    // Section A: Personal Identification
    surname: string;
    firstName: string;
    otherNames?: string;
    dateOfBirth: string;
    age: number;
    phone: string;
    alternativePhone?: string;
    /** @deprecated Use userEmail instead. Present on older docs — read both for compatibility */
    email?: string;
    residentialAddress: string;
    stateOfOrigin: string;
    lgaOfOrigin: string;
    stateOfResidence: string;
    lgaOfResidence: string;
    maritalStatus: "single" | "married" | "widowed" | "divorced" | "";
    nextOfKinName: string;
    nextOfKinPhone: string;
    nextOfKinRelationship: string;
    // Section B: Civic Status
    nin: string;
    votersCardNumber: string;
    pollingUnit?: string;
    ward?: string;
    yearOfVoterRegistration?: string;
    votedInLastElection?: boolean;
    // Section C: Socio-Economic
    highestEducation: string;
    currentOccupation: string;
    averageMonthlyIncome: string;
    involvedInAgriculture: boolean;
    agricultureTypes?: string[];
    // Section D: Agricultural Interest
    valueChainAreas: string[];
    preferredCommodities: string[];
    preferredCommodityOther?: string;
    hasAccessToFarmland: boolean;
    farmlandHectares?: number;
    needsFarmlandAccess?: boolean;
    // Section E: Financial
    hasBankAccount?: boolean;
    bankName: string;
    accountNumber: string;
    bvn: string;
    isMemberOfCooperative: boolean;
    cooperativeName?: string;
    willingToJoinCooperative: boolean;
    // Section F: Training
    supportNeeded: string[];
    willingToUndergoTraining: boolean;
    willingToComplyWithStandards: boolean;
    willingToParticipateInME: boolean;
    // Section G: Declaration
    declarationAccepted: boolean;
    consentGiven: boolean;
    // Admin fields
    status: "draft" | "pending" | "submitted" | "under_review" | "approved" | "rejected";
    applicationDate?: Date;
    submittedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    reviewNotes?: string;
    rejectionReason?: string;
}

export interface WaveCertificate {
    id: string;
    memberId: string;
    memberName: string;
    certificateType: "training" | "achievement" | "completion";
    programName: string;
    issuedDate: Date;
    certificateNumber: string;
    verificationUrl: string;
    createdAt?: Date;
}

export interface WaveShipment {
    id: string;
    memberId: string;
    orderId: string;
    productName: string;
    destination: string;
    carrier: string;
    trackingNumber: string;
    status: "pending" | "in_transit" | "delivered" | "cancelled";
    estimatedDelivery: Date;
    actualDelivery?: Date;
    updates: {
        timestamp: Date;
        location: string;
        status: string;
        note?: string;
    }[];
    createdAt: Date;
}

export interface WaveResource {
    id: string;
    title: string;
    description?: string;
    category: string;
    fileUrl: string;
    fileType?: string;
    fileSize?: number;
    isActive: boolean;
    uploadedBy?: string;
    uploadedAt?: Date;
    downloadCount?: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface WaveWithdrawal {
    id: string;
    withdrawalId: string;
    userId: string;
    userEmail?: string;
    amount: number;
    status: "pending" | "approved" | "approved_pending_payout" | "rejected" | "completed";
    requestedAt: Date;
    processedAt?: Date;
    processedBy?: string;
    adminNotes?: string;
    paystackTransferCode?: string;
    pendingManualPayout?: boolean;
    payoutError?: string;
    createdAt: Date;
    updatedAt?: Date;
    _version?: number;
}

export interface WaveEarning {
    id: string;
    userId: string;
    memberId?: string;
    amount: number;
    type: "training_bonus" | "referral" | "sales_commission" | "other";
    description?: string;
    status: "pending" | "approved" | "paid" | "rejected";
    approvedBy?: string;
    approvedAt?: Date;
    paidAt?: Date;
    paystackTransferCode?: string;
    createdAt: Date;
    updatedAt?: Date;
}

export interface BriefingSubmission {
    id: string;
    fullName: string;
    phone: string;
    email?: string;
    state: string;
    role: string;
    programType: string;
    status: "pending_sync" | "synced" | "rejected";
    syncedAt?: Date;
    submittedAt: Date;
    source: "online" | "offline";
}

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
