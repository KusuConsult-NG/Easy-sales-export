// ============================================
// STRICT TYPESCRIPT TYPES - NO ANY ALLOWED
// ============================================

// User Roles Enum
export enum UserRole {
    USER = 'user',
    VENDOR = 'vendor',
    ADMIN = 'admin',
    SUPER_ADMIN = 'super_admin',
    COOPERATIVE_MEMBER = 'cooperative_member',
    SELLER = 'seller',
    STUDENT = 'student'
}

// User Interface
export interface User {
    id: string;
    email: string;
    displayName: string | null;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
    isVerified: boolean;
    onboardingComplete: boolean;
    metadata?: {
        lastLoginIP?: string;
        loginCount?: number;
        lastLoginAt?: Date;
    };
}

// Escrow System Types
export enum EscrowStatus {
    PENDING = 'PENDING',
    HELD = 'HELD',
    DISPUTED = 'DISPUTED',
    RELEASED = 'RELEASED',
    CANCELLED = 'CANCELLED'
}

export interface Transaction {
    id: string;
    buyerId: string;
    sellerId: string;
    productId: string;
    amount: number;
    status: EscrowStatus;
    createdAt: Date;
    updatedAt: Date;
    heldAt: Date | null;
    releasedAt: Date | null;
    disputeReason?: string;
    disputedAt?: Date;
    metadata?: {
        paymentMethod?: string;
        deliveryConfirmed?: boolean;
        releaseApprovedBy?: string;
    };
}

// Course/LMS Types
export interface Course {
    id: string;
    title: string;
    description: string;
    videoUrl: string;
    thumbnailUrl?: string;
    duration: number; // in seconds
    instructor: string;
    instructorId: string;
    enrolledStudents: number;
    published: boolean;
    category: string;
    level: 'beginner' | 'intermediate' | 'advanced';
    createdAt: Date;
    updatedAt: Date;
}

export interface CourseProgress {
    id: string;
    userId: string;
    courseId: string;
    progressPercent: number;
    lastWatchedSecond: number;
    completed: boolean;
    completedAt: Date | null;
    updatedAt: Date;
}

// Land Listing Types
export enum SoilQuality {
    EXCELLENT = 'excellent',
    GOOD = 'good',
    FAIR = 'fair',
    POOR = 'poor'
}

export interface LandListing {
    id: string;
    title: string;
    description: string;
    location: {
        lat: number;
        lng: number;
        address: string;
        city: string;
        state: string;
    };
    acreage: number;
    soilQuality: SoilQuality;
    price: number;
    ownerId: string;
    status: 'pending_verification' | 'verified' | 'rejected';
    images: string[];
    features?: string[];
    waterAccess: boolean;
    electricityAccess: boolean;
    roadAccess: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// Loan Application Types
export enum LoanPurpose {
    AGRICULTURE = 'agriculture',
    EQUIPMENT = 'equipment',
    LAND = 'land',
    WORKING_CAPITAL = 'working_capital',
    OTHER = 'other'
}

export enum LoanStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    DISBURSED = 'disbursed',
    REPAID = 'repaid',
    DEFAULTED = 'defaulted'
}

export interface LoanApplication {
    id: string;
    userId: string;
    amount: number;
    purpose: LoanPurpose;
    repaymentPeriod: number; // in months
    status: LoanStatus;
    collateral: {
        type: string;
        value: number;
        description: string;
    };
    businessDetails: {
        name: string;
        type: string;
        yearsInOperation: number;
        annualRevenue: number;
    };
    documents: Array<{
        name: string;
        url: string;
        type: 'id' | 'business_reg' | 'financial_statement' | 'other';
    }>;
    approvedBy?: string;
    approvedAt?: Date;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Audit Log Types
export enum AuditActionType {
    // Auth actions
    USER_LOGIN = 'user_login',
    USER_LOGOUT = 'user_logout',
    USER_REGISTER = 'user_register',

    // Escrow actions
    ESCROW_CREATE = 'escrow_create',
    ESCROW_HOLD = 'escrow_hold',
    ESCROW_RELEASE = 'escrow_release',
    ESCROW_DISPUTE = 'escrow_dispute',

    // Admin actions
    USER_VERIFY = 'user_verify',
    USER_UNVERIFY = 'user_unverify',
    LOAN_APPROVE = 'loan_approve',
    LOAN_REJECT = 'loan_reject',
    LAND_VERIFY = 'land_verify',
    CONTENT_APPROVE = 'content_approve',

    // Content actions
    PRODUCT_CREATE = 'product_create',
    PRODUCT_UPDATE = 'product_update',
    PRODUCT_DELETE = 'product_delete',

    // Course actions
    COURSE_ENROLL = 'course_enroll',
    COURSE_COMPLETE = 'course_complete',

    // System actions
    SYSTEM_ERROR = 'system_error',
    SECURITY_ALERT = 'security_alert'
}

export interface AuditLog {
    id: string;
    userId: string;
    actionType: AuditActionType;
    resourceId?: string;
    resourceType?: string;
    metadata: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    immutable: true; // Prevents any modifications
}

// API Response Types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

// Form State Types
export interface FormState<T = unknown> {
    data: T;
    errors: Record<string, string>;
    isSubmitting: boolean;
    isValid: boolean;
}
