/**
 * Service Registration Types
 * 
 * Types and interfaces for service-specific user registrations
 */

import { Timestamp } from "firebase/firestore";

export type ServiceName =
    | "export"
    | "marketplace"
    | "cooperative"
    | "wave"
    | "academy"
    | "farmNation";

export type ServiceRole =
    | "export_verified"
    | "marketplace_buyer"
    | "marketplace_seller"
    | "seller_verified"
    | "cooperative_member"
    | "wave_applicant"
    | "wave_member"
    | "wave_participant"
    | "academy_participant"
    | "academy_student"
    | "farm_nation_buyer"
    | "farm_nation_seller"
    | "property_verified";

export type MembershipTier = "basic" | "premium" | "gold";

export type VerificationStatus = "pending" | "verified" | "rejected" | "under_review";

// Export Windows Registration
export interface ExportRegistration {
    status: VerificationStatus;
    registeredAt: Timestamp;
    verifiedAt?: Timestamp;
    kycStatus: "pending" | "submitted" | "verified" | "rejected";
    investmentProfile: {
        minInvestment: number;
        maxInvestment: number;
        investmentGoals: string[];
        riskTolerance: "low" | "medium" | "high";
    };
    documents: {
        bvn?: string;
        idType?: string;
        idNumber?: string;
        proofOfAddress?: string;
    };
    bankAccount?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
        verified: boolean;
    };
}

// Marketplace Registration
export interface MarketplaceRegistration {
    type: "buyer" | "seller" | "both";
    buyerStatus?: "active" | "suspended";
    sellerStatus?: VerificationStatus;
    registeredAt: Timestamp;

    // Buyer-specific
    buyerProfile?: {
        deliveryAddress?: string;
        phoneVerified: boolean;
        preferredPaymentMethod?: string;
    };

    // Seller-specific
    sellerProfile?: {
        businessName?: string;
        businessType?: "individual" | "registered" | "cooperative";
        cacNumber?: string;
        businessAddress?: string;
        phoneVerified: boolean;
        productCategories: string[];
        bankAccount?: {
            bankName: string;
            accountNumber: string;
            accountName: string;
            verified: boolean;
        };
    };
}

// Cooperative Registration
export interface CooperativeRegistration {
    membershipTier: MembershipTier;
    status: "active" | "suspended" | "pending";
    joinedAt: Timestamp;
    contributionStatus: "current" | "overdue" | "suspended";
    monthlyContribution: number;
    registrationFeePaid: boolean;
    documents: {
        passportPhoto?: string;
        validId?: string;
        proofOfAddress?: string;
    };
    nextOfKin?: {
        name: string;
        relationship: string;
        phone: string;
        address: string;
    };
}

// WAVE Program Registration
export interface WaveRegistration {
    status: "pending" | "approved" | "rejected" | "under_review";
    appliedAt: Timestamp;
    approvedAt?: Timestamp;
    rejectedAt?: Timestamp;
    fundingAmount: number;
    businessProposal: {
        businessIdea: string;
        fundingNeeded: number;
        timeline: string;
        businessPlanUrl?: string;
    };
    personalInfo: {
        education: string;
        workExperience: string;
        agriculturalExperience: string;
    };
    documents: {
        governmentId?: string;
        passportPhoto?: string;
        bvn?: string;
    };
    reviewNotes?: string;
    interviewScheduled?: boolean;
}

// Academy Registration
export interface AcademyRegistration {
    registeredAt: Timestamp;
    learnerProfile: {
        educationBackground: string;
        currentOccupation: string;
        learningGoals: string[];
        experienceLevel: "beginner" | "intermediate" | "advanced";
        preferredCategories: string[];
    };
    coursesEnrolled: string[];
    certificatesEarned: string[];
    paymentMethod?: {
        type: string;
        verified: boolean;
    };
}

// Farm Nation Registration
export interface FarmNationRegistration {
    type: "buyer" | "seller" | "both";
    verificationStatus?: VerificationStatus;
    registeredAt: Timestamp;

    // Buyer/Renter profile
    buyerProfile?: {
        purpose: "buy" | "lease" | "rent";
        budgetMin: number;
        budgetMax: number;
        preferredLocations: string[];
        propertyTypes: string[];
        phoneVerified: boolean;
    };

    // Seller/Landlord profile
    sellerProfile?: {
        businessName?: string;
        contactDetails: {
            phone: string;
            email: string;
            verified: boolean;
        };
        bankAccount?: {
            bankName: string;
            accountNumber: string;
            accountName: string;
            verified: boolean;
        };
        propertiesListed: string[];
        verificationType?: "pending" | "scheduled" | "completed";
    };
}

// Combined Service Registrations
export interface ServiceRegistrations {
    export?: ExportRegistration;
    marketplace?: MarketplaceRegistration;
    cooperative?: CooperativeRegistration;
    wave?: WaveRegistration;
    academy?: AcademyRegistration;
    farmNation?: FarmNationRegistration;
}

// User with Service Registrations
export interface UserWithServices {
    uid: string;
    email: string;
    name: string;
    roles: ServiceRole[];
    serviceRegistrations?: ServiceRegistrations;
}

// Onboarding Step
export interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    required: boolean;
}

// Service Access Check Result
export interface ServiceAccessResult {
    hasAccess: boolean;
    redirectTo?: string;
    message?: string;
    registrationStatus?: VerificationStatus;
}
