"use server";

import { auth, signIn, signOut } from "@/lib/auth";
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
import { rateLimit, getActionClientIp } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const loginLimiter = rateLimit(rateLimitConfig.login);

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
 * Bug fix: was querying Firestore by email (.where('email','==',email)), which
 * is a full collection scan (slow, needs index) and fails silently if the stored
 * email field differs. Now uses auth() to get the userId for a direct O(1) doc
 * lookup. Falls back to email query if no session is ready yet.
 */
export async function getPostLoginRedirect(email: string) {
    try {
        let userData: FirestoreUser | null = null;

        // Primary path: direct userId lookup — O(1), always correct.
        const session = await auth();
        if (session?.user?.id) {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            if (userDoc.exists) {
                userData = userDoc.data() as FirestoreUser;
            }
        }

        // Fallback: email query (covers edge case where session isn't ready post-signIn)
        if (!userData) {
            logger.warn(`[getPostLoginRedirect] No session post-login — falling back to email query`, { email });
            const userSnapshot = await db.collection(COLLECTIONS.USERS)
                .where('email', '==', email)
                .limit(1)
                .get();
            if (!userSnapshot.empty) {
                userData = userSnapshot.docs[0].data() as FirestoreUser;
            }
        }

        if (userData) {
            const userRoles = userData.roles || ['general_user'];
            const serviceRegistrations = (userData as FirestoreUser & { serviceRegistrations?: any }).serviceRegistrations || {};

            // ── ADMIN OVERRIDE ──────────────────────────────────────────────
            // If the user has ANY admin role (system or module-specific),
            // always ensure they land on the Admin Dashboard by default.
            const hasAdminRole = userRoles.some(role => {
                const r = role.toLowerCase();
                return (
                    r === 'admin' || 
                    r === 'super_admin' || 
                    r === 'superadmin' ||
                    r.endsWith('_admin') ||
                    r.includes('admin_dashboard')
                );
            });

            // ── SECURITY GUARD: LEGACY PASSWORD RESET ──────────────────────
            // If the user was onboarded by an admin (legacy flow), 
            // they MUST change their password on first login.
            if ((userData as any).requiresPasswordChange) {
                logger.info(`[getPostLoginRedirect] User ${email} requires password change, redirecting to security setup`);
                return { error: null, success: true as const, data: { redirectUrl: '/auth/reset-legacy-password' } };
            }

            if (hasAdminRole) {
                // Determine specific admin landing page
                let adminRedirect = '/admin';
                
                // If they are a module admin but NOT a full system admin,
                // send them directly to their module management area.
                if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
                    if (userRoles.includes('academy_admin')) adminRedirect = '/admin/academy';
                    else if (userRoles.includes('wave_admin')) adminRedirect = '/admin/wave';
                    else if (userRoles.includes('marketplace_admin')) adminRedirect = '/admin/marketplace';
                    else if (userRoles.includes('cooperative_admin')) adminRedirect = '/admin/cooperatives';
                    else if (userRoles.includes('export_admin')) adminRedirect = '/admin/export';
                    else if (userRoles.includes('farm_nation_admin')) adminRedirect = '/admin/farm-nation';
                }

                logger.info(`[getPostLoginRedirect] User ${email} has admin privileges, redirecting to ${adminRedirect}`);
                return { error: null, success: true as const, data: { redirectUrl: adminRedirect } };
            }

            // CRITICAL: Check application status and redirect accordingly
            // Priority: Approved > Pending > No Applications

            // ── MODULE-TO-DASHBOARD MAP ──────────────────────────────────────
            // Route approved users DIRECTLY to their module dashboard.
            // This bypasses getPrimaryApp(userRoles) which relies on the JWT
            // session roles — those can be stale for hours after admin approval.
            const approvedDashboardMap: Record<string, string> = {
                'academy': '/academy/dashboard',
                'wave': '/wave/dashboard',
                'export': '/export/dashboard',
                'marketplace': '/marketplace/buyer/dashboard',
                'cooperatives': '/cooperatives/dashboard',
                'farmNation': '/farm-nation/dashboard',
                'farm_nation': '/farm-nation/dashboard',
            };

            // 1. Check for approved modules
            const approvedModules = Object.entries(serviceRegistrations)
                .filter(([_, reg]: [string, any]) => reg?.status === 'approved');

            if (approvedModules.length > 0) {
                // Prefer the first approved module's direct dashboard URL.
                // This avoids relying on session-cached roles that may be stale.
                const [firstApprovedKey] = approvedModules[0];
                const directDashboard = approvedDashboardMap[firstApprovedKey];

                if (directDashboard) {
                    logger.info(`[getPostLoginRedirect] User ${email} approved for '${firstApprovedKey}', direct redirect to: ${directDashboard}`);
                    return { error: null, success: true as const, data: { redirectUrl: directDashboard } };
                }

                // Fallback for unknown modules: use role-based primary app
                const primaryApp = getPrimaryApp(userRoles);
                logger.info(`[getPostLoginRedirect] User ${email} has approved modules, role-based redirect to: ${primaryApp}`);
                return { error: null, success: true as const, data: { redirectUrl: primaryApp } };
            }

            // 2. Check for pending applications
            // REMOVED: Users are now allowed to access the Dashboard even if they have pending applications.
            // They can check their pending status and navigate to pending pages from the Dashboard.
            // 
            // Fallback for pending users AND new users: route directly to the User Dashboard
            logger.info(`[getPostLoginRedirect] User ${email} has no active apps, directing to default dashboard`);
            return { error: null, success: true as const, data: { redirectUrl: '/dashboard' } };
        }

        // User has no applications yet — go to dashboard instead of /auth/get-started
        logger.info(`[getPostLoginRedirect] No applications found, redirecting to dashboard`, { email });
        return { success: true as const, data: { redirectUrl: '/dashboard' } };
    } catch (error: any) {
        logger.error('[getPostLoginRedirect] Error determining redirect', { email, error: error.message });
        return {
            error: "Action failed", success: false as const,
            redirectUrl: '/dashboard',
            error: error.message
        };
    }
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
        const ip = await getActionClientIp();
        const rateLimitResult = await loginLimiter.check(ip);
        if (!rateLimitResult.success) {
            return {
                success: false as const,
                error: "Too many registration attempts. Please try again later.",
                redirectUrl: "",
            };
        }

        // Validate with Zod
        const validatedData = registerSchema.parse({
            fullName,
            email,
            password,
            confirmPassword,
            phone: formData.get("phone") as string,
        });

        // 🔒 DEDUP GUARD: Check phone uniqueness before touching Firebase Auth
        // Prevents multi-account fraud (same phone, different email addresses)
        if (validatedData.phone) {
            const phoneCheck = await db.collection(COLLECTIONS.USERS)
                .where("phone", "==", validatedData.phone)
                .limit(1)
                .get();
            if (!phoneCheck.empty) {
                return {
                    error: "An account with this phone number already exists. Please log in instead.",
                    success: false as const,
                    redirectUrl: "",
                };
            }
        }

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

        // Split fullName into structured fields at registration time.
        // This ensures every new user has firstName/lastName from day one,
        // eliminating the legacy data gap for all future registrations.
        const nameParts = validatedData.fullName.trim().split(/\s+/).filter(Boolean);
        const registrationFirstName = nameParts[0] || "";
        let registrationOtherName = "";
        let registrationLastName = "";
        
        if (nameParts.length > 2) {
             registrationOtherName = nameParts.slice(1, -1).join(" ");
             registrationLastName = nameParts[nameParts.length - 1];
        } else if (nameParts.length === 2) {
             registrationLastName = nameParts[1];
        }

        // Create Firestore user profile
        const userProfile: Omit<FirestoreUser, "createdAt" | "updatedAt"> = {
            uid: userRecord.uid,
            fullName: validatedData.fullName,
            firstName: registrationFirstName,
            lastName: registrationLastName,
            otherName: registrationOtherName || undefined,
            email: validatedData.email,
            phone: validatedData.phone,
            roles: userRoles,
            isVerified: true,  // canonical field
            verified: true,    // legacy compat field — keep both so old queries still work
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

        // CRITICAL: Check the host header to see if the user registered on a specific module domain.
        // If they did, redirect them directly to that module's onboarding instead of the hub selector.
        let redirectUrl = "/auth/get-started";
        try {
            const { headers } = await import("next/headers");
            const headersList = await headers();
            const host = headersList.get("x-forwarded-host") || headersList.get("host") || "";
            const normalizedHost = host.replace(/^www\./, "");
            
            if (normalizedHost.includes("easysalesexportacademy.com")) redirectUrl = "/academy/setup";
            else if (normalizedHost.includes("farmnation.ng")) redirectUrl = "/farm-nation/onboarding";
            else if (normalizedHost.includes("market.easysalesexport.com")) redirectUrl = "/marketplace/onboarding";
            else if (normalizedHost.includes("waveprogramme.com")) redirectUrl = "/wave/application";
            else if (normalizedHost.includes("easysalescooperative.com")) redirectUrl = "/cooperatives/onboarding";
            else if (normalizedHost.includes("easysalesexportng.com")) redirectUrl = "/export/onboarding";
            
        } catch (e) {
            logger.warn("Could not determine host for post-registration redirect:", { error: e instanceof Error ? e.message : String(e) });
        }

        // REGISTRATION ONLY - AUTHENTICATION IS HANDLED ON CLIENT
        // Server-side signIn in Server Actions causes race conditions with cookies.
        // We return success, and the client component calls signIn() via NextAuth client SDK.
        return { success: true as const, redirectUrl, error: "" };
    } catch (error: any) {
        // Re-throw redirect errors to allow Next.js to handle navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof error.digest === 'string' &&
            error.digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        logger.error("Registration error", error);

        if (error instanceof ZodError) {
            const zodError = error as ZodError;
            const errorMessage = zodError.issues?.map(e => e.message).join(", ") || "Validation error";
            return { error: errorMessage, success: false as const, redirectUrl: "" };
        }

        // Handle Firebase auth errors
        if (error.code === "auth/email-already-in-use") {
            return { error: "An account with this email already exists", success: false as const, redirectUrl: "" };
        }
        if (error.code === "auth/weak-password") {
            return { error: "Password is too weak", success: false as const, redirectUrl: "" };
        }
        if (error.code === "auth/invalid-email") {
            return { error: "Invalid email address", success: false as const, redirectUrl: "" };
        }

        if (error instanceof Error) {
            return { error: error.message, success: false as const, redirectUrl: "" };
        }

        return { error: "Registration failed. Please try again", success: false as const, redirectUrl: "" };
    }
}

export async function logoutAction() {
    await signOut({ redirectTo: "/auth/login" });
}

/**
 * Change the user's password using the Firebase Auth REST API (to verify current)
 * and Firebase Admin (to set the new one).
 */
export async function changePasswordAction(
    currentPassword: string,
    newPassword: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || !session.user.email) {
            return { success: false as const, error: "Unauthorized" };
        }

        // Verify current password via REST API
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify({
                email: session.user.email,
                password: currentPassword,
                returnSecureToken: true
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!verifyRes.ok) {
            const errorData = await verifyRes.json();
            logger.error("Failed to verify current password", errorData);
            return { success: false as const, error: "Incorrect current password." };
        }

        // Update to new password via Admin SDK
        await adminAuth.updateUser(session.user.id, {
            password: newPassword
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Error changing password:", error);
        return { success: false as const, error: error.message || "An unexpected error occurred. Please try again." };
    }
}
