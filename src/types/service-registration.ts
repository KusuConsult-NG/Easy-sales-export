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

/**
 * SERVICE ACCESS CONTROL SYSTEM - DUAL-TRACK DESIGN
 * ===================================================
 * 
 * The platform uses TWO parallel systems for access control:
 * 
 * ## Track 1: `roles` Array (Route-Level Access)
 * 
 * **Assigned**: During user registration (auth.ts:registerAction)
 * **Purpose**: 
 *   - NextAuth JWT token (client-side session)
 *   - Middleware route protection (middleware.ts)
 *   - Role-based app access (role-app-mapping.ts)
 * 
 * **Updated**: Admin approval actions
 * **Staleness**: Until re-login (30-day JWT expiry)
 * 
 * **Flow**:
 * 1. User registers → roles assigned immediately (e.g., `["general_user", "buyer"]`)
 * 2. Middleware checks `roles` to allow/deny route access
 * 3. JWT contains roles → used for client-side checks
 * 4. Roles change in Firestore → JWT remains stale until re-login
 * 
 * **Example Roles**:
 * - `general_user` - All registered users
 * - `buyer`, `seller` - Marketplace access
 * - `wave_participant` - WAVE program access
 * - `cooperative_member` - Cooperative features
 * 
 * ---
 * 
 * ## Track 2: `serviceRegistrations` Object (Feature-Level Access)
 * 
 * **Created**: During module-specific onboarding (e.g., /wave/application)
 * **Purpose**:
 *   - Approval workflow tracking
 *   - Granular feature access control
 *   - Status-based UI rendering
 * 
 * **Updated**: 
 *   - Admin approval actions
 *   - Redis cache invalidation (real-time)
 * 
 * **Staleness**: Cached with TTL, invalidated on updates
 * 
 * **Flow**:
 * 1. User completes onboarding → serviceRegistrations.wave created
 * 2. Admin approves → status changes from "pending" to "approved"
 * 3. Cache invalidated → next request fetches fresh data
 * 4. Middleware already allowed access (via roles), layout checks status
 * 
 * **Example Status Values**:
 * - `pending` - Awaiting admin review
 * - `approved` - Full access granted
 * - `rejected` - Access denied
 * - `under_review` - Admin actively reviewing
 * 
 * ---
 * 
 * ## IMPORTANT: Both Tracks Must Be Checked!
 * 
 * ✅ **Correct Pattern** (Module Layout):
 * ```typescript
 * const session = await auth();
 * if (!session?.user) redirect("/auth/login");
 * 
 * const access = await checkServiceAccess(session.user.id, "wave");
 * if (!access.hasAccess) redirect(access.redirectTo);
 * ```
 * 
 * ❌ **Incorrect** (Middleware Only):
 * ```typescript
 * // Only checks roles - allows access even if pending approval!
 * if (userRoles.includes("wave_participant")) return NextResponse.next();
 * ```
 * 
 * ---
 * 
 * ## Data Flow Diagram
 * 
 * ```
 * Registration → roles assigned → JWT created
 *      ↓              ↓              ↓
 *  Firestore     Middleware     Client Session
 * 
 * Onboarding → serviceRegistrations created → Cache
 *      ↓              ↓                         ↓
 *  Admin      service-access.ts          Redis TTL
 *  Approval        checks
 * ```
 * 
 * @see src/lib/auth/service-access.ts - Feature-level access checks
 * @see src/middleware.ts - Route-level protection
 * @see src/lib/role-app-mapping.ts - Role-to-app mapping
 */
export interface UserWithServices {
    uid: string;
    email: string;
    name: string;

    /**
     * Roles array - Assigned at registration, checked by middleware
     * Updated by admin actions, but JWT remains stale until re-login
     */
    roles: ServiceRole[];

    /**
     * Service registrations - Created during onboarding, tracks approval status
     * Updated by admin actions with cache invalidation (real-time)
     */
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
