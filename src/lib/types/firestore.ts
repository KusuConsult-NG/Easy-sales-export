/**
 * Firestore Database Collections Structure
 * 
 * This file documents the complete Firestore database schema
 * for the Easy Sales Export platform.
 */

// Export PRD-required interfaces
export * from "./prd-interfaces";

export interface User {
    uid: string;
    fullName: string;
    email: string;
    phone?: string;
    gender?: "male" | "female";
    role: "member" | "exporter" | "admin" | "vendor" | "super_admin";
    verified: boolean;
    cooperativeId?: string;
    cooperativeMembershipId?: string;
    sellerVerificationStatus?: "pending" | "approved" | "rejected";
    createdAt: Date;
    updatedAt: Date;
}

export interface ExportWindow {
    id: string;
    orderId: string;
    commodity: "yam" | "sesame" | "hibiscus" | "other";
    quantity: string;
    amount: number;
    status: "pending" | "in_transit" | "delivered" | "completed";
    userId: string;
    orderDate: Date;
    deliveryDate?: Date;
    escrowReleaseDate?: Date;
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
    status: "pending" | "approved" | "rejected" | "disbursed" | "completed";
    createdAt: Date;
    approvedAt?: Date;
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
    buyerId: string;
    sellerId: string;
    amount: number;
    status: "pending" | "funded" | "released" | "disputed";
    createdAt: Date;
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
    LAND_LISTINGS: "land_listings",
    LAND_VERIFICATIONS: "land_verifications",
    SELLER_VERIFICATIONS: "seller_verifications",
    ESCROW_TRANSACTIONS: "escrow_transactions",
    ESCROW_MESSAGES: "escrow_messages",
    DISPUTES: "disputes",

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

    // AI & Chat
    AI_CHAT_HISTORY: "ai_chat_history",
} as const;

