"use server";

import { auth, signIn, signOut } from "@/lib/auth";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { registerSchema, loginSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { User as FirestoreUser } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { LEGACY_ROLE_MAP, type LegacyRole, type UserRole } from "@/lib/types/roles";
import { getPrimaryApp } from "@/lib/role-app-mapping";
import { ZodError } from "zod";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { rateLimit, getActionClientIp } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { normalisePhone } from '@/lib/phone';

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
function determinePostRegistrationRedirect(platforms: string[], roles: UserRole[]): string { // PRIORITY 1: Check user's SELECTED platforms first (single platform registration)
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
    if (roles.includes('seller') || roles.includes('buyer')) { return '/marketplace/onboarding';
    }

    // Export Program
    if (roles.includes('export_participant')) { return '/export/onboarding';
    }

    // Cooperative (Check BEFORE WAVE to prevent female cooperative users going to WAVE)
    if (roles.includes('cooperative_member')) { return '/cooperatives/payment';
    }

    // WAVE Program (females auto-enrolled) - Now checked AFTER Cooperative
    if (roles.includes('wave_participant')) { return '/wave/application'; // WAVE uses "application" instead of "onboarding"
    }

    // Farm Nation
    if (roles.includes('farmer') || roles.includes('land_owner') || roles.includes('investor')) { return '/farm-nation/onboarding';
    }

    // Academy
    if (roles.includes('academy_participant')) { return '/academy/setup';
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
export async function getPostLoginRedirect(email: string) { try {
        let userData: FirestoreUser | null = null;

        // Direct query by email - robust, fast, avoids NextAuth auth() session deadlock.
        const userSnapshot = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS)
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get());
        if (!userSnapshot.empty) {
            userData = userSnapshot.docs[0].data() as FirestoreUser;
        }

        if (userData) { const userRoles = userData.roles || ['general_user'];
            const serviceRegistrations = (userData as FirestoreUser & { serviceRegistrations?: any }).serviceRegistrations || {};

            // ── ADMIN OVERRIDE ──────────────────────────────────────────────
            // If the user has ANY admin role (system or module-specific),
            // always ensure they land on the Admin Dashboard by default.
            const hasAdminRole = userRoles.some((role: string) => { const r = role.toLowerCase();
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

            if (hasAdminRole) { // Determine specific admin landing page
                let adminRedirect = '/admin';
                
                // If they are a global admin/super admin, they should land on the main /admin dashboard.
                // Module admin roles take priority only for silo-isolated module admins.
                // Compared as plain strings, like the hasAdminRole check above.
                // `roles` is declared UserRole[], but it is read straight out of
                // the database, so at runtime it holds whatever is stored there
                // — including the legacy 'superadmin' spelling, which is not in
                // the UserRole union. Treating the declared type as a guarantee
                // here would mean dropping that comparison and quietly demoting
                // anyone still carrying it.
                const roleStrings: string[] = userRoles as unknown as string[];
                const isGlobalAdmin = roleStrings.includes('super_admin')
                    || roleStrings.includes('superadmin')
                    || roleStrings.includes('admin');
                
                if (!isGlobalAdmin) {
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
            const approvedDashboardMap: Record<string, string> = { 'academy': '/academy/dashboard',
                'wave': '/wave/dashboard',
                'export': '/export/dashboard',
                'marketplace': '/marketplace/buyer/dashboard',
                'cooperatives': '/cooperatives/dashboard',
                'farmNation': '/farm-nation/dashboard',
                'farm_nation': '/farm-nation/dashboard' };

            // 1. Check for approved modules
            const approvedModules = Object.entries(serviceRegistrations)
                .filter(([_, reg]: [string, any]) => reg?.status === 'approved' || reg?.status === 'active');

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
                const primaryApp = getPrimaryApp(userRoles as import("@/lib/types/roles").UserRole[]);
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
        return { error: null,  success: true as const, data: { redirectUrl: '/dashboard' } };
    } catch (error: any) { logger.error('[getPostLoginRedirect] Error determining redirect', { email, error: error.message });
        return { success: false as const, redirectUrl: '/dashboard', error: error.message || "Action failed"};
    }
}

export async function preValidateLoginAction(credentials: any): Promise<{ success: boolean; error: string | null }> {
    try {
        // THIS REFUSED EVERY LOGIN WHEN NEXT_PUBLIC_FIREBASE_API_KEY WAS ABSENT.
        //
        // The same gate stood at the top of authorize() in lib/auth.ts, and
        // neither path needs the key: authentication runs through Supabase, and
        // Firebase is only consulted as a fallback for legacy users whose
        // password has not been migrated. That fallback re-reads the variable
        // and guards itself on it a few lines below, as it must, because it is
        // the only code that uses it.
        //
        // So unsetting a Firebase variable — the obvious housekeeping for a
        // codebase that has otherwise migrated to Supabase — locked every user
        // out with "Service configuration error. Please contact support.", a
        // message that names nothing and points nowhere.
        //
        // Found by running the app against a local stack with no Firebase
        // configuration at all, which is the correct shape for one.

        // 1. Validate credentials with Zod
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
            return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
        }
        const { email, password } = parsed.data;

        // 2. Rate limit check
        const { consumeLoginAttempt } = await import("@/lib/rate-limit");
        try {
            const rateLimitResult = await consumeLoginAttempt(email);
            if (!rateLimitResult.allowed) {
                return { success: false, error: rateLimitResult.error || "Too many login attempts. Please try again later." };
            }
        } catch (err: any) {
            logger.error(`[PreValidate:Fallback] Redis consumeLoginAttempt failed. Error: ${err.message}`);
        }

        // 3. Authenticate with Supabase Auth
        let responseData: any;
        try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseAnonKey) {
                return { success: false, error: "Service configuration error. Please contact support." };
            }
            
            const { createClient } = await import('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseAnonKey);
            
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) {
                // FALLBACK: Verify credentials against Firebase Auth for JIT migration
                const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
                if (firebaseApiKey && firebaseApiKey !== "mock-api-key-for-build") {
                    try {
                        const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
                        const signInUrl = authEmulatorHost
                            ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`
                            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`;
                        
                        const res = await fetch(signInUrl, {
                            method: "POST",
                            headers: { 
                                "Content-Type": "application/json",
                                "Connection": "close"
                            },
                            body: JSON.stringify({
                                email,
                                password,
                                returnSecureToken: true
                            })
                        });
                        
                        const data = await res.json();
                        if (res.ok) {
                            // Firebase Auth succeeded! Provision the user in Supabase Auth
                            const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
                            if (supabaseServiceKey) {
                                const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
                                const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                                    email,
                                    password,
                                    email_confirm: true,
                                });

                                if (!createError && newUser?.user) {
                                    // Map the new Supabase Auth user ID to the legacy profile in users collection
                                    const firebaseUid = data.localId;
                                     await db.collection(COLLECTIONS.USERS).doc(firebaseUid).update({
                                         supabaseAuthId: newUser.user.id,
                                     }).catch(err => {
                                         logger.error(`[PreValidate] Failed to save supabaseAuthId mapping:`, err);
                                     });
 
                                     // Eagerly migrate their data to prevent any empty dashboard/onboarding states
                                     try {
                                         const { migrateLegacyUserData } = await import("@/lib/user-migration");
                                         await migrateLegacyUserData(firebaseUid, newUser.user.id, email);
                                     } catch (migErr) {
                                         logger.error(`[PreValidate] Failed to execute migrateLegacyUserData:`, migErr);
                                     }

                                     logger.info(`[PreValidate] JIT migrated user ${email} during pre-validation.`);
                                     responseData = { user: newUser.user };
                                } else {
                                    logger.error(`[PreValidate] Failed to provision user in Supabase Auth:`, createError);
                                }
                            }
                        }
                    } catch (fbErr: any) {
                        logger.error(`[PreValidate] JIT Fallback error: ${fbErr.message}`);
                    }
                }

                if (!responseData) {
                    const errMsg = authError.message || String(authError);
                    const isTransient = errMsg.includes("Premature close") || 
                                        errMsg.includes("socket hang up") || 
                                        errMsg.includes("ECONNRESET") ||
                                        errMsg.includes("Client network socket disconnected") ||
                                        errMsg.includes("FetchError") ||
                                        errMsg.includes("fetch failed") ||
                                        errMsg.includes("Connection closed") ||
                                        errMsg.includes("Socket closed") ||
                                        errMsg.includes("UNAVAILABLE") ||
                                        errMsg.includes("stream terminated") ||
                                        errMsg.includes("ERR_STREAM_PREMATURE_CLOSE") ||
                                        errMsg.includes("ENOTFOUND") ||
                                        errMsg.includes("getaddrinfo") ||
                                        errMsg.includes("network-error") ||
                                        errMsg.includes("DEADLINE_EXCEEDED") ||
                                        errMsg.includes("deadline exceeded");
                    if (isTransient) {
                        return { success: false, error: "A temporary connection issue occurred. Please try again." };
                    }

                    // Check if email exists in database to give a precise "Email address not registered" error
                    const emailCheck = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS)
                        .where("email", "==", email.toLowerCase())
                        .limit(1)
                        .get());
                         
                    if (emailCheck.empty) {
                        return {
                            success: false,
                            error: "Email address not registered."
                        };
                    }
                    
                    return { 
                        success: false, 
                        error: "Incorrect password." 
                    };
                }
            } else {
                responseData = authData;
            }
        } catch (authErr: any) {
            logger.error(`[PreValidate] Auth error: ${authErr.message}`);
            return { success: false, error: "An unexpected error occurred. Please try again." };
        }

        const uid = responseData.user.id;

        // 4. Fetch user profile and check status
        let userDoc = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(uid).get());

        // ── JIT MIGRATION FOR COMPLETED LOGIN ───────────────────────────────
        const needsMigration = !userDoc.exists || (!userDoc.data()?._migratedAt && !userDoc.data()?._legacyFirebaseUid);
        if (needsMigration && email) {
            try {
                const legacyQuery = await db.collection(COLLECTIONS.USERS)
                    .where("email", "==", email.toLowerCase())
                    .limit(1)
                    .get();
                if (!legacyQuery.empty) {
                    const legacyUserDoc = legacyQuery.docs[0];
                    const legacyUid = legacyUserDoc.id;
                    if (legacyUid !== uid) {
                        logger.info(`[PreValidate] User JIT migration needed. Triggering JIT migration for ${email} (${legacyUid} → ${uid})`);
                        const { migrateLegacyUserData } = await import("@/lib/user-migration");
                        await migrateLegacyUserData(legacyUid, uid, email);
                        
                        // Re-fetch the newly migrated active user document
                        userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
                    }
                }
            } catch (migErr) {
                logger.error(`[PreValidate] Legacy user JIT login migration error:`, migErr);
            }
        }
        // ───────────────────────────────────────────────────────────────────

        if (!userDoc.exists) {
            // Auto-repair/recreate default profile on the fly to prevent lockout
            try {
                logger.info(`[PreValidate] Profile not found in database for ${email}. Recreating default profile.`);
                const defaultProfile = {
                    uid: uid,
                    email: email.toLowerCase(),
                    roles: ["general_user"],
                    isVerified: false,
                    verified: false,
                    profileComplete: false,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                };
                await db.collection(COLLECTIONS.USERS).doc(uid).set(defaultProfile, { merge: true });
                userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
            } catch (repairErr) {
                logger.error(`[PreValidate] Failed to auto-repair missing user doc:`, repairErr);
            }
        }

        if (!userDoc.exists) {
            return { success: false, error: "User profile not found. Please contact support or register again." };
        }

        const userData = userDoc.data() as FirestoreUser;

        // Self-healing: normalize service registrations based on roles upon successful login
        try {
            const { normalizeUserDoc } = await import("@/lib/schema-normalizer");
            const normalizedData = normalizeUserDoc(userData);
            const hasChanges = JSON.stringify(normalizedData.serviceRegistrations) !== JSON.stringify(userData.serviceRegistrations);
            if (hasChanges) {
                logger.info(`[PreValidate] Self-healing service registrations for ${email}`);
                await db.collection(COLLECTIONS.USERS).doc(uid).set(normalizedData, { merge: true });
            }
        } catch (healErr) {
            logger.error(`[PreValidate] Non-fatal: failed to self-heal service registrations:`, healErr);
        }

        // 5. Ban/suspend check
        if ((userData as any).isBanned === true || (userData as any).status === 'banned' || (userData as any).suspended === true) {
            return { success: false, error: "Your account has been suspended. Please contact support." };
        }

        return { success: true, error: null };
    } catch (e: any) {
        logger.error(`[PreValidate] Exception: ${e.message}`, e);
        const errMsg = e.message || String(e);
        const isTransient = errMsg.includes("Premature close") || 
                            errMsg.includes("socket hang up") || 
                            errMsg.includes("ECONNRESET") ||
                            errMsg.includes("Client network socket disconnected") ||
                            errMsg.includes("FetchError") ||
                            errMsg.includes("fetch failed") ||
                            errMsg.includes("Connection closed") ||
                            errMsg.includes("Socket closed") ||
                            errMsg.includes("UNAVAILABLE") ||
                            errMsg.includes("stream terminated") ||
                            errMsg.includes("ERR_STREAM_PREMATURE_CLOSE") ||
                            errMsg.includes("ENOTFOUND") ||
                            errMsg.includes("getaddrinfo") ||
                            errMsg.includes("network-error") ||
                            errMsg.includes("DEADLINE_EXCEEDED") ||
                            errMsg.includes("deadline exceeded");
        if (isTransient) {
            return { success: false, error: "A temporary connection issue occurred. Please try again." };
        }
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}

// DEPRECATED: Old Server Action Login
// Keeping a stub for type safety if needed, but logic moved to client
export async function loginAction(prevState: any, formData: FormData) { return { error: "Please use client-side login", success: false as const, data: null };
}

export async function registerAction(prevState: any, formData: FormData) { const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;
    const gender = formData.get("gender") as string;

    try {
        const ip = await getActionClientIp();
        const rateLimitResult = await loginLimiter.check(ip);
        if (!rateLimitResult.success) {
            return { success: false as const, error: "Too many registration attempts. Please try again later.", redirectUrl: ""};
        }

        // Validate with Zod
        const validatedData = registerSchema.parse({ fullName,
            email,
            password,
            confirmPassword,
            phone: formData.get("phone") as string,
            gender });

        // 🔒 DEDUP GUARD: Check phone uniqueness before touching Firebase Auth
        // Prevents multi-account fraud (same phone, different email addresses)
        const normalisedPhone = normalisePhone(validatedData.phone) || validatedData.phone;
        if (normalisedPhone) { const phoneCheck = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS)
                .where("phone", "==", normalisedPhone)
                .limit(1)
                .get());
            if (!phoneCheck.empty) {
                return { error: "An account with this phone number already exists. Please log in instead.", success: false as const, redirectUrl: ""};
            }
        }

        // Create user in Supabase Auth FIRST to obtain canonical UUID
        let canonicalUid: string;
        try {
            const { supabaseAdmin } = await import('@/lib/supabase');
            const { data: sbUser, error: sbErr } = await supabaseAdmin.auth.admin.createUser({
                email: validatedData.email.toLowerCase(),
                password: validatedData.password,
                email_confirm: true,
                user_metadata: { full_name: validatedData.fullName }
            });

            if (sbErr) {
                if (sbErr.message.includes('already been registered') || sbErr.message.includes('already registered') || sbErr.message.includes('already exists')) {
                    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
                    const match = existingUsers?.users?.find(u => u.email?.toLowerCase() === validatedData.email.toLowerCase());
                    if (match) {
                        canonicalUid = match.id;
                    } else {
                        return { success: false as const, error: "A user with this email address has already been registered", redirectUrl: "" };
                    }
                } else {
                    return { success: false as const, error: sbErr.message || "Registration failed", redirectUrl: "" };
                }
            } else if (sbUser?.user) {
                canonicalUid = sbUser.user.id;
            } else {
                return { success: false as const, error: "Failed to initialize authentication", redirectUrl: "" };
            }
        } catch (sbException: any) {
            logger.error("[Register] Supabase Auth creation exception:", sbException);
            return { success: false as const, error: "Authentication system error. Please try again.", redirectUrl: "" };
        }

        // A "create the account in Firebase Auth as well" block used to sit
        // here. It could never work, and never did.
        //
        // package.json maps firebase-admin to src/lib/shims/firebase-admin, so
        // adminAuth.createUser writes to the SAME Supabase auth store that the
        // lines above just created this account in. It therefore asked Supabase
        // to register an email it had registered moments earlier, and got back
        //
        //     A user with this email address has already been registered
        //
        // on every single registration — confirmed by calling it, not by
        // reading. The error was caught and logged as
        // "[Register] Firebase Auth secondary creation skipped or failed",
        // which reads like an optional step degrading gracefully rather than a
        // step that has never once succeeded.
        //
        // It also passed `uid: canonicalUid` to align the two ids. Supabase
        // assigns account ids and its admin API has no parameter for one, so
        // that was dropped silently too — and the resulting `firebaseUid` was
        // assigned and never read by anything.
        //
        // Nothing is lost by removing it: no second identity store exists to
        // create the account in.

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

        // Create Firestore user profile under canonical Supabase UUID
        const userProfile: Omit<FirestoreUser, "createdAt" | "updatedAt"> = { 
            uid: canonicalUid,
            id: canonicalUid,
            fullName: validatedData.fullName,
            firstName: registrationFirstName,
            lastName: registrationLastName,
            otherName: registrationOtherName || undefined,
            email: validatedData.email.toLowerCase(),
            phone: normalisedPhone,
            gender: validatedData.gender.toLowerCase() as "male" | "female",
            roles: userRoles,
            isVerified: true,  // canonical field
            verified: true,    // legacy compat field — keep both so old queries still work
            profileComplete: true,
        };

        try { 
            await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(canonicalUid).set({
                ...userProfile,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            }, { merge: true }));
        } catch (firestoreError: any) {
            logger.error("Database profile creation failed:", firestoreError);
            throw new Error("Failed to create user profile. Please try again.");
        }

        // CRITICAL: Check the host header to see if the user registered on a specific module domain.
        // If they did, redirect them directly to that module's onboarding instead of the hub selector.
        const callbackUrl = formData.get("callbackUrl") as string;
        let redirectUrl = "/auth/get-started";
        
        if (callbackUrl && callbackUrl !== "/dashboard" && callbackUrl.startsWith("/")) {
            redirectUrl = callbackUrl;
        } else {
            try { const { headers } = await import("next/headers");
                const headersList = await headers();
                const host = headersList.get("x-forwarded-host") || headersList.get("host") || "";
                const normalizedHost = host.replace(/^www\./, "");
                if (normalizedHost.includes("easysalesacademy.com")) redirectUrl = "/academy/setup";
                else if (normalizedHost.includes("farmnation.ng")) redirectUrl = "/farm-nation/onboarding";
                else if (normalizedHost.includes("marketplace.easysalesexport.com")) redirectUrl = "/marketplace/onboarding";
                else if (normalizedHost.includes("waveprogramme.com")) redirectUrl = "/wave/application";
                else if (normalizedHost.includes("easysalescooperative.com")) redirectUrl = "/cooperatives/onboarding";
                else if (normalizedHost.includes("easysalesexportng.com")) redirectUrl = "/export/onboarding";
            } catch (e) { logger.warn("Could not determine host for post-registration redirect:", { error: e instanceof Error ? e.message : String(e) });
            }
        }

        // REGISTRATION ONLY - AUTHENTICATION IS HANDLED ON CLIENT
        // Server-side signIn in Server Actions causes race conditions with cookies.
        // We return success, and the client component calls signIn() via NextAuth client SDK.
        return { success: true as const, redirectUrl, error: "" };
    } catch (error: any) { // Re-throw redirect errors to allow Next.js to handle navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof error.digest === 'string' &&
            error.digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        logger.error("Registration error", error);

        if (error instanceof ZodError) { const zodError = error as ZodError;
            const errorMessage = zodError.issues?.map(e => e.message).join(", ") || "Validation error";
            return { error: errorMessage, success: false as const, redirectUrl: ""};
        }

        // Handle Firebase auth errors
        if (error.code === "auth/email-already-in-use") { return { error: "An account with this email already exists", success: false as const, redirectUrl: ""};
        }
        if (error.code === "auth/weak-password") { return { error: "Password is too weak", success: false as const, redirectUrl: ""};
        }
        if (error.code === "auth/invalid-email") { return { error: "Invalid email address", success: false as const, redirectUrl: ""};
        }

        if (error instanceof Error) { return { error: error.message, success: false as const, redirectUrl: ""};
        }

        return { error: "Registration failed. Please try again", success: false as const, redirectUrl: ""};
    }
}

export async function logoutAction() { 
    try {
        const cookieStore = await cookies();
        
        const { headers } = await import("next/headers");
        const headersList = await headers();
        const hostname = (headersList.get("host") || "").split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
        const hostParts = hostname.replace(/^www\./, "").split(".");
        const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1");
        const domain = (!isLocal && hostParts.length >= 2) ? `.${hostParts.slice(-2).join(".")}` : undefined;
        
        // Explicitly clear the token from the ROOT domain so all modules lose it
        // We clear both standard and secure token names used in auth.config.ts
        const tokenNames = ['authjs.session-token', '__Secure-authjs.session-token', 'next-auth.session-token', '__Secure-next-auth.session-token'];
        
        for (const name of tokenNames) {
            if (domain) {
                cookieStore.set(name, "", {
                    domain,
                    expires: new Date(0),
                    path: "/",
                });
            }
            // Also clear without explicit domain to be sure
            cookieStore.set(name, "", {
                expires: new Date(0),
                path: "/",
            });
        }

        // Clear CSRF tokens too to be safe
        const csrfNames = ['authjs.csrf-token', '__Host-authjs.csrf-token', 'next-auth.csrf-token', '__Host-next-auth.csrf-token'];
        for (const name of csrfNames) {
            cookieStore.set(name, "", {
                expires: new Date(0),
                path: "/",
            });
        }

        // Revalidate root to clear server-side caches
        revalidatePath('/');
    } catch (e) {
        // Re-throw NEXT_REDIRECT so Next.js can handle navigation.
        // signOut() internally throws NEXT_REDIRECT — we must NOT swallow it.
        if (e && typeof e === 'object' && 'digest' in e &&
            typeof (e as any).digest === 'string' &&
            (e as any).digest.startsWith('NEXT_REDIRECT')) {
            throw e;
        }
        logger.error('[logoutAction] Error clearing cookies', e);
    }

    await signOut({ redirectTo: "/auth/login" });
}

/**
 * Change the user's password using the Firebase Auth REST API (to verify current)
 * and Firebase Admin (to set the new one).
 */
export async function changePasswordAction(
    currentPassword: string,
    newPassword: string
): Promise<
    | { success: true; error: null }
    | { success: false; error: string; data?: null }
> { try {
        const session = await auth();
        if (!session?.user?.id || !session.user.email) {
            return { success: false as const, error: "Unauthorized"};
        }

        // The new password must clear the same bar as a new registration.
        //
        // It used to go straight to the provider, so the only rule that applied
        // was Firebase's six-character floor and a user could drop below the
        // policy they signed up under.
        const { passwordPolicySchema } = await import("@/lib/schemas");
        const policy = passwordPolicySchema.safeParse(newPassword);
        if (!policy.success) {
            return { success: false as const, error: policy.error.issues[0].message, data: null };
        }

        if (newPassword === currentPassword) {
            return { success: false as const, error: "Your new password must be different from your current one.", data: null };
        }

        const email = session.user.email;

        // ── Verify the current password, primary store first ──────────────
        //
        // This whole function used to talk to Firebase and only Firebase, while
        // lib/auth.ts authenticates against SUPABASE first and treats Firebase
        // as a legacy fallback. The consequence was not a partial failure — it
        // was a password change that did nothing and said it had worked:
        //
        //   old password  Supabase still holds it, accepts, login succeeds
        //   new password  Supabase rejects it, the Firebase fallback accepts,
        //                 then tries to provision the user in Supabase, gets
        //                 "already exists" and throws auth/invalid-credential
        //
        // So the new password failed, the old one kept working, and the person
        // who changed it because it had been compromised was told "success".
        //
        // Supabase is verified first now, exactly as login does it, with the
        // Firebase check kept as the fallback for accounts that never made it
        // into Supabase.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey) {
            return { success: false as const, error: "Service configuration error. Please contact support.", data: null };
        }

        const { createClient } = await import("@supabase/supabase-js");
        const anonClient = createClient(supabaseUrl, supabaseAnonKey);

        const { data: sbVerify, error: sbVerifyError } = await anonClient.auth.signInWithPassword({
            email,
            password: currentPassword,
        });

        let supabaseAuthId: string | null = sbVerify?.user?.id ?? null;

        if (sbVerifyError || !supabaseAuthId) {
            // Fallback: the account may predate the Supabase migration.
            const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
            const signInUrl = authEmulatorHost
                ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`
                : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`;
            const verifyRes = await fetch(signInUrl, {
                method: 'POST',
                body: JSON.stringify({ email, password: currentPassword, returnSecureToken: true }),
                headers: { 'Content-Type': 'application/json' }
            });

            if (!verifyRes.ok) {
                const errorData = await verifyRes.json();
                logger.error("Failed to verify current password", errorData);
                return { success: false as const, error: "Incorrect current password.", data: null };
            }

            // Verified against the legacy store, so the Supabase id has to come
            // from the profile. The JIT migration in lib/auth.ts records it as
            // supabaseAuthId; a normally-registered account uses the Supabase
            // UUID as its own document id.
            try {
                const profile = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
                supabaseAuthId = profile.data()?.supabaseAuthId || session.user.id;
            } catch {
                supabaseAuthId = session.user.id;
            }
        }

        // ── Write the new password to the primary store ───────────────────
        //
        // Reported as a failure if it does not land. Saying "password changed"
        // when the store that authenticates logins still holds the old one is
        // the defect this replaces, and a partial success is not worth
        // repeating in a quieter form.
        const { supabaseAdmin } = await import("@/lib/supabase");

        // Every branch above sets this, but the compiler cannot see it: the
        // fallback assigns from a value typed `any`, which widens back to the
        // declared `string | null`. An explicit refusal rather than a `!`,
        // because passing null into an auth admin call is not something that
        // should be asserted away — it would target no account and report
        // success.
        if (!supabaseAuthId) {
            logger.error("[changePassword] Could not resolve the account to update", { email });
            return { success: false as const, error: "Could not verify your account. Please sign in again.", data: null };
        }

        const { error: sbUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
            supabaseAuthId,
            { password: newPassword }
        );

        if (sbUpdateError) {
            logger.error("[changePassword] Supabase Auth password update failed:", sbUpdateError);
            return { success: false as const, error: "Could not update your password. Please try again or contact support.", data: null };
        }

        // Firebase second, and it matters: lib/auth.ts falls back to it when
        // Supabase rejects a password, so leaving the old one there keeps a
        // superseded credential alive. Best-effort because plenty of accounts
        // have no Firebase record at all — the primary store is already correct
        // by this point.
        try {
            await adminAuth.updateUser(session.user.id, { password: newPassword });
        } catch (fbErr: any) {
            logger.warn("[changePassword] Legacy Firebase password update skipped:", fbErr?.message);
        }

        // Clear the forced-change flag HERE, because this is the only place that
        // knows a password was actually changed.
        //
        // It used to be cleared by clearLegacyPasswordFlagAction — a separate
        // "use server" export that deleted the flag and verified nothing. The
        // reset page called it right after this function returned success, so
        // the FLOW was correct and the FUNCTION was independently addressable: a
        // user holding the temporary password an admin generated could call it
        // directly, clear the flag, and never change the password.
        //
        // What the flag does makes that matter. session-guard.ts and
        // hub-guard.ts both read requiresPasswordChange and force the user to
        // the reset page while it is set; auth.ts reads it at login. Clearing it
        // without a password change leaves the account on a credential a third
        // party issued, with the platform no longer asking about it.
        //
        // The same shape as autoEnrollPaidUser, whose own comment says it: the
        // call site was protected and the function was not.
        //
        // Best-effort, deliberately. The password is already changed in both
        // stores by this point; failing the whole operation because a flag write
        // failed would tell the user their password did not change when it did.
        // The worst case here is being asked to change it again.
        try {
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                requiresPasswordChange: FieldValue.delete(),
                passwordChangedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (flagErr: any) {
            logger.error("[changePassword] Password changed but the forced-change flag was not cleared", {
                userId: session.user.id,
                error: flagErr?.message,
            });
        }

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Error changing password:", error);
        return { success: false as const, error: error.message || "An unexpected error occurred. Please try again.", data: null };
    }
}
