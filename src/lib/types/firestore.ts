/**
 * Firestore Database Collections Structure
 * 
 * This file documents the complete Firestore database schema
 * for the Easy Sales Export platform.
 * 
 * NDPR / SECURITY COMPLIANCE NOTE:
 * All PII (Personally Identifiable Information) including banking details,
 * names, and addresses stored within these collections are automatically
 * Encrypted At Rest using AES-256 by the Firebase/Google Cloud infrastructure.
 */

// Export PRD-required interfaces
export * from "./prd-interfaces";

// Export role types
import type { UserRole, LegacyRole } from "./roles";
export type { UserRole, LegacyRole };
export { ROLE_LABELS, LEGACY_ROLE_MAP } from "./roles";

export interface User {
    uid: string;
    // Structured name fields — written by all onboarding modules (post-April 2026)
    firstName?: string;
    lastName?: string;
    otherName?: string; // optional middle/other name
    // Legacy combined name — written by old auth registration. Keep for backward compat.
    fullName: string;
    email: string;
    phone?: string;
    gender?: "male" | "female"; // Required for WAVE participant validation
    stateOfOrigin?: string; // Synced globally from onboarding hubs for Admin filtering
    lga?: string;           // Synced globally for Admin filtering
    residentialAddress?: string; // Synced globally for dispatch/delivery routing
    roles: UserRole[]; // Multi-role support (changed from single role)
    /** @deprecated Use `isVerified` instead. Kept for backward compatibility with old docs. */
    verified: boolean;
    /** Canonical verification field — always read this one in application code. */
    isVerified?: boolean;

    // Cooperative
    cooperativeId?: string;
    cooperativeMembershipId?: string;
    cooperativeTier?: "tier1" | "tier2"; // ₦10K or ₦20K
    cooperativeRegistrationFee?: number;

    // Seller Verification (Enhanced)
    sellerVerificationStatus?: "pending" | "approved" | "rejected" | "suspended";
    sellerVerificationId?: string; // Reference to seller_verifications collection
    sellerPhoneVerified?: boolean;
    sellerCategory?: "wholesale" | "retail";       // NEW: seller categorization
    isVerifiedBadge?: boolean;                     // NEW: verified badge granted by admin
    verifiedBadgeGrantedAt?: Date;                 // NEW
    allowsPaymentOnDelivery?: boolean;             // NEW: seller opted in to POD

    // KYC / Identity Verification
    nin?: string;            // National Identification Number
    ninVerified?: boolean;
    votersCardNumber?: string; // Permanent Voter's Card
    bvn?: string;
    bvnVerified?: boolean;
    idType?: string; // e.g. "nin"
    idNumber?: string;       // Generic ID number (legacy — prefer nin)
    idVerified?: boolean;

    // KYB / Business Verification
    taxId?: string; // TIN
    tinVerified?: boolean;
    cacNumber?: string; // RC Number
    companyName?: string;
    cacVerified?: boolean;

    // Bank Details (for sellers and cooperative members)
    bankDetails?: {
        accountNumber: string;
        bankName: string;
        accountName: string;
        bankCode: string;
    };

    // Top-level bank fields — written directly by payout actions (paystackPayout reads these)
    bankAccountNumber?: string;
    bankAccountName?: string;
    bankCode?: string;

    // Address
    address?: {
        street: string;
        city: string;
        state: string;
        lga: string;
        country: string;
    };

    // MFA fields
    mfaEnabled?: boolean;
    totpSecret?: string; // Encrypted TOTP secret
    mfaRecoveryCodes?: string[]; // Encrypted recovery codes
    onboardingCompleted?: boolean; // For onboarding tour

    // NDPR / GDPR Compliance Tracking
    consentVersion?: string; // e.g., "1.0.0"
    consentDate?: Date;
    marketingOptIn?: boolean;

    // Notification preferences
    notifications?: {
        email?: boolean;
        push?: boolean;
        sms?: boolean;
    };

    // Service Registrations — tracks status of each sub-platform enrollment
    serviceRegistrations?: {
        wave?: {
            status: "pending" | "under_review" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date;
            approvedAt?: Date;
            rejectionReason?: string;
        };
        cooperative?: {
            status: "pending" | "paid" | "approved" | "rejected";
            tier?: "tier1" | "tier2";
            applicationId?: string;
            paymentReference?: string;
            submittedAt?: Date;
        };
        farmNation?: {
            status: "pending" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date;
        };
        export?: {
            status: "pending" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date;
        };
        academy?: {
            status: "pending" | "approved" | "active" | "suspended" | "rejected";
            enrolledAt?: Date;
            applicationId?: string;
            submittedAt?: Date;
            paymentStatus?: "pending" | "completed" | "failed";
            plan?: "foundation" | "standard" | "elite" | "advanced";
        };
    };

    createdAt: Date;
    updatedAt: Date;
}

export interface ExportWindow {
    id: string;
    title?: string; // e.g. "Q1 2026 Yam Export"
    orderId: string; // @deprecated - leaving for compatibility
    commodity: "yam" | "sesame" | "hibiscus" | "other";
    quantity: string;
    amount: number; // Minimum investment
    roi: string; // e.g. "15-20%"
    duration: string; // e.g. "6 months"
    totalSpots?: number;
    spotsFilled?: number;
    fundedAmount?: number; // Total amount raised
    image?: string;
    status: "pending" | "open" | "active" | "completed" | "closed" | "in_transit" | "delivered";

    // Deep Data Fields
    description?: string;
    specifications?: string[]; // List of product specs
    benefits?: string[]; // List of investment benefits
    documents?: {
        name: string;
        url?: string;
        required: boolean;
    }[];
    timeline?: {
        phase: string;
        date: string;
        description: string;
        status: "pending" | "active" | "completed";
    }[];

    userId?: string; // Creator/Admin
    startDate?: Date;
    endDate?: Date;
    deliveryDate?: Date; // Legacy support
    createdAt: Date;
    updatedAt: Date;
}

export interface ExportOnboardingApplication {
    applicationId: string;
    userId: string;
    userEmail?: string | null;
    profile: any;
    kyc: any;
    bank: any;
    terms: any;
    status: "pending_review" | "approved" | "rejected";
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface Notification {
    id: string;
    userId: string;
    type: "escrow" | "order" | "academy" | "wave" | "cooperative" | "export"
    | "payment" | "loan" | "system" | "event" | "payout"
    | "info" | "warning" | "success" | "farm_nation" | "marketplace" | "general"
    | "transaction"; // NEW: transaction lifecycle notifications (order placed/shipped/delivered/cancelled)
    title: string;
    message: string;
    link?: string;
    linkText?: string; // CTA button label e.g. "View Loans"
    read: boolean;
    createdAt: Date;
}

export interface Course {
    id: string;
    title: string;
    description: string;
    instructor: string;
    duration: string;
    level: "beginner" | "intermediate" | "advanced";
    tier?: "free" | "foundation" | "standard" | "elite";
    price: number;
    thumbnail?: string;
    enrolledCount: number;
    rating: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface Enrollment {
    id: string;
    userId: string;
    courseId: string;
    progress: number;
    completed: boolean;
    enrolledAt: Date;
    completedAt?: Date;
}

export interface Cooperative {
    id: string;
    name: string;
    description: string;
    memberCount: number;
    totalSavings: number;
    monthlyTarget: number;
    location: string;
    adminId: string;
    createdAt: Date;
}

export interface CooperativeMember {
    id: string;
    cooperativeId?: string;
    userId: string;
    savingsBalance: number;
    loanBalance: number;
    joinedAt?: Date;
    contributionAmount?: number;  // Total lifetime contributions (used for loan eligibility)
    totalContributions?: number;  // Alias used in some dashboard actions
    tier?: "basic" | "premium" | "tier1" | "tier2";
    status?: "active" | "inactive" | "suspended" | "pending" | "under_review" | "approved" | "rejected";
    membershipStatus?: "pending" | "approved" | "active" | "rejected" | "under_review" | "suspended";
    paymentStatus?: "pending" | "completed" | "failed";
    onboardingCompleted?: boolean;
    // Personal info written by registerCooperativeMemberAction
    firstName?: string;
    lastName?: string;
    middleName?: string;         // Added: admin members modal shows this
    email?: string;
    phone?: string;
    dateOfBirth?: string;        // Added: admin members modal shows this
    gender?: "male" | "female" | "";  // Added: admin members modal shows this
    stateOfOrigin?: string;      // Added: admin members modal shows this
    lga?: string;                // Added: admin members modal shows this
    residentialAddress?: string; // Added: admin members modal shows this
    occupation?: string;         // Added: admin members modal shows this
    registrationFee?: number;    // Added: admin table shows this
    membershipTier?: "basic" | "premium";
    // Next of kin written during onboarding
    nextOfKin?: {
        name: string;
        phone: string;
        address: string;
    };
    // Legacy flat next-of-kin fields (backward compatible)
    nextOfKinName?: string;
    nextOfKinPhone?: string;
    nextOfKinAddress?: string;
    // Uploaded KYC document references (Firestore fallback refs or Storage URLs)
    documents?: {
        validId?: { name: string; url: string };
        idType?: string;
        passportPhoto?: { name: string; url: string };
        proofOfAddress?: { name: string; url: string };
        bvn?: string;            // Optional — collected, not live-verified
    };
    createdAt?: Date;
    updatedAt?: Date;
}

export interface LoanApplication {
    id: string;
    userId: string;
    userEmail?: string; // Used by approval email
    fullName?: string;  // Written by loans.ts submitLoanApplicationAction
    amount: number;
    purpose: string;
    status: "pending" | "partially_approved" | "approved" | "rejected" | "disbursed" | "repaid" | "completed";
    createdAt: Date;
    updatedAt?: Date;
    approvedAt?: Date;
    disbursedAt?: Date;
    repaidAt?: Date;
    appliedAt?: Date;   // Alias for createdAt used in loans.ts
    documents?: string[]; // Supporting document URLs

    // Financials
    interestRate?: number;
    durationMonths?: number;
    monthlyPayment?: number;
    totalRepayment?: number;
    contributionAmount?: number;
    tier?: string;

    // Maker-Checker approval chain (loans ≥ ₦1M require two admins)
    approvalChain?: {
        firstApprover?: string;
        firstApprovalAt?: Date;
        firstApproverName?: string;
        secondApprover?: string;
        secondApprovalAt?: Date;
        secondApproverName?: string;
    };

    // Disbursement tracking
    disbursed?: boolean;
    disbursementTransferCode?: string; // Paystack transfer code
    pendingManualDisbursement?: boolean; // Set if Paystack payout failed
    disbursementError?: string;
    disbursementNote?: string;

    // Review
    reviewedBy?: string;
    reviewedAt?: Date;
    rejectionReason?: string;
}

export interface Payment {
    id: string;
    userId: string;
    amount: number;
    type: string;
    status: "pending" | "completed" | "failed";
    reference: string;
    createdAt: Date;
}

export interface Certificate {
    id: string;
    userId: string;
    courseId: string;
    certificateNumber: string;
    issueDate: Date;
    createdAt: Date;
}

export interface LandListing {
    id: string;
    title: string;
    description: string;
    location: string;
    size: string;
    price: number;
    userId: string;
    verified: boolean;
    createdAt: Date;
}

export interface UnifiedTransaction {
    id: string;          // Maps to document ID
    userId: string;      // Mandatory
    type: string;        // Specific payload type e.g. "contribution", "registration", "wallet_funding", "escrow_payment"
    module: "wave" | "cooperative" | "marketplace" | "farm_nation" | "export" | "academy" | "general" | "wallet";
    amount: number;
    currency: string;
    status: "pending" | "completed" | "failed" | "refunded";
    date: Date;          // Core aggregation timestamp
    reference?: string;  // Payment gateway reference
    description?: string;
    metadata?: Record<string, unknown>; // Any legacy properties (cooperativeId, escrowId)
}

// Import detailed types from marketplace module
import type {
    EscrowTransaction,
    Dispute
} from "./marketplace";
export type { EscrowTransaction, Dispute };

// Note: Notification, WaveApplication etc. are still defined here as they might not have a dedicated module type file yet.


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

export interface CooperativeOnboardingApplication {
    id: string;
    userId: string;
    userEmail?: string;
    tier: "tier1" | "tier2";
    personalInfo: {
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        gender: string;
        occupation: string;
        address: string;
        phone?: string;    // Added: Schema sync to support communication hub
        state: string;
        lga: string;
    };
    nextOfKin: {
        name: string;
        relationship: string;
        phone: string;
    };
    documents: {
        validId?: { name: string; url: string };
        idType?: string;
        idNumber?: string;
        // idVerified removed — was set by QoreID (now removed). Admin reviews manually.
        passportPhoto?: { name: string; url: string };
        proofOfAddress?: { name: string; url: string };
        bvn?: string;            // Optional — no longer required; admin reviews manually
        // bvnVerified removed — was set by QoreID (now removed). Admin reviews manually.
    };
    paymentReference?: string;
    paymentStatus?: "pending" | "completed" | "failed";
    status: "pending" | "approved" | "rejected";
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt?: Date;
}

export interface MarketplaceOrder {
    id: string;
    buyerId: string;
    sellerId?: string;
    items: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
    }[];
    buyerDetails: {
        companyName: string;
        email: string;
        phone: string;
        address: string;
    };
    totalAmount: number;
    paymentReference?: string;
    paymentStatus: "pending" | "paid" | "failed" | "refunded";
    orderStatus: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
    escrowEnabled?: boolean;
    escrowTransactionId?: string;
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

export interface VendorSettings {
    id?: string;
    userId: string;
    storeInfo?: {
        name?: string;
        description?: string;
        category?: string;
        contactEmail?: string;
        phone?: string;
    };
    paymentConfig?: {
        bankName?: string;
        accountNumber?: string;
        accountName?: string;
        bankCode?: string;
        paymentSchedule?: "weekly" | "monthly";
        minPayoutThreshold?: number;
        taxId?: string;
    };
    notifications?: {
        newOrders?: boolean;
        lowStock?: boolean;
        payments?: boolean;
        reviews?: boolean;
        marketing?: boolean;
    };
    shipping?: {
        processingDays?: number;
        returnPolicy?: string;
        locations?: string[];
    };
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ExportInvestment {
    id: string;
    userId: string;
    windowId: string;
    amount: number;
    status: "pending" | "active" | "completed" | "cancelled";
    roi?: string;
    roiAmount?: number;
    investedAt?: Date;
    completedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ExportSlot {
    id: string;
    userId: string;
    exportId: string; // Reference to export_windows document
    windowTitle?: string; // Denormalized for display — e.g. "Q1 Yam Export"
    commodity?: string;
    amount: number; // Amount invested by the user
    expectedReturn: number; // Projected profit at window end
    roi?: string; // e.g. "15%"
    status: "pending" | "active" | "completed" | "cancelled";
    paymentReference?: string; // Paystack reference (optional until payment confirmed)
    purchaseDate?: Date;
    startDate?: Date;
    endDate?: Date;
    daysRemaining?: number;
    createdAt: Date;
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
}

export interface PlatformSettings {
    platformName: string;
    supportEmail: string;
    contactPhone: string;
    defaultCurrency: "NGN" | "USD" | "GBP";
    maintenanceMode: boolean;
    updatedBy?: string; // Admin userId who last saved
    updatedAt?: Date;
}

export interface PasswordResetToken {
    id: string;
    email: string;
    token: string;
    expiry: number; // Unix ms timestamp
    used: boolean;
    usedAt?: Date;
    createdAt: Date;
}

export interface Announcement {
    id: string;
    title: string;
    message: string;
    type: "info" | "warning" | "success";
    createdAt: Date;
}

export interface AuditLog {
    id: string;
    userId: string;
    action: string;
    entityId?: string;    // ID of the entity being acted on
    entityType?: string;  // e.g. "application", "user", "withdrawal"
    // Aliases used by createAdminAuditLog (audit-log-admin.ts)
    targetId?: string;
    targetType?: string;
    details?: string;
    metadata?: Record<string, any>;
    adminId?: string;
    // Extra fields written by admin audit logger
    severity?: "info" | "warning" | "critical";
    userEmail?: string;
    userRole?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    createdAt?: Date;
}

// ============================================
// Wave Earnings
// ============================================

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

// ============================================
// Loan Payments (individual repayment records per installment)
// ============================================

export interface LoanPayment {
    id: string;
    loanId: string;
    installmentId: string; // Reference to loan_repayments document
    userId: string;
    amount: number;
    paymentReference: string; // Paystack reference
    penaltyPaid?: number;
    paidAt: Date;
    createdAt?: Date;
}

// ============================================
// Loan Repayment Installments
// ============================================

export interface RepaymentInstallment {
    id?: string;
    loanId: string;
    userId: string;
    installmentNumber: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
    paidAt?: Date;
    penaltyAmount?: number;
    daysOverdue?: number;
}

/**
 * Firestore Collection Paths
 */
export const COLLECTIONS = {
    // Core collections
    USERS: "users",
    NOTIFICATIONS: "notifications",
    TRANSACTIONS: "transactions",
    ANALYTICS: "analytics",
    IDEMPOTENCY_KEYS: "idempotency_keys",

    // Export & Agriculture
    EXPORT_WINDOWS: "exportWindows",
    EXPORT_SLOTS: "export_slots",

    // Cooperatives & Finance
    COOPERATIVES: "cooperatives",
    COOPERATIVES_INVITES: "cooperatives_invites",
    COOPERATIVE_MEMBERS: "cooperative_members",
    COOPERATIVE_TRANSACTIONS: "cooperative_transactions",
    COOPERATIVE_LOANS: "cooperative_loans",
    FIXED_SAVINGS_PLANS: "fixed_savings_plans",
    LOAN_PRODUCTS: "loan_products",
    LOAN_APPLICATIONS: "loan_applications",
    LOAN_REPAYMENTS: "loan_repayments",
    LOAN_PAYMENTS: "loan_payments",
    WITHDRAWALS: "withdrawals",
    PAYMENTS: "payments",

    // WAVE Program
    WAVE_APPLICATIONS: "wave_applications",
    WAVE_RESOURCES: "wave_resources",
    WAVE_TRAINING_EVENTS: "wave_training_events",
    WAVE_TRAINING_REGISTRATIONS: "wave_training_registrations",

    // Land & Marketplace
    PRODUCTS: "products",
    MARKETPLACE_ORDERS: "marketplaceOrders",
    LAND_LISTINGS: "land_listings",
    LAND_VERIFICATIONS: "land_verifications",
    SELLER_VERIFICATIONS: "seller_verifications",
    ESCROW_TRANSACTIONS: "escrow_transactions",
    ESCROW_MESSAGES: "escrow_messages",
    DISPUTES: "disputes",
    PROCESSED_PAYMENTS: "processedPayments",
    FAILED_PAYMENTS: "failedPayments",

    // NEW: Marketplace Expansions (Phase 12)
    WALLETS: "wallets",
    WALLET_TRANSACTIONS: "wallet_transactions",
    VILLAGE_MARKET_EVENTS: "village_market_events",
    FLASH_SALE_PRODUCTS: "flash_sale_products",
    SELLER_REVIEWS: "seller_reviews",

    // Farm Nation
    FARM_NATION_PROPERTIES: "farmNationProperties",
    FARM_NATION_TRANSACTIONS: "farm_nation_transactions",

    // NEW: Marketplace Enhancement
    PRODUCT_IMAGES: "product_images",
    SHOPPING_CARTS: "shopping_carts",
    // @deprecated Use MARKETPLACE_ORDERS moving forward to prevent fragmentation
    ORDERS: "orders",
    MESSAGES: "messages",
    CONVERSATIONS: "conversations",
    PRODUCT_REVIEWS: "product_reviews",
    REVIEWS: "product_reviews", // Alias for PRODUCT_REVIEWS


    // Education & Training
    ACADEMY_APPLICATIONS: "academy_applications",
    COURSES: "courses",
    ENROLLMENTS: "enrollments",
    ACADEMY_COURSES: "academy_courses",
    ACADEMY_QUIZZES: "academy_quizzes",
    QUIZ_ATTEMPTS: "quiz_attempts",
    ACADEMY_LIVE_SESSIONS: "academy_live_sessions",
    COURSE_PROGRESS: "course_progress",
    COURSE_ENROLLMENTS: "course_enrollments",
    COURSE_CERTIFICATES: "course_certificates",
    CERTIFICATES: "certificates",

    // CMS & Admin
    ANNOUNCEMENTS: "announcements",
    BANNERS: "banners",
    AUDIT_LOGS: "audit_logs",
    FEATURE_TOGGLES: "feature_toggles",
    IMPERSONATION_TOKENS: "impersonation_tokens",

    // AI Chatbot (Phase 13)
    CHATBOT_SESSIONS: "chatbot_sessions",
    CHATBOT_MESSAGES: "chatbot_messages",

    // AI & Chat
    AI_CHAT_HISTORY: "ai_chat_history",

    // System
    SYSTEM_SETTINGS: "system_settings",

    // Vendor
    VENDOR_SETTINGS: "vendor_settings",
    VENDOR_REVIEWS: "vendor_reviews",
    // @deprecated Use MARKETPLACE_ORDERS moving forward to prevent fragmentation
    VENDOR_ORDERS: "vendor_orders",
    VENDOR_PRODUCTS: "vendor_products",
    VENDOR_PROFILES: "vendor_profiles",

    // WAVE Resource Access
    WAVE_RESOURCE_ACCESS: "wave_resource_access",

    // Export Investments
    EXPORT_INVESTMENTS: "exportInvestments",
    EXPORT_APPLICATIONS: "export_onboarding_applications",

    // Investor Portfolios
    INVESTOR_PORTFOLIOS: "investorPortfolios",
    PROPERTY_PURCHASES: "propertyPurchases",

    // Withdrawal Requests
    WITHDRAWAL_REQUESTS: "withdrawal_requests",

    // Marketplace Products & Sellers
    MARKETPLACE_PRODUCTS: "marketplace_products",
    MARKETPLACE_SELLERS: "marketplace_sellers",

    // Admin Users
    ADMIN_USERS: "admin_users",

    // Loans (standalone)
    LOANS: "loans",

    // WAVE — full suite
    WAVE_CERTIFICATES: "wave_certificates",
    WAVE_SHIPMENTS: "wave_shipments",
    WAVE_MEMBERS: "wave_members",
    WAVE_EARNINGS: "wave_earnings",
    WAVE_BRIEFING_REGISTRATIONS: "wave_briefing_registrations",

    // Cooperative onboarding applications
    COOPERATIVE_ONBOARDING: "cooperative_onboarding_applications",

    // KYC / Identity verification records
    KYC_VERIFICATIONS: "kyc_verifications",

    // Farm Nation
    FARM_NATION_INQUIRIES: "farm_nation_inquiries",

    // WAVE / Field briefings (offline submissions)
    BRIEFINGS: "briefing_submissions",

    // Auth
    PASSWORD_RESETS: "password_resets",

    // WAVE Earnings Withdrawals
    WAVE_WITHDRAWALS: "wave_withdrawals",

    // Cooperative Withdrawals (member savings withdrawals)
    COOPERATIVE_WITHDRAWALS: "cooperative_withdrawals",

    // Additional collections
    LAND_INQUIRIES: "land_inquiries",
    USER_ACTIVITY_LOGS: "user_activity_logs",
    COOPERATIVE_FIXED_SAVINGS: "cooperative_fixed_savings",
    COOPERATIVE_LOAN_PRODUCTS: "cooperative_loan_products",
    COOPERATIVE_CONTRIBUTIONS: "cooperative_contributions",
    LESSON_VIDEO_PROGRESS: "lesson_video_progress",
    EXPORT_BOOKINGS: "export_bookings",
    EMAIL_HISTORY: "email_history",

    // Platform / Admin Configuration
    PLATFORM_SETTINGS: "platform_settings",

    // Firestore-backed document uploads (fallback when Storage unavailable)
    DOCUMENT_UPLOADS: "_document_uploads",

    // Export Slots (individual investment slots per user per export window)
    // Note: EXPORT_SLOTS is already defined above — this alias is preferred in new code

    // Admin Communications
    BROADCAST_LOGS: "broadcast_logs",

    // Bounced Email Tracking
    BOUNCED_EMAILS: "bounced_emails",

    // Email Queue (cron-processed outgoing emails)
    EMAIL_QUEUE: "email_queue",

    // WhatsApp Group Invites
    WHATSAPP_INVITES: "whatsapp_invites",

    // Academy Quizzes (standalone collection — distinct from ACADEMY_QUIZZES)
    QUIZZES: "quizzes",

    // Export Catalog (products listed for export buyers)
    EXPORT_CATALOG: "export_catalog",

    // WAVE Training Sessions (scheduled sessions — distinct from WAVE_TRAINING_EVENTS)
    WAVE_TRAINING_SESSIONS: "wave_training_sessions",

    // User-uploaded certificates (KYC / identity documents)
    USER_CERTIFICATES: "user_certificates",

    // Payment Instructions (escrow payment/refund records)
    PAYMENT_INSTRUCTIONS: "paymentInstructions",
} as const;

// ─── AI Chatbot Types (Phase 13) ──────────────────────────────────────────
import type { ChatbotModule } from "@/lib/chatbot-knowledge";

export interface ChatbotSession {
    id: string;
    userId: string;
    userEmail: string;
    module: ChatbotModule;
    startedAt: FirebaseFirestore.Timestamp;
    lastMessageAt: FirebaseFirestore.Timestamp;
    messageCount: number;
    escalated: boolean;           // true if user triggered support escalation
    resolved: boolean;            // admin marks resolved
    resolvedBy: string | null;    // admin userId
    resolvedAt: FirebaseFirestore.Timestamp | null;
    tags: string[];               // e.g. ["payment_issue", "registration"]
}

export interface ChatbotMessage {
    id: string;
    sessionId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    module: ChatbotModule;
    timestamp: FirebaseFirestore.Timestamp;
    isEscalation: boolean;        // true if this message triggered escalation
}




