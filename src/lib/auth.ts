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
                    const rateLimitResult = await consumeLoginAttempt(email);

                    if (!rateLimitResult.allowed) {
                        throw new Error(rateLimitResult.error || "Too many login attempts. Please try again later.");
                    }

                    // ── STEP 4: Firebase authentication (REST API) ───────────
                    const response = await fetch(
                        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                email,
                                password,
                                returnSecureToken: true
                            })
                        }
                    );

                    const responseData = await response.json();

                    if (!response.ok) {
                        const errorCode = responseData.error?.message || "auth/internal-error";
                        console.error(`${authCtx} STEP 4 FAILED: Firebase REST API error: ${errorCode}`);
                        const error = new Error(errorCode);
                        (error as any).code = errorCode; // Match catch block structure
                        throw error;
                    }

                    const uid = responseData.localId;

                    // ── STEP 5: Reset rate limit on success ─────────────────
                    await resetLoginAttempts(email);

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
                        };
                    }

                    // ── STEP 7: Cache miss → fetch from Firestore ───────────
                    const { getAdminDb } = await import("@/lib/firebase-admin");
                    const adminDb = getAdminDb();

                    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(uid).get();

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

                    // ── STEP 9: Update profile cache ──────────────────────────
                    const { setCache, CacheKeys, CACHE_TTL } = await import("@/lib/redis");
                    await setCache(
                        CacheKeys.userProfile(uid),
                        {
                            id: uid,
                            email: userData.email,
                            displayName: userData.fullName,
                            photoURL: null,
                            roles: userData.roles || [],
                            serviceRegistrations: (userData as any).serviceRegistrations || {},
                            createdAt: userData.createdAt,
                            updatedAt: userData.updatedAt,
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
                        roles: userData.roles || [],
                        verified: userData.verified ?? true,
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
                        "auth/user-disabled": "Your account has been disabled. Please contact support.",
                        "auth/too-many-requests": "Too many attempts. Please try again later.",
                        "auth/network-request-failed": "Network error — please check your connection and try again.",
                        "auth/operation-not-allowed": "Email/password login is not enabled. Please contact support.",
                    };

                    const userMessage = firebaseErrorMap[code] || error?.message || "Authentication failed.";

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
            const { user } = params;
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
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
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
            console.warn(`🟠 [NEXTAUTH_FRAMEWORK_WARN] ${(code as any)?.name || code}:`, ...message);
        },
        debug(code, ...message) {
            console.log(`🔵 [NEXTAUTH_FRAMEWORK_DEBUG] ${(code as any)?.name || code}:`, ...message);
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
    }
}
