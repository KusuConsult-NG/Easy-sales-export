/**
 * Firestore Database Collections Structure
 * 
 * This file documents the complete Firestore database schema
 * for the Easy Sales Export platform.
 */

// Export PRD-required interfaces
export * from "./prd-interfaces";

// Export role types
import type { UserRole, LegacyRole } from "./roles";
export type { UserRole, LegacyRole };
export { ROLE_LABELS, LEGACY_ROLE_MAP } from "./roles";

export interface User {
    uid: string;
    fullName: string;
    email: string;
    phone?: string;
    gender?: "male" | "female"; // Required for WAVE participant validation
    roles: UserRole[]; // Multi-role support (changed from single role)
    verified: boolean;

    // Cooperative
    cooperativeId?: string;
    cooperativeMembershipId?: string;
    cooperativeTier?: "tier1" | "tier2"; // ₦10K or ₦20K
    cooperativeRegistrationFee?: number;

    // Seller Verification (Enhanced)
    sellerVerificationStatus?: "pending" | "approved" | "rejected" | "suspended";
    sellerVerificationId?: string; // Reference to seller_verifications collection
    sellerPhoneVerified?: boolean;

    // Bank Details (for sellers and cooperative members)
    bankDetails?: {
        accountNumber: string;
        bankName: string;
        accountName: string;
        bankCode: string;
    };

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
    type: "escrow" | "order" | "academy";
    title: string;
    message: string;
    link?: string;
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
    cooperativeId: string;
    userId: string;
    savingsBalance: number;
    loanBalance: number;
    joinedAt: Date;
}

export interface LoanApplication {
    id: string;
    userId: string;
    amount: number;
    purpose: string;
    status: "pending" | "approved" | "rejected" | "disbursed" | "repaid" | "completed";
    createdAt: Date;
    updatedAt?: Date;
    approvedAt?: Date;
    disbursedAt?: Date;
    repaidAt?: Date;

    // Financials
    interestRate?: number;
    durationMonths?: number;
    monthlyPayment?: number;
    totalRepayment?: number;
    contributionAmount?: number;
    tier?: string;
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

export interface EscrowTransaction {
    id: string;
    orderId: string; // Link to the master order
    buyerId: string;
    sellerId: string;
    amount: number;
    status: "pending" | "funded" | "released" | "disputed" | "refunded";
    createdAt: Date;
    releasedAt?: Date;
}

export interface Dispute {
    id: string;
    escrowId: string;
    raisedBy: string;
    reason: string;
    status: "open" | "resolved" | "closed";
    createdAt: Date;
}

export interface WaveApplication {
    id: string;
    userId: string;
    gender: "female";
    status: "pending" | "approved" | "rejected";
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
    details: string;
    timestamp: Date;
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

    // Export & Agriculture
    EXPORT_WINDOWS: "export_windows",
    EXPORT_SLOTS: "export_slots",

    // Cooperatives & Finance
    COOPERATIVES: "cooperatives",
    COOPERATIVE_MEMBERS: "cooperative_members",
    COOPERATIVE_TRANSACTIONS: "cooperative_transactions",
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
    MARKETPLACE_ORDERS: "marketplace_orders",
    LAND_LISTINGS: "land_listings",
    LAND_VERIFICATIONS: "land_verifications",
    SELLER_VERIFICATIONS: "seller_verifications",
    ESCROW_TRANSACTIONS: "escrow_transactions",
    ESCROW_MESSAGES: "escrow_messages",
    DISPUTES: "disputes",

    // Farm Nation
    FARM_NATION_PROPERTIES: "farm_nation_properties",
    FARM_NATION_TRANSACTIONS: "farm_nation_transactions",

    // NEW: Marketplace Enhancement
    PRODUCT_IMAGES: "product_images",
    SHOPPING_CARTS: "shopping_carts",
    ORDERS: "orders",
    MESSAGES: "messages",
    CONVERSATIONS: "conversations",
    PRODUCT_REVIEWS: "product_reviews",
    REVIEWS: "product_reviews", // Alias for PRODUCT_REVIEWS


    // Education & Training
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

    // AI & Chat
    AI_CHAT_HISTORY: "ai_chat_history",
} as const;
