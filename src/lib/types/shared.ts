/**
 * Shared / Platform-wide Types
 *
 * These types are used across multiple modules and don't belong to a single domain.
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

import type { UserRole } from "./roles";

export interface Notification {
    id: string;
    userId: string;
    type: "escrow" | "order" | "academy" | "wave" | "cooperative" | "export"
        | "payment" | "loan" | "system" | "event" | "payout"
        | "info" | "warning" | "success" | "farm_nation" | "marketplace" | "general"
        | "transaction" | "error" | "withdrawal" | "land" | "dispute";
    title: string;
    message: string;
    link?: string;
    linkText?: string; // CTA button label e.g. "View Loans"
    read: boolean;
    createdAt: Date;
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

export interface UnifiedTransaction {
    id: string;
    userId: string;
    type: string;
    module: "wave" | "cooperative" | "marketplace" | "farm_nation" | "export" | "academy" | "general" | "wallet";
    amount: number;
    currency: string;
    status: "pending" | "completed" | "failed" | "refunded";
    date: Date;
    reference?: string;
    description?: string;
    metadata?: Record<string, unknown>;
}

export interface PlatformSettings {
    platformName: string;
    supportEmail: string;
    contactPhone: string;
    defaultCurrency: "NGN" | "USD" | "GBP";
    maintenanceMode: boolean;
    updatedBy?: string;
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
    entityId?: string;
    entityType?: string;
    targetId?: string;
    targetType?: string;
    details?: string;
    metadata?: Record<string, any>;
    adminId?: string;
    severity?: "info" | "warning" | "critical";
    userEmail?: string;
    userRole?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    createdAt?: Date;
}

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
            accountType?: "learner" | "instructor" | "admin";
            onboardingCompleted?: boolean;
        };
    };

    createdAt: Date;
    updatedAt: Date;
    _version?: number;
}

