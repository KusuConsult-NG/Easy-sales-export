/**
 * Firestore Database Collections Structure
 * 
 * This file documents the planned Firestore database schema
 * for the Easy Sales Export platform.
 */

export interface User {
    uid: string;
    fullName: string;
    email: string;
    phone?: string;
    gender?: "male" | "female" | "other";
    role: "member" | "exporter" | "admin" | "vendor" | "super_admin";
    verified: boolean;
    cooperativeId?: string;
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

/**
 * Firestore Collection Paths
 */
export const COLLECTIONS = {
    USERS: "users",
    EXPORT_WINDOWS: "exportWindows",
    NOTIFICATIONS: "notifications",
    COURSES: "courses",
    ENROLLMENTS: "enrollments",
    COOPERATIVES: "cooperatives",
    COOPERATIVE_MEMBERS: "cooperativeMembers",
    WAVE_APPLICATIONS: "waveApplications",
    WITHDRAWALS: "withdrawals",
    TRANSACTIONS: "transactions",
    ANALYTICS: "analytics",
    AUDIT_LOGS: "audit_logs",
    FEATURE_TOGGLES: "feature_toggles",
} as const;

