/**
 * Service Access Control
 * 
 * Middleware and utilities for checking user access to service-specific features
 */

import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
    ServiceName,
    ServiceAccessResult,
    UserWithServices,
    VerificationStatus
} from "@/types/service-registration";

/**
 * Get user data with service registrations
 */
export async function getUserWithServices(userId: string): Promise<UserWithServices | null> {
    try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            return null;
        }

        return userSnap.data() as UserWithServices;
    } catch (error) {
        console.error("Error fetching user data:", error);
        return null;
    }
}

/**
 * Check if user has access to a specific service
 */
export async function checkServiceAccess(
    userId: string,
    service: ServiceName
): Promise<ServiceAccessResult> {
    const user = await getUserWithServices(userId);

    if (!user) {
        return {
            hasAccess: false,
            redirectTo: "/auth/login",
            message: "Please log in to continue"
        };
    }

    switch (service) {
        case "export":
            return checkExportAccess(user);

        case "marketplace":
            return checkMarketplaceAccess(user);

        case "cooperative":
            return checkCooperativeAccess(user);

        case "wave":
            return checkWaveAccess(user);

        case "academy":
            return checkAcademyAccess(user);

        case "farmNation":
            return checkFarmNationAccess(user);

        default:
            return {
                hasAccess: false,
                message: "Unknown service"
            };
    }
}

/**
 * Export Windows Access Control
 */
function checkExportAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.export;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/export/onboarding",
            message: "Complete onboarding to access Export Windows"
        };
    }

    if (registration.status === "pending" || registration.status === "under_review") {
        return {
            hasAccess: false,
            redirectTo: "/export/onboarding/pending",
            message: "Your account is under review",
            registrationStatus: registration.status
        };
    }

    if (registration.status === "rejected") {
        return {
            hasAccess: false,
            redirectTo: "/export/onboarding/rejected",
            message: "Your application was not approved",
            registrationStatus: registration.status
        };
    }

    if (registration.status === "verified" && user.roles.includes("export_verified")) {
        return { hasAccess: true };
    }

    return {
        hasAccess: false,
        redirectTo: "/export/onboarding",
        message: "Complete verification to access Export Windows"
    };
}

/**
 * Marketplace Access Control
 */
function checkMarketplaceAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.marketplace;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/marketplace/onboarding",
            message: "Complete onboarding to access Marketplace"
        };
    }

    // Buyers have immediate access after onboarding
    if (registration.type === "buyer" && user.roles.includes("marketplace_buyer")) {
        return { hasAccess: true };
    }

    // Sellers need verification
    if (registration.type === "seller" || registration.type === "both") {
        if (registration.sellerStatus === "pending" || registration.sellerStatus === "under_review") {
            return {
                hasAccess: false,
                redirectTo: "/marketplace/onboarding/pending",
                message: "Your seller account is under review",
                registrationStatus: registration.sellerStatus
            };
        }

        if (registration.sellerStatus === "verified" && user.roles.includes("marketplace_seller")) {
            return { hasAccess: true };
        }
    }

    return {
        hasAccess: false,
        redirectTo: "/marketplace/onboarding",
        message: "Complete onboarding to access Marketplace"
    };
}

/**
 * Cooperative Access Control
 */
function checkCooperativeAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.cooperative;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/cooperatives/onboarding",
            message: "Join the cooperative to access features"
        };
    }

    if (registration.status === "pending") {
        return {
            hasAccess: false,
            redirectTo: "/cooperatives/onboarding/pending",
            message: "Complete your registration payment",
            registrationStatus: "pending"
        };
    }

    if (registration.status === "suspended") {
        return {
            hasAccess: false,
            redirectTo: "/cooperatives/suspended",
            message: "Your membership is suspended",
            registrationStatus: "rejected"
        };
    }

    if (registration.status === "active" && user.roles.includes("cooperative_member")) {
        return { hasAccess: true };
    }

    return {
        hasAccess: false,
        redirectTo: "/cooperatives/onboarding",
        message: "Complete onboarding to access Cooperative features"
    };
}

/**
 * WAVE Program Access Control
 */
function checkWaveAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.wave;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/wave/onboarding",
            message: "Apply to join the WAVE program"
        };
    }

    if (registration.status === "pending" || registration.status === "under_review") {
        return {
            hasAccess: false,
            redirectTo: "/wave/onboarding/pending",
            message: "Your application is under review",
            registrationStatus: registration.status
        };
    }

    if (registration.status === "rejected") {
        return {
            hasAccess: false,
            redirectTo: "/wave/onboarding/rejected",
            message: "Your application was not approved",
            registrationStatus: registration.status
        };
    }

    if (registration.status === "approved" && user.roles.includes("wave_member")) {
        return { hasAccess: true };
    }

    return {
        hasAccess: false,
        redirectTo: "/wave/onboarding",
        message: "Apply to join the WAVE program"
    };
}

/**
 * Academy Access Control
 */
function checkAcademyAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.academy;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/academy/onboarding",
            message: "Complete onboarding to access Academy"
        };
    }

    if (user.roles.includes("academy_student")) {
        return { hasAccess: true };
    }

    return {
        hasAccess: false,
        redirectTo: "/academy/onboarding",
        message: "Complete onboarding to access Academy"
    };
}

/**
 * Farm Nation Access Control
 */
function checkFarmNationAccess(user: UserWithServices): ServiceAccessResult {
    const registration = user.serviceRegistrations?.farmNation;

    if (!registration) {
        return {
            hasAccess: false,
            redirectTo: "/farm-nation/onboarding",
            message: "Complete onboarding to access Farm Nation"
        };
    }

    // Buyers have immediate access
    if (registration.type === "buyer" && user.roles.includes("farm_nation_buyer")) {
        return { hasAccess: true };
    }

    // Sellers need property verification
    if (registration.type === "seller" || registration.type === "both") {
        if (registration.verificationStatus === "pending" || registration.verificationStatus === "under_review") {
            return {
                hasAccess: false,
                redirectTo: "/farm-nation/onboarding/pending",
                message: "Your property listing is under verification",
                registrationStatus: registration.verificationStatus
            };
        }

        if (registration.verificationStatus === "verified" && user.roles.includes("farm_nation_seller")) {
            return { hasAccess: true };
        }
    }

    return {
        hasAccess: false,
        redirectTo: "/farm-nation/onboarding",
        message: "Complete onboarding to access Farm Nation"
    };
}

/**
 * Check if user has a specific role
 */
export function hasRole(user: UserWithServices, role: string): boolean {
    return user.roles?.includes(role as any) || false;
}

/**
 * Check if user is registered for a service
 */
export function isRegisteredForService(user: UserWithServices, service: ServiceName): boolean {
    return !!user.serviceRegistrations?.[service];
}

/**
 * Get registration status for a service
 */
export function getRegistrationStatus(
    user: UserWithServices,
    service: ServiceName
): VerificationStatus | null {
    const registration = user.serviceRegistrations?.[service];

    if (!registration) return null;

    // Return status based on service type
    if ("status" in registration) {
        return registration.status as VerificationStatus;
    }

    return null;
}
