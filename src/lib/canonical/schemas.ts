
/**
 * CANONICAL DATA SCHEMAS
 * 
 * This file defines the platform-wide SINGLE SOURCE OF TRUTH (SSOT).
 * All modules must normalize their data to these structures.
 */

export interface CanonicalIdentity {
    uid: string;
    email: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    gender?: "male" | "female" | "other";
    dateOfBirth?: string;
    roles: string[];
    isVerified: boolean;
    onboardingCompleted: boolean;
}

export interface CanonicalBankDetails {
    bankName: string;
    accountNumber: string;
    accountName: string;
    bankCode?: string;
}

export interface CanonicalAddress {
    street: string;
    city: string;
    state: string;
    lga: string;
    country: string;
}

export interface CanonicalVerificationProfile {
    status: "pending" | "approved" | "rejected" | "suspended" | "not_started";
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
    documents: Record<string, { url: string; name: string }>;
    bankDetails?: CanonicalBankDetails;
    businessInfo?: {
        name: string;
        type: string;
        regNumber?: string;
    };
    isCanonical: boolean;
    schemaVersion: number;
}

export interface CanonicalServiceRegistrations {
    marketplace?: { status: string; approvedAt?: Date };
    cooperative?: { status: string; tier?: string; approvedAt?: Date };
    wave?: { status: string; approvedAt?: Date };
    academy?: { status: string; plan?: string; approvedAt?: Date };
    export?: { status: string; approvedAt?: Date };
    farmNation?: { status: string; approvedAt?: Date };
}

export interface CanonicalUserProfile extends CanonicalIdentity {
    address: CanonicalAddress;
    bankDetails: CanonicalBankDetails;
    nin?: string;
    bvn?: string;
    verificationProfile?: CanonicalVerificationProfile;
    serviceRegistrations: CanonicalServiceRegistrations;
    createdAt: Date;
    updatedAt: Date;
    schemaVersion: number;
}

export const LATEST_SCHEMA_VERSION = 8; // Incrementing for this major refactor
