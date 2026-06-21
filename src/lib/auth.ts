import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Custom error class for NextAuth v5.
 * NextAuth ONLY surfaces errors that extend CredentialsSignin.
 * Throwing a plain Error() always shows the generic 'Configuration' page.
 */
class AuthError extends CredentialsSignin {
    constructor(message: string) {
        super(message);
        this.code = message;
    }
}
// Using Firebase REST API for backend auth to avoid Vercel Node environment crashes
// instead of importing the browser-targeted "firebase/auth" client SDK.
import { logger } from "@/lib/logger";
import { loginSchema } from "./schemas";
import { COLLECTIONS, type UserRole } from "./types/firestore";
import type { User as FirestoreUser } from "./types/firestore";
import { authConfig } from "./auth.config";
import { runQueryWithRetry } from "@/lib/firestore-utils";

/**
 * NextAuth v5 Configuration
 * 
 * Integrates Firebase Authentication with NextAuth for session management
 * and protected route implementation.
 */

// Export real NextAuth configuration
export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            authorize: async (credentials) => {
                const authCtx = `[Auth:${Date.now()}]`; // per-request log prefix
                logger.info(`${authCtx} authorize start`);
                try {
                    // ── STEP 1: Env var guard ─────────────────────────────────

                    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
                    if (!firebaseApiKey || firebaseApiKey === "mock-api-key-for-build") {
                        console.error(`${authCtx} FATAL: NEXT_PUBLIC_FIREBASE_API_KEY is missing or mock.`);
                        throw new Error("Service configuration error. Please contact support.");
                    }

                    // ── STEP 2: Validate credentials ─────────────────────────
                    const { email, password } = loginSchema.parse(credentials);

                    // ── STEP 3: Rate limit check ─────────────────────────────
                    const { consumeLoginAttempt, resetLoginAttempts } = await import("@/lib/rate-limit");
                    try {
                        const rateLimitResult = await consumeLoginAttempt(email);
                        if (!rateLimitResult.allowed) {
                            throw new Error(rateLimitResult.error || "Too many login attempts. Please try again later.");
                        }
                    } catch (err: any) {
                        // CIRCUIT BREAKER: Fail Open
                        // If Upstash Redis times out or crashes, do NOT block the login.
                        if (err.message && err.message.includes("Too many login attempts")) {
                            throw err; // Real rate limit
                        }
                        logger.error(`[Auth:Fallback] Redis consumeLoginAttempt failed, failing open. Error: ${err.message}`);
                    }

                    // ── STEP 4: Firebase authentication (REST API) ───────────
                    const responseData = await runQueryWithRetry(async () => {
                        const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
                        const signInUrl = authEmulatorHost
                            ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`
                            : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`;
                        const res = await fetch(
                            signInUrl,
                            {
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
                            }
                        );
                        const data = await res.json();
                        if (!res.ok) {
                            const errorCode = data.error?.message || "auth/internal-error";
                            console.error(`${authCtx} STEP 4 FAILED: Firebase REST API error: ${errorCode}`);
                            const error = new Error(errorCode);
                            (error as any).code = errorCode; // Match catch block structure
                            (error as any).status = res.status;
                            (error as any).data = data;
                            throw error;
                        }
                        return data;
                    });

                    const uid = responseData.localId;

                    // ── STEP 5: Reset rate limit on success ─────────────────
                    try {
                        await resetLoginAttempts(email);
                    } catch (err: any) {
                        logger.error(`[Auth:Fallback] Redis resetLoginAttempts failed. Error: ${err.message}`);
                    }

                    // ── STEP 6: Fetch user profile (cache-first) ─────────────
                    const { getUserProfile } = await import("@/lib/user-cache");
                    const cachedProfile = await getUserProfile(uid);

                    if (cachedProfile) {
                        return {
                            id: cachedProfile.id,
                            email: cachedProfile.email,
                            name: cachedProfile.displayName,
                            image: cachedProfile.photoURL || null,
                            roles: (cachedProfile.roles || []) as UserRole[],
                            verified: true,
                            serviceRegistrations: cachedProfile.serviceRegistrations || {},
                            gender: cachedProfile.gender as "male" | "female" | undefined,
                        };
                    }

                    // ── STEP 7: Cache miss → fetch from Firestore ───────────
                    const { getAdminDb } = await import("@/lib/firebase-admin");
                    const adminDb = getAdminDb();

                    const userDoc = await runQueryWithRetry(() => adminDb.collection(COLLECTIONS.USERS).doc(uid).get());

                    if (!userDoc.exists) {
                        console.error(`${authCtx} No user doc in Firestore for UID: ${uid}`);
                        throw new Error("User profile not found in database");
                    }

                    const userData = userDoc.data() as FirestoreUser;

                    // ── STEP 8: Ban/suspend check ─────────────────────────────
                    if ((userData as any).isBanned === true || (userData as any).status === 'banned' || (userData as any).suspended === true) {
                        logger.warn(`${authCtx} blocked — banned/suspended user: ${email}`);
                        throw new Error("Your account has been suspended. Please contact support.");
                    }

                    // ── STEP 8.5: Track Active Users ─────────────────────────────
                    try {
                        const { FieldValue } = await import("firebase-admin/firestore");
                        await runQueryWithRetry(() => adminDb.collection(COLLECTIONS.USERS).doc(uid).update({
                            lastLoginAt: FieldValue.serverTimestamp()
                        }));
                    } catch (e: any) {
                        logger.error(`${authCtx} Failed to update lastLoginAt: ${e.message}`);
                    }

                    // ── STEP 9: Update profile cache ──────────────────────────
                    const { setCache, CacheKeys, CACHE_TTL } = await import("@/lib/redis");
                    await setCache(
                        CacheKeys.userProfile(uid),
                        {
                            ...userData,
                            id: uid,
                            displayName: userData.fullName, // Keep for backward compatibility
                            photoURL: null,
                            roles: userData.roles || [],
                            serviceRegistrations: (userData as any).serviceRegistrations || {},
                            lastLoginAt: new Date().toISOString()
                        },
                        CACHE_TTL.USER_PROFILE
                    );

                    logger.info(`${authCtx} authorize success for ${email}`);
                    // Return user object for NextAuth session
                    return {
                        id: uid,
                        email: userData.email,
                        name: userData.fullName,
                        image: null,
                        roles: (userData.roles || []) as UserRole[],
                        verified: userData.verified ?? true,
                        serviceRegistrations: userData.serviceRegistrations || {},
                        gender: userData.gender as "male" | "female" | undefined,
                        createdAt: userData.createdAt,
                    };
                } catch (error: any) {
                    // ── CRITICAL: Log the REAL error BEFORE mapping it ────────
                    console.error(`${authCtx} --- AUTHORIZE CATCH BLOCK ---`);
                    // This is the single most important log for debugging production
                    // auth failures. The mapped message shown to the user is safe,
                    // but the raw code here tells you exactly what Firebase/Firestore
                    // actually threw.
                    const code: string = error?.code || "";
                    const msg: string = error?.message || "(no message)";
                    console.error(
                        `[Auth] authorize() FAILED — ` +
                        `firebase_code: "${code || '(none)'}" | ` +
                        `message: "${msg}" | ` +
                        `env_api_key_set: ${!!process.env.NEXT_PUBLIC_FIREBASE_API_KEY} | ` +
                        `env_project_id_set: ${!!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID} | ` +
                        `env_admin_key_set: ${!!process.env.FIREBASE_PRIVATE_KEY}`
                    );

                    const firebaseErrorMap: Record<string, string> = {
                        "auth/invalid-api-key": "Service configuration error. Please contact support.",
                        "auth/app-not-authorized": "Service configuration error. Please contact support.",
                        "auth/invalid-credential": "Invalid email or password.",
                        "auth/wrong-password": "Invalid email or password.",
                        "auth/user-not-found": "Invalid email or password.",
                        "INVALID_LOGIN_CREDENTIALS": "Invalid email or password.",
                        "INVALID_PASSWORD": "Invalid email or password.",
                        "EMAIL_NOT_FOUND": "Invalid email or password.",
                        "auth/user-disabled": "Your account has been disabled. Please contact support.",
                        "USER_DISABLED": "Your account has been disabled. Please contact support.",
                        "auth/too-many-requests": "Too many attempts. Please try again later.",
                        "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Please try again later.",
                        "auth/network-request-failed": "Network error — please check your connection and try again.",
                        "auth/operation-not-allowed": "Email/password login is not enabled. Please contact support.",
                        "OPERATION_NOT_ALLOWED": "Email/password login is not enabled. Please contact support.",
                    };

                    // Only fallback to error.message if it's not the exact raw ALL_CAPS string code 
                    // (prevents ugly raw strings in UI if mapping misses something)
                    const isTransient = msg.includes("Premature close") || 
                                        msg.includes("socket hang up") || 
                                        msg.includes("ECONNRESET") ||
                                        msg.includes("Client network socket disconnected") ||
                                        msg.includes("FetchError") ||
                                        msg.includes("fetch failed") ||
                                        msg.includes("Connection closed") ||
                                        msg.includes("Socket closed") ||
                                        msg.includes("UNAVAILABLE") ||
                                        msg.includes("stream terminated") ||
                                        msg.includes("ERR_STREAM_PREMATURE_CLOSE");
                    let userMessage = firebaseErrorMap[code] || firebaseErrorMap[error?.message] || "Authentication failed.";
                    if (isTransient) {
                        userMessage = "A temporary connection issue occurred. Please try again.";
                    } else if (!firebaseErrorMap[code] && !firebaseErrorMap[error?.message] && error?.message && !/^[A-Z_]+$/.test(error?.message)) {
                        userMessage = error.message;
                    }

                    console.error("Throwing AuthError with message:", userMessage, "Original error:", error);

                    // NOTE: Must throw CredentialsSignin (not plain Error) — NextAuth v5
                    // maps any plain Error from authorize() to the generic 'Configuration' page.
                    throw new AuthError(userMessage);
                }
            },
        }),
    ],
    callbacks: {
        async jwt(params) {
            // 1. Run base Edge mapping
            let token = params.token;
            if (authConfig.callbacks?.jwt) {
                token = (await authConfig.callbacks.jwt(params)) || token;
            }

            // 2. Node-specific logic
            const { user, trigger } = params;

            // Safe helper to parse Firestore Timestamps, JSON formats, Dates, and Strings
            const parseDate = (val: any): string | undefined => {
                if (!val) return undefined;
                try {
                    if (typeof val.toDate === "function") {
                        const d = val.toDate();
                        return isNaN(d.getTime()) ? undefined : d.toISOString();
                    }
                    const secs = typeof val._seconds === "number" ? val._seconds : val.seconds;
                    const nanos = typeof val._nanoseconds === "number" ? val._nanoseconds : val.nanoseconds;
                    if (typeof secs === "number") {
                        const ms = secs * 1000 + (typeof nanos === "number" ? nanos / 1000000 : 0);
                        const d = new Date(ms);
                        return isNaN(d.getTime()) ? undefined : d.toISOString();
                    }
                    const d = new Date(val);
                    return isNaN(d.getTime()) ? undefined : d.toISOString();
                } catch {
                    return undefined;
                }
            };

            // Session Refresh / Sync Protocol - ALWAYS synchronize live roles from database/cache
            if (token.id) {
                const now = Date.now();
                const lastSynced = token.lastSyncedAt as number | undefined;
                const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

                if (trigger === "update" || !lastSynced || (now - lastSynced) > SYNC_INTERVAL) {
                    try {
                        const { getUserProfile } = await import("@/lib/user-cache");
                        const cachedProfile = await getUserProfile(token.id as string);
                        if (cachedProfile) {
                            token.roles = cachedProfile.roles || [];
                            token.verified = cachedProfile.displayName ? (cachedProfile as any).verified ?? true : true; // default to true if legacy profile structure
                            token.onboardingCompleted = (cachedProfile as any).onboardingCompleted;
                            token.sellerVerificationStatus = (cachedProfile as any).sellerVerificationStatus;
                            token.serviceRegistrations = cachedProfile.serviceRegistrations || {};
                            token.isBanned = cachedProfile.isBanned || cachedProfile.status === "banned" || cachedProfile.suspended || false;
                            token.gender = cachedProfile.gender;
                            const cachedCreatedAt = (cachedProfile as any).createdAt;
                            if (cachedCreatedAt) {
                                token.createdAt = parseDate(cachedCreatedAt);
                            }
                            token.lastSyncedAt = now;
                        } else {
                            // Cache miss (invalidated by admin approval) and getUserProfile returned null.
                            // Fall back to a direct Firestore read so the token is never stale
                            // after an admin grants a new role or approves a service registration.
                            try {
                                const { getAdminDb } = await import("@/lib/firebase-admin");
                                const db = getAdminDb();
                                const userSnap = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(token.id as string).get());
                                if (userSnap.exists) {
                                    const userData = userSnap.data()!;
                                    token.roles = userData.roles || [];
                                    token.verified = userData.verified ?? true;
                                    token.onboardingCompleted = userData.onboardingCompleted;
                                    token.sellerVerificationStatus = userData.sellerVerificationStatus;
                                    token.serviceRegistrations = userData.serviceRegistrations || {};
                                    token.isBanned = userData.isBanned || userData.status === "banned" || userData.suspended || false;
                                    token.gender = userData.gender;
                                    const fsCreatedAt = userData.createdAt;
                                    if (fsCreatedAt) {
                                        token.createdAt = parseDate(fsCreatedAt);
                                    }
                                    token.lastSyncedAt = now;
                                }
                            } catch (fsErr) {
                                console.error("[NextAuth JWT] Firestore fallback failed after cache miss", fsErr);
                            }
                        }
                    } catch (e) {
                        console.error("[NextAuth JWT] Failed to sync session from database", e);
                    }
                }
            }

            if (user) {
                // Clear any stale cached Firebase token on fresh sign-in
                token.firebaseToken = undefined;
                token.firebaseTokenMintedAt = undefined;
            }
            return token;
        },
        async session(params) {
            // 1. Run base Edge mapping
            let session = params.session;
            const { token } = params;

            if (authConfig.callbacks?.session) {
                session = (await authConfig.callbacks.session(params)) || session;
            }

            // 2. Node-specific Firebase logic
            if (session.user) {
                // Instantly block session and clear Firebase custom token if user is banned (M-10)
                if (token.isBanned) {
                    session.firebaseToken = undefined;
                    token.firebaseToken = undefined;
                    session.user = null as any;
                    return session;
                }

                // Firebase custom token caching strategy:
                // Tokens expire after 60 minutes. We cache in the JWT and only
                // re-mint when the cached token is older than 50 minutes.
                // This saves ~150ms per page load for 100k+ users.
                const FIFTY_MINUTES_MS = 50 * 60 * 1000;
                const cachedToken = token.firebaseToken as string | undefined;
                const mintedAt = token.firebaseTokenMintedAt as number | undefined;
                const now = Date.now();
                const isTokenFresh = cachedToken && mintedAt && (now - mintedAt) < FIFTY_MINUTES_MS;

                if (token.id) {
                    if (isTokenFresh) {
                        // Reuse cached token — skip expensive createCustomToken call
                        session.firebaseToken = cachedToken;
                    } else {
                        // Mint fresh token and cache it in the JWT
                        try {
                            const { getAdminAuth } = await import("@/lib/firebase-admin");
                            const adminAuth = getAdminAuth();
                            const freshToken = await adminAuth.createCustomToken(token.id as string, {
                                roles: (token.roles as any[]) || [],
                                verified: (token.verified as boolean) ?? true,
                            });
                            session.firebaseToken = freshToken;
                            // Cache in JWT for subsequent requests
                            token.firebaseToken = freshToken;
                            token.firebaseTokenMintedAt = now;
                        } catch (error) {
                            console.error("Failed to mint Firebase custom token:", error);
                            // Fallback: use stale cached token if available
                            if (cachedToken) {
                                session.firebaseToken = cachedToken;
                            }
                        }
                    }
                }
            }
            return session;
        },
    },
    pages: {
        signIn: "/auth/login",
        error: "/auth/error",
    },
    session: {
        strategy: "jwt",
        maxAge: 8 * 60 * 60, // 8 hours — financial platform security standard
        updateAge: 60 * 60, // Refresh session token every 1 hour of activity
    },
    // NextAuth v5 automatically handles secure cookies in production with '__Secure-'
    // prefix and correct SameSite settings. Custom overrides prevent session
    // persistence on Vercel deployments.
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV !== "production" ? "e2e_development_auth_secret_placeholder_must_be_changed_in_production" : undefined),
    debug: process.env.NODE_ENV === "development" || process.env.NEXTAUTH_DEBUG === "true",

    // ── THE FIX: Verbose Internal Logging ────────────────────────────────────
    // NextAuth actively swallows CSRF errors and internal router crashes for security.
    // This explicitly surfaces them in the Vercel logs so a developer can see exactly
    // why a login attempt was silently dropped.
    logger: {
        error(code, ...message) {
            console.error(`🔴 [NEXTAUTH_FRAMEWORK_ERROR] ${(code as any)?.name || code}:`, ...message);
        },
        warn(code, ...message) {
            if (code === "debug-enabled") return; // Silence the expected debug warning
            console.warn(`🟠 [NEXTAUTH_FRAMEWORK_WARN] ${(code as any)?.name || code}:`, ...message);
        },
        debug(code, ...message) {
            // Disabled trace level debug to prevent terminal spam
            // console.log(`🔵 [NEXTAUTH_FRAMEWORK_DEBUG] ${(code as any)?.name || code}:`, ...message);
        }
    }
});

/**
 * Type augmentation for NextAuth
 * Extends the default session and user types with custom fields
 */
// TypeScript module augmentation for NextAuth

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            email: string;
            name?: string | null;
            image?: string | null;
            roles: UserRole[];
            verified: boolean;
            onboardingCompleted?: boolean;
            sellerVerificationStatus?: string;
            serviceRegistrations?: Record<string, any>;
            currentModuleId?: string;
            gender?: "male" | "female" | "other";
            createdAt?: string;
        };
        firebaseToken?: string;
    }

    interface User {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
        roles: UserRole[];
        verified: boolean;
        onboardingCompleted?: boolean;
        sellerVerificationStatus?: string;
        serviceRegistrations?: Record<string, any>;
        currentModuleId?: string;
        gender?: "male" | "female" | "other";
        createdAt?: string;
    }
}
