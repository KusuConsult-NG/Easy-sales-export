
import { FieldValue, Timestamp, GeoPoint } from "firebase-admin/firestore";

export enum AuditActionType {
    LAND_VERIFIED = 'land_verified',
    COURSE_ENROLLED = 'course_enrolled',
    COURSE_COMPLETED = 'course_completed',
    USER_UPDATE = 'user_update',
    EXPORT_WINDOW_CREATE = 'export_window_create',
    EXPORT_INVESTMENT = 'export_investment',
    MARKETPLACE_ORDER = 'marketplace_order',
    COOPERATIVE_REGISTRATION = 'cooperative_registration',
    SYSTEM_ERROR = 'system_error'
}

export { SoilQuality } from "@/lib/types/farm-nation";
export type { LandListing } from "@/lib/types/farm-nation";

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
export enum LoanStatus {
    PENDING = 'pending',
    REVIEWING = 'reviewing',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    DISBURSED = 'disbursed',
    REPAID = 'repaid',
    DEFAULTED = 'defaulted'
}

export enum LoanPurpose {
    SEEDS = 'seeds',
    FERTILIZER = 'fertilizer',
    EQUIPMENT = 'equipment',
    IRRIGATION = 'irrigation',
    LABOR = 'labor',
    PROCESSING = 'processing',
    MARKETING = 'marketing',
    EXPANSION = 'expansion',
    OTHER = 'other',
    AGRICULTURE = 'agriculture',
    LAND = 'land',
    WORKING_CAPITAL = 'working_capital'
}

export interface LoanApplication {
    id: string;
    userId: string;
    amount: number;
    purpose: LoanPurpose;
    duration: number; // in months
    repaymentPeriod: number;
    interestRate: number;
    status: LoanStatus;
    guarantors?: string[];
    collateral?: {
        type: string;
        value: number;
        description: string;
    };
    creditScore?: number;
    businessDetails?: {
        name: string;
        type: string;
        yearsInOperation: number;
        annualRevenue: number;
    };
    repaymentSchedule?: {
        dueDate: Date;
        amount: number;
        status: 'pending' | 'paid' | 'overdue';
    }[];
    approvedBy?: string;
    approvedAt?: Date;
    rejectedReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface AuditLog {
    id: string;
    userId: string;
    action: string;
    targetId?: string;
    targetType?: string;
    details?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}
