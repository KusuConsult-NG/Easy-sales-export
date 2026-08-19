/**
 * Easy Sales Export Platform — Canonical Type Definitions
 *
 * This is the single source of truth for all application types.
 * Aligned with Firestore schema in src/lib/types/firestore.ts
 * Last updated: 2026-02-24
 */

// Re-export canonical Firestore types for backward compatibility
export type { UserRole, LegacyRole } from "@/lib/types/roles";
export { ROLE_LABELS, LEGACY_ROLE_MAP } from "@/lib/types/roles";
export { COLLECTIONS } from "@/lib/types/firestore";

// ===========================
// User & Authentication Types
// ===========================

export interface User {
    // Core identity
    id?: string;        // Auth UID (client-side)
    uid?: string;       // Firestore UID (server-side)
    email: string;
    originalEmail?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    phoneNumber?: string;
    phone?: string;
    gender?: "male" | "female";
    profileImage?: string;

    // Roles (multi-role array — platform standard)
    roles: import("@/lib/types/roles").UserRole[] | string[];
    /** @deprecated Use `roles` array instead */
    role?: string;

    // Membership
    membershipTier?: "Member";
    cooperativeTier?: "tier1" | "tier2";
    memberSince?: Date | any;
    isActive?: boolean;
    isVerified?: boolean;
    verified?: boolean;
    verifiedBy?: string;
    verifiedAt?: Date | any;
    onboardingCompleted?: boolean;
    profileComplete?: boolean;

    // Cooperative
    cooperativeId?: string;
    cooperativeMembershipId?: string;
    cooperativeRegistrationFee?: number;

    // Seller
    sellerVerificationStatus?: "pending" | "approved" | "rejected" | "suspended";
    sellerVerificationId?: string;
    sellerPhoneVerified?: boolean;

    // KYC / Identity Verification
    bvn?: string;
    bvnVerified?: boolean;
    idType?: string;
    idNumber?: string;
    idVerified?: boolean;

    // KYB / Business Verification
    taxId?: string;
    tinVerified?: boolean;
    cacNumber?: string;
    companyName?: string;
    cacVerified?: boolean;

    // Bank Details
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
        street?: string;
        city?: string;
        state?: string;
        lga?: string;
        country?: string;
    };

    otherName?: string;

    // Location (flattened form)
    location?: string;
    bio?: string;

    // MFA
    mfaEnabled?: boolean;
    totpSecret?: string;
    mfaRecoveryCodes?: string[];

    // NDPR / GDPR
    consentVersion?: string;
    consentDate?: Date | any;
    marketingOptIn?: boolean;

    // Notification preferences
    notifications?: {
        email?: boolean;
        push?: boolean;
        sms?: boolean;
    };

    // Service registrations — tracks enrollment status per sub-platform
    serviceRegistrations?: {
        wave?: {
            status: "pending" | "under_review" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date | any;
            approvedAt?: Date | any;
            rejectionReason?: string;
        };
        cooperative?: {
            status: "pending" | "paid" | "approved" | "rejected";
            tier?: "tier1" | "tier2";
            applicationId?: string;
            paymentReference?: string;
            submittedAt?: Date | any;
        };
        farmNation?: {
            status: "pending" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date | any;
        };
        export?: {
            status: "pending" | "approved" | "rejected";
            applicationId?: string;
            submittedAt?: Date | any;
        };
        academy?: {
            status: "active" | "suspended";
            enrolledAt?: Date | any;
        };
    };

    // Soft-delete / NDPR
    deleted?: boolean;
    deletedAt?: Date | any;
    deletedBy?: string;
    deletionReason?: string;
    suspended?: boolean;

    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface AuthSession {
    user: User;
    accessToken: string;
    refreshToken?: string;
}

// ===========================
// Export Window Types
// ===========================

export type CommodityType = "Yam Tubers" | "Sesame Seeds" | "Dried Hibiscus" | "yam" | "sesame" | "hibiscus" | "other";

export interface ExportWindow {
    id: string;
    /**
     * Which of the two entities export_windows holds.
     *
     * "shipment" is a private export request (orderId, quantity, userId,
     * pending → in_transit → delivered → completed). "aggregation" is a
     * crowdfunded opportunity (targetVolume, slotPrice, currentVolume, open).
     * Optional because rows written before this existed carry no value —
     * exportWindowKind() infers those from the fields that always told them
     * apart. See lib/export-window-status.ts.
     */
    windowKind?: "shipment" | "aggregation";
    /** What an aggregation window is raising: targetVolume x slotPrice. */
    fundingGoal?: number;
    title?: string;
    commodity: CommodityType;
    phase?: string;
    description?: string;
    destination?: string;

    // Funding
    roi?: string;
    roiPercent?: number;
    investmentCap?: number;  // Maximum total investment allowed
    totalInvested?: number;  // Total currently invested
    fundingProgress?: number; // 0-100 percentage
    minInvestment?: number;
    maxInvestment?: number;
    targetAmount?: number;
    currentAmount?: number;
    fundedAmount?: number;

    // Capacity
    totalSpots?: number;
    spotsFilled?: number;
    daysRemaining?: number;

    // Dates
    startDate?: Date | any;
    endDate?: Date | any;
    deadline?: Date | any;
    deliveryDate?: Date | any;

    // Status
    status: "pending" | "open" | "active" | "funded" | "in_progress" | "in_transit" | "delivered" | "completed" | "closed";
    isActive?: boolean;

    // Rich data
    specifications?: string[];
    benefits?: string[];
    documents?: { name: string; url?: string; required: boolean }[];
    timeline?: { phase: string; date: string; description: string; status: "pending" | "active" | "completed" }[];

    // Media
    imageUrl?: string;
    image?: string;
    quantity?: string;
    amount?: number;
    duration?: string;
    orderId?: string;

    userId?: string;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface UserExportParticipation {
    id: string;
    exportWindowId: string;
    userId: string;
    amountInvested: number;
    participationDate: Date | any;
    status: "pending" | "active" | "completed" | "disputed";
    expectedReturn: number;
    actualReturn?: number;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface ExportInvestment {
    id: string;
    userId: string;
    windowId: string;
    amount: number;
    status: "pending" | "active" | "completed" | "cancelled";
    roi?: string;
    roiAmount?: number;
    investedAt?: Date | any;
    completedAt?: Date | any;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Marketplace Types
// ===========================

export interface Product {
    id: string;
    name: string;
    description: string;
    commodity?: CommodityType;
    category?: string;
    price: number;
    unit?: "kg" | "ton" | "bag" | "per ton" | string;
    minOrder?: number;
    maxOrder?: number;
    quantity?: number;
    imageUrl?: string;
    images?: string[];
    inStock?: boolean;
    status?: "available" | "out_of_stock" | "draft" | "pending" | "rejected";
    isActive?: boolean;
    isVerified?: boolean;

    // Seller info
    sellerId?: string;
    farmerId?: string;
    farmerName?: string;
    sellerName?: string;

    // Location
    location?: { state: string; lga?: string; address?: string; nearestMarket?: string };

    quality?: "Standard" | "Premium" | "Organic";
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface Order {
    id: string;
    userId: string;
    buyerId?: string;
    buyerName?: string;
    productId: string;
    sellerId?: string;
    quantity: number;
    totalAmount: number;
    status: "pending" | "escrow" | "shipped" | "delivered" | "completed" | "disputed" | "cancelled";
    reason?: string;   // Dispute reason
    amount?: number;   // Escrow amount
    createdAt?: Date | any;
    updatedAt?: Date | any;
    escrowReleaseDate?: Date | any;
    trackingNumber?: string;
}

// ===========================
// Dispute Types
// ===========================

export interface Dispute {
    id: string;
    orderId?: string;
    exportWindowId?: string;

    // Parties
    complainantId?: string;
    respondentId?: string;
    buyerId?: string;
    buyerName?: string;
    buyerEmail?: string;
    sellerId?: string;
    sellerName?: string;
    sellerEmail?: string;

    type?: "order" | "export" | "payment" | "other";
    reason?: string;
    subject?: string;
    description?: string;
    adminNotes?: string;

    // Financials
    amount?: number;

    /**
     * Whether the escrow behind this dispute was frozen when it was filed.
     *
     * Filing a dispute has to take the escrow off `funded`, or the auto-release
     * cron pays the seller while the dispute is open — which is what happened to
     * every dispute raised from /dashboard/disputes/new, because that path
     * claimed only the ORDER. Recorded on the dispute so an admin can see, before
     * choosing a resolution, whether there is money left to move.
     */
    escrowFrozen?: boolean;

    /**
     * Set when the escrow had already been released or refunded before the
     * dispute was filed. A refund resolution cannot be executed against it, and
     * the admin should not discover that only when the refund fails.
     */
    escrowAlreadySettled?: string | null;

    status: "open" | "awaiting_evidence" | "under_review" | "investigating" | "resolved" | "closed";
    priority?: "low" | "medium" | "high" | "urgent";

    // Timeline events
    timeline?: {
        event: string;
        timestamp: Date | any;
        description?: string;
    }[];

    resolution?: string;
    resolvedAt?: Date | any;
    assignedTo?: string;

    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Cooperative Types
// ===========================

export interface CooperativeMember {
    id: string;
    userId: string;
    cooperativeId?: string;
    membershipNumber?: string;
    joinDate?: Date | any;
    joinedAt?: Date | any;
    tier?: "Basic" | "Premium" | "Gold" | "tier1" | "tier2";
    totalSavings?: number;
    savingsBalance?: number;
    totalExports?: number;
    totalRevenue?: number;
    loanBalance?: number;
    contributionAmount?: number;  // Total lifetime contributions (for loan eligibility)
    totalContributions?: number;  // Alias used in some dashboard actions
    status?: "active" | "inactive" | "suspended";
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface Transaction {
    id: string;
    userId: string;
    type: "deposit" | "withdrawal" | "export_profit" | "fee" | "loan_repayment" | "savings";
    amount: number;
    description?: string;
    status: "pending" | "completed" | "failed";
    date?: Date | any;
    reference?: string;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// WAVE Program Types
// ===========================

export interface WAVEApplication {
    id: string;
    userId: string;
    fullName?: string;
    phone?: string;
    gender?: "female" | "male";
    businessName?: string;
    businessType?: string;
    farmingExperience?: string;
    landSize?: string;
    commodityInterest?: string[];
    businessPlan?: string;
    yearsInOperation?: number;
    annualRevenue?: number;
    fundingNeeded?: number;
    purpose?: string;
    status: "draft" | "pending" | "submitted" | "under_review" | "approved" | "rejected";
    submittedAt?: Date | any;
    reviewedAt?: Date | any;
    reviewNotes?: string;
    createdAt?: Date | any;
    updatedAt?: Date | any;
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
    uploadedAt?: Date | any;
    downloadCount?: number;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Farm Nation Types
// ===========================

export interface LandListing {
    id: string;
    title: string;
    description?: string;
    location: {
        state: string;
        lga?: string;
        address?: string;
    };
    size?: number | string;
    sizeInAcres?: number;
    price: number;
    pricePerHectare?: number;
    pricePerAcre?: number;
    totalPrice?: number;
    category?: string;
    soilType?: string;
    soilQuality?: string;
    waterSource?: string;
    waterAccess?: boolean;
    electricity?: boolean;
    roadAccess?: boolean;
    accessibility?: string;
    images?: string[];
    documents?: any;
    ownerId: string;
    ownerName?: string;
    ownerEmail?: string;
    status: "available" | "reserved" | "sold" | "draft" | "pending_verification" | "verified" | "rejected" | "deleted";
    verificationStatus?: string;
    verified?: boolean;
    listedDate?: Date | any;
    verifiedAt?: Date | null;
    verifiedBy?: string | null;
    rejectionReason?: string | null;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Academy / Courses
// ===========================

export interface Course {
    id: string;
    title: string;
    description: string;
    instructor: string;
    duration: string;
    /**
     * The course's modules, each carrying its own lessons.
     *
     * THIS SAID `modules?: number`, AND EVERY CONSUMER TREATS IT AS AN ARRAY.
     * src/lib/types/academy-actions.ts declares a second Course with
     * `modules: CourseModule[]`, and that is the one the code follows:
     * academy/[courseId]/page.tsx does `course.modules.reduce(...)` and
     * `.map(...)` at render, the lesson page indexes into it, and
     * _ac_progress.ts counts its lessons.
     *
     * A count is not a list, and the mismatch is not academic — seeding a
     * course with `modules: 3`, exactly as this type instructed, made the
     * course detail page throw "reduce is not a function" and render nothing.
     * Two Course types disagreeing is the same duplicate-definition drift that
     * has produced defects elsewhere in this codebase; the array shape wins
     * because it is what actually runs.
     *
     * Typed structurally rather than by importing CourseModule to avoid a
     * dependency from this shared module into the academy-specific one.
     */
    modules?: Array<{
        id: string;
        title: string;
        description?: string;
        lessons: Array<{ id: string; title: string; duration?: string; content?: string }>;
        [key: string]: any;
    }>;
    price: number;
    currency?: "NGN" | "USD";
    imageUrl?: string;
    thumbnail?: string;
    category?: "export" | "farming" | "business" | "compliance" | string;
    level: "beginner" | "intermediate" | "advanced";
    enrollmentCount?: number;
    enrolledCount?: number;
    rating?: number;
    status?: "upcoming" | "open" | "in_progress" | "completed";
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

export interface Enrollment {
    id: string;
    userId: string;
    courseId: string;
    enrollmentDate?: Date | any;
    enrolledAt?: Date | any;
    progress: number;
    completedModules?: number;
    totalModules?: number;
    completed?: boolean;
    status?: "active" | "completed" | "dropped";
    certificateUrl?: string;
    completedAt?: Date | any;
    paymentStatus?: "pending" | "paid" | "free";
    paymentReference?: string;
    amount?: number;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Vendor Types
// ===========================

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
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Loan Types
// ===========================

export interface LoanApplication {
    id: string;
    userId: string;
    userEmail?: string; // Used by approval email
    fullName?: string;  // Written by submitLoanApplicationAction
    amount: number;
    purpose: string;
    status: "pending" | "partially_approved" | "approved" | "rejected" | "disbursed" | "repaid" | "completed";
    interestRate?: number;
    durationMonths?: number;
    monthlyPayment?: number;
    totalRepayment?: number;
    contributionAmount?: number;
    tier?: string;
    createdAt?: Date | any;
    updatedAt?: Date | any;
    approvedAt?: Date | any;
    disbursedAt?: Date | any;
    repaidAt?: Date | any;
    appliedAt?: Date | any;  // Alias for createdAt used in loans.ts
    documents?: string[];    // Supporting document URLs

    // Maker-Checker approval chain (loans ≥ ₦1M require two admins)
    approvalChain?: {
        firstApprover?: string;
        firstApprovalAt?: Date | any;
        firstApproverName?: string;
        secondApprover?: string;
        secondApprovalAt?: Date | any;
        secondApproverName?: string;
    };

    // Disbursement tracking
    disbursed?: boolean;
    disbursementTransferCode?: string;
    pendingManualDisbursement?: boolean;
    disbursementError?: string;
    disbursementNote?: string;

    // Review
    reviewedBy?: string;
    reviewedAt?: Date | any;
    rejectionReason?: string;
}

// ===========================
// Notifications
// ===========================

export type NotificationType =
    | "escrow" | "order" | "academy"
    | "wave" | "cooperative" | "export" | "payment"
    | "loan" | "system" | "event" | "payout"
    | "info" | "warning" | "success"
    | "farm_nation" | "marketplace" | "general";

export interface Notification {
    id: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    linkText?: string; // CTA button label e.g. "View Dashboard"
    read: boolean;
    createdAt?: Date | any;
}

// ===========================
// Announcements
// ===========================

export interface Announcement {
    id: string;
    title: string;
    message: string;
    type: "info" | "warning" | "success";
    targetRoles?: string[];
    createdAt?: Date | any;
}

// ===========================
// Audit & Admin
// ===========================

export interface AuditLog {
    id: string;
    userId: string;
    action: string;
    details?: string;
    metadata?: Record<string, any>;
    // Field names used by logAuditAction
    entityId?: string;
    entityType?: string;
    adminId?: string;
    // Field names used by createAdminAuditLog (audit-log-admin.ts)
    targetId?: string;
    targetType?: string;
    severity?: "info" | "warning" | "critical";
    userEmail?: string;
    userRole?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp?: Date | any;
    createdAt?: Date | any;
}

// ===========================
// Wave Earnings
// ===========================

export interface WaveEarning {
    id: string;
    userId: string;
    memberId?: string;
    amount: number;
    type: "training_bonus" | "referral" | "sales_commission" | "other";
    description?: string;
    status: "pending" | "approved" | "paid" | "rejected";
    approvedBy?: string;
    approvedAt?: Date | any;
    paidAt?: Date | any;
    paystackTransferCode?: string;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Loan Payments & Repayments
// ===========================

export interface LoanPayment {
    id: string;
    loanId: string;
    installmentId: string;
    userId: string;
    amount: number;
    paymentReference: string;
    penaltyPaid?: number;
    paidAt?: Date | any;
    createdAt?: Date | any;
}

export interface RepaymentInstallment {
    id?: string;
    loanId: string;
    userId: string;
    installmentNumber: number;
    dueDate: Date | any;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
    paidAt?: Date | any;
    penaltyAmount?: number;
    daysOverdue?: number;
}

export interface Payment {
    id: string;
    userId: string;
    amount: number;
    type: string;
    status: "pending" | "completed" | "failed";
    reference: string;
    paystackRef?: string;
    channel?: string;
    currency?: string;
    metadata?: Record<string, any>;
    createdAt?: Date | any;
    updatedAt?: Date | any;
}

// ===========================
// Dashboard Stats Types
// ===========================

export interface DashboardStats {
    totalExports: number;
    totalRevenue: number;
    activeWindows: number;
    pendingOrders: number;
    savings: number;
    roi: string;
}

// ===========================
// Escrow / Messages
// ===========================

export interface DisputeMessage {
    id: string;
    disputeId: string;
    senderId: string;
    message: string;
    attachments?: string[];
    timestamp?: Date | any;
}
