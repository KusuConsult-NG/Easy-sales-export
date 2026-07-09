/**
 * Firestore Database Collections Structure
 *
 * This file is the SINGLE IMPORT POINT for all platform types.
 * Domain types are progressively being extracted into dedicated files:
 *
 *   wave.ts        → WAVE program types
 *   academy.ts     → Academy LMS types
 *   export.ts      → Export Window & Investment types
 *   farm-nation.ts → Farm Nation / Land types
 *   shared.ts      → Cross-module / platform shared types
 *   cooperative.ts → Cooperative types (existing)
 *   marketplace.ts → Marketplace types (existing)
 *   roles.ts       → RBAC role types (existing)
 *
 * NDPR / SECURITY COMPLIANCE NOTE:
 * All PII (Personally Identifiable Information) including banking details,
 * names, and addresses stored within these collections are automatically
 * Encrypted At Rest using AES-256 by the Firebase/Google Cloud infrastructure.
 *
 * Phase 0 Migration: May 2026 — Domain Type Isolation
 */

// Export PRD-required interfaces
export * from "./prd-interfaces";

// Export role types
import type { UserRole, LegacyRole } from "./roles";
export type { UserRole, LegacyRole };
export { ROLE_LABELS, LEGACY_ROLE_MAP } from "./roles";

// ─── Domain Type Re-exports ────────────────────────────────────────────────
// These are progressively extracted domain types. The inline definitions below
// will be removed in Phase 1 once consumers migrate to domain-specific imports.
export type {
    WaveApplication,
    WaveCertificate,
    WaveShipment,
    WaveResource,
    WaveWithdrawal,
    WaveEarning,
    BriefingSubmission,
} from "./wave";

export type {
    Course,
    Enrollment,
    Certificate,
} from "./academy";

export type {
    ExportWindow,
    ExportOnboardingApplication,
    ExportInvestment,
    ExportSlot,
} from "./export";

export type {
    LandListing,
} from "./farm-nation";

export type {
    Notification,
    Payment,
    UnifiedTransaction,
    PlatformSettings,
    PasswordResetToken,
    Announcement,
    AuditLog,
} from "./shared";
// ──────────────────────────────────────────────────────────────────────────

// ─── Canonical Payment Status ─────────────────────────────────────────────
/**
 * Canonical payment status values used across all modules.
 * Use these constants everywhere instead of raw strings.
 */
export const PAYMENT_STATUS = {
    PENDING: 'pending',
    PAID: 'paid',
    COMPLETED: 'completed',
    FAILED: 'failed',
    UNPAID: 'unpaid',
    PROCESSING: 'processing',
} as const;

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

/**
 * Normalises any payment status variant to a canonical value.
 * Handles legacy 'successful' → 'completed', 'successful_payment' → 'completed' etc.
 */
export function normalisePaymentStatus(status: string | null | undefined): PaymentStatus {
    if (!status) return PAYMENT_STATUS.PENDING;
    const s = status.toLowerCase().trim();
    if (s === 'paid' || s === 'successful' || s === 'success') return PAYMENT_STATUS.PAID;
    if (s === 'completed' || s === 'successful_payment' || s === 'paid_completed') return PAYMENT_STATUS.COMPLETED;
    if (s === 'failed' || s === 'failure' || s === 'declined') return PAYMENT_STATUS.FAILED;
    if (s === 'pending' || s === 'pending_payment' || s === 'awaiting') return PAYMENT_STATUS.PENDING;
    if (s === 'processing') return PAYMENT_STATUS.PROCESSING;
    if (s === 'unpaid') return PAYMENT_STATUS.UNPAID;
    return PAYMENT_STATUS.PENDING;
}
// ──────────────────────────────────────────────────────────────────────────


export type { User } from "@easy-sales/types";

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
    _version?: number;
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
    membershipTier?: "Member" | string; // Unified single tier (legacy: "basic" | "premium" migrated)
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
    bvn?: string;
    nin?: string;
    ninVerified?: boolean;
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

// Import detailed types from marketplace module
import type {
    EscrowTransaction,
    Dispute
} from "./marketplace";
export type { EscrowTransaction, Dispute };

// Note: Notification, WaveApplication etc. are still defined here as they might not have a dedicated module type file yet.


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
    _version?: number;
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

// ============================================
// Wave Earnings
// ============================================

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
    MARKETPLACE_CARTS: "marketplace_carts",

    // Academy
    ACADEMY_APPLICATIONS: "academy_applications",
    ACADEMY_COURSES: "academy_courses",
    ACADEMY_ENROLLMENTS: "academy_enrollments",
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
    FARM_NATION_APPLICATIONS: "farm_nation_applications",
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
    MARKETPLACE_QUOTES: "marketplace_quotes",


    // Education & Training
    COURSES: "courses",
    ENROLLMENTS: "enrollments",
    ACADEMY_QUIZZES: "academy_quizzes",
    QUIZ_ATTEMPTS: "quiz_attempts",
    ACADEMY_LIVE_SESSIONS: "academy_live_sessions",
    COURSE_PROGRESS: "course_progress",
    COURSE_ENROLLMENTS: "course_enrollments",
    COURSE_CERTIFICATES: "course_certificates",
    CERTIFICATES: "certificates",
    ACADEMY_SETTINGS: "academy_settings",

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

    // Export Orders (orders placed by international buyers)
    EXPORT_ORDERS: "export_orders",

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
    startedAt: any;
    lastMessageAt: any;
    messageCount: number;
    escalated: boolean;           // true if user triggered support escalation
    resolved: boolean;            // admin marks resolved
    resolvedBy: string | null;    // admin userId
    resolvedAt: any | null;
    tags: string[];               // e.g. ["payment_issue", "registration"]
}

export interface ChatbotMessage {
    id: string;
    sessionId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    module: ChatbotModule;
    timestamp: any;
    isEscalation: boolean;        // true if this message triggered escalation
}




