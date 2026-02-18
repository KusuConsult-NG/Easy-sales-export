"use server";

import { signIn, signOut } from "@/lib/auth";
import { db, adminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { registerSchema, loginSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { User as FirestoreUser } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { LEGACY_ROLE_MAP, type LegacyRole, type UserRole } from "@/lib/types/roles";
import { getPrimaryApp } from "@/lib/role-app-mapping";
import { ZodError } from "zod";

/**
 * Server Actions for Authentication
 * 
 * These actions handle user login, registration, and logout
 * with Firebase and NextAuth v5 integration.
 */

/**
 * Determine where to redirect user after registration based on their selected platforms
 * Users must complete module-specific onboarding before accessing dashboards
 * 
 * CRITICAL: Prioritize the user's SELECTED platform over auto-assigned roles
 * Example: Female user selects Cooperative → Should go to /cooperatives/onboarding
 *          NOT /wave/application (even though wave_participant was auto-assigned)
 */
function determinePostRegistrationRedirect(platforms: string[], roles: UserRole[]): string {
    // PRIORITY 1: Check user's SELECTED platforms first (single platform registration)
    if (platforms.length === 1) {
        const platform = platforms[0];

        if (platform === 'marketplace') return '/marketplace/onboarding';
        if (platform === 'export') return '/export/onboarding';
        if (platform === 'cooperatives') return '/cooperatives/onboarding';
        if (platform === 'farm-nation') return '/farm-nation/onboarding';
        if (platform === 'academy') return '/academy/setup';
        if (platform === 'wave') return '/wave/application';
    }

    // PRIORITY 2: For multi-platform registration, use role-based priority
    // (User selected multiple platforms, so we need to pick one)

    // Marketplace: Buyer or Seller
    if (roles.includes('seller') || roles.includes('buyer')) {
        return '/marketplace/onboarding';
    }

    // Export Program
    if (roles.includes('export_participant')) {
        return '/export/onboarding';
    }

    // Cooperative (Check BEFORE WAVE to prevent female cooperative users going to WAVE)
    if (roles.includes('cooperative_member')) {
        return '/cooperatives/payment';
    }

    // WAVE Program (females auto-enrolled) - Now checked AFTER Cooperative
    if (roles.includes('wave_participant')) {
        return '/wave/application'; // WAVE uses "application" instead of "onboarding"
    }

    // Farm Nation
    if (roles.includes('farmer') || roles.includes('land_owner') || roles.includes('investor')) {
        return '/farm-nation/onboarding';
    }

    // Academy
    if (roles.includes('academy_participant')) {
        return '/academy/setup';
    }

    // Fallback for general users or edge cases
    return '/dashboard';
}


/**
 * Calculate where to redirect the user AFTER they have successfully logged in.
 * This is called by the client component after client-side signIn() succeeds.
 * 
 * CRITICAL: Checks onboarding status to prevent premature dashboard access.
 */
export async function getPostLoginRedirect(email: string) {
    try {
        // Fetch user profile to determine their primary app
        const userSnapshot = await db.collection(COLLECTIONS.USERS)
            .where('email', '==', email)
            .limit(1)
            .get();

        if (!userSnapshot.empty) {
            const userData = userSnapshot.docs[0].data() as FirestoreUser;
            const userRoles = userData.roles || ['general_user'];
            const serviceRegistrations = (userData as any).serviceRegistrations || {};

            // Determine primary app based on roles
            const primaryApp = getPrimaryApp(userRoles);

            // Check if user needs onboarding for their primary app
            const onboardingUrl = getOnboardingUrlIfNeeded(userRoles, serviceRegistrations, primaryApp);

            if (onboardingUrl) {
                logger.info(`User ${email} needs onboarding, redirecting to: ${onboardingUrl}`);
                return {
                    success: true,
                    redirectUrl: onboardingUrl
                };
            }

            logger.info(`User ${email} redirecting to primary app: ${primaryApp}`);
            return {
                success: true,
                redirectUrl: primaryApp
            };
        }

        return { success: true, redirectUrl: "/dashboard" };
    } catch (error) {
        logger.error("Failed to determine redirect:", error);
        return { success: true, redirectUrl: "/dashboard" }; // Fail safe
    }
}

/**
 * Check if user needs to complete onboarding for their primary app.
 * Returns onboarding URL if needed, or null if onboarding is complete.
 */
function getOnboardingUrlIfNeeded(
    userRoles: UserRole[],
    serviceRegistrations: Record<string, any>,
    primaryApp: string
): string | null {
    // Map dashboard URLs to their onboarding URLs and service keys
    const appOnboardingMap: Record<string, { onboardingUrl: string; serviceKey: string }> = {
        '/wave/dashboard': { onboardingUrl: '/wave/application', serviceKey: 'wave' },
        '/marketplace/buyer/dashboard': { onboardingUrl: '/marketplace/onboarding', serviceKey: 'marketplace' },
        '/marketplace/seller/dashboard': { onboardingUrl: '/marketplace/onboarding', serviceKey: 'marketplace' },
        '/export/dashboard': { onboardingUrl: '/export/onboarding', serviceKey: 'export' },
        '/cooperatives/dashboard': { onboardingUrl: '/cooperatives/onboarding', serviceKey: 'cooperatives' },
        '/farm-nation/dashboard': { onboardingUrl: '/farm-nation/onboarding', serviceKey: 'farm_nation' },
        '/academy/dashboard': { onboardingUrl: '/academy/setup', serviceKey: 'academy' },
    };

    const appConfig = appOnboardingMap[primaryApp];

    if (!appConfig) {
        // No onboarding required for this app (e.g., admin, home page)
        return null;
    }

    const { onboardingUrl, serviceKey } = appConfig;
    const serviceStatus = serviceRegistrations[serviceKey];

    // If no service registration OR status is 'pending' or missing, redirect to onboarding
    if (!serviceStatus || serviceStatus.status === 'pending' || !serviceStatus.status) {
        return onboardingUrl;
    }

    // If status is 'approved', allow dashboard access
    if (serviceStatus.status === 'approved') {
        return null;
    }

    // If status is 'rejected', send to a rejection notice page (or onboarding to reapply)
    if (serviceStatus.status === 'rejected') {
        return onboardingUrl; // Let them try again
    }

    // Default: require onboarding
    return onboardingUrl;
}

// DEPRECATED: Old Server Action Login
// Keeping a stub for type safety if needed, but logic moved to client
export async function loginAction(prevState: any, formData: FormData) {
    return { error: "Please use client-side login", success: false };
}

export async function registerAction(prevState: any, formData: FormData) {
    const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    try {
        // Validate with Zod
        const validatedData = registerSchema.parse({
            fullName,
            email,
            password,
            confirmPassword,
            phone: formData.get("phone") as string,
        });

        // Create Firebase Auth user via Admin SDK
        const userRecord = await adminAuth.createUser({
            email: validatedData.email,
            password: validatedData.password,
            displayName: validatedData.fullName,
            emailVerified: true, // Auto-verify for now
        });

        // SIMPLIFIED: Everyone gets only general_user role on registration
        // Additional roles are granted after application approval
        const userRoles: UserRole[] = ["general_user"];

        // Create Firestore user profile
        const userProfile: Omit<FirestoreUser, "createdAt" | "updatedAt"> = {
            uid: userRecord.uid,
            fullName: validatedData.fullName,
            email: validatedData.email,
            roles: userRoles,
            verified: true, // Auto-verify on registration (account-level verification)
        };

        try {
            await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set({
                ...userProfile,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (firestoreError: any) {
            logger.error("Firestore profile creation failed, rolling back Auth user:", firestoreError);
            // ROLLBACK: Delete the Auth user so they can try again (prevents "Ghost User" state)
            try {
                await adminAuth.deleteUser(userRecord.uid);
                logger.info(`Rollback successful for user ${userRecord.uid}`);
            } catch (rollbackError) {
                logger.error(`CRITICAL: Failed to rollback user ${userRecord.uid}:`, rollbackError);
            }
            throw new Error("Failed to create user profile. Please try again.");
        }

        // SIMPLIFIED: Use callbackUrl for deep linking, default to dashboard
        const callbackUrl = formData.get("callbackUrl") as string;
        const redirectUrl = callbackUrl || "/dashboard";

        // REGISTRATION ONLY - AUTHENTICATION IS HANDLED ON CLIENT
        // Server-side signIn in Server Actions causes race conditions with cookies.
        // We return success, and the client component calls signIn() via NextAuth client SDK.
        return { success: true, redirectUrl, error: "" };
    } catch (error: any) {
        // Re-throw redirect errors to allow Next.js to handle navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof error.digest === 'string' &&
            error.digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        logger.error("Registration error", error);

        if (error instanceof ZodError) {
            const zodError = error as any;
            const errorMessage = zodError.errors?.map((e: any) => e.message).join(", ") || "Validation error";
            return { error: errorMessage, success: false, redirectUrl: "" };
        }

        // Handle Firebase auth errors
        if (error.code === "auth/email-already-in-use") {
            return { error: "An account with this email already exists", success: false, redirectUrl: "" };
        }
        if (error.code === "auth/weak-password") {
            return { error: "Password is too weak", success: false, redirectUrl: "" };
        }
        if (error.code === "auth/invalid-email") {
            return { error: "Invalid email address", success: false, redirectUrl: "" };
        }

        if (error instanceof Error) {
            return { error: error.message, success: false, redirectUrl: "" };
        }

        return { error: "Registration failed. Please try again", success: false, redirectUrl: "" };
    }
}

export async function logoutAction() {
    await signOut({ redirectTo: "/auth/login" });
}
