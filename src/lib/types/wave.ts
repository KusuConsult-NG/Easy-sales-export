/**
 * Wave Program Types
 * 
 * Domain: WAVE (Women in Agriculture & Value-chain Empowerment)
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

export interface WaveApplication {
    id: string;
    userId: string;
    userEmail?: string;   // Canonical field — populated from session at submission
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
    // Section B: Civic Status (nin + votersCardNumber mandatory)
    nin: string;
    votersCardNumber: string;  // Mandatory — Permanent Voter's Card Number
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
    // Section E: Financial (bankName + accountNumber + bvn mandatory)
    hasBankAccount?: boolean;
    bankName: string;       // Mandatory
    accountNumber: string;  // Mandatory
    bvn: string;            // Mandatory — Bank Verification Number
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
    createdAt?: Date;      // Set at document creation
    updatedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    reviewNotes?: string;  // Internal admin notes
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
    withdrawalId: string; // Canonical ID, e.g. WD-1234-ABC
    userId: string;
    userEmail?: string;
    amount: number; // Amount requested in ₦, minimum 5,000
    status: "pending" | "approved" | "approved_pending_payout" | "rejected" | "completed";
    requestedAt: Date;
    processedAt?: Date;
    processedBy?: string; // Admin userId who approved/rejected
    adminNotes?: string;
    // Payout tracking (set when Paystack transfer is attempted)
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
    memberId?: string;  // WAVE member ID
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
