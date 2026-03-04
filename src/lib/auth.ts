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
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth as firebaseAuth } from "./firebase";
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
                try {
                    // ── STEP 1: Env var guard ─────────────────────────────────
                    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
                    if (!firebaseApiKey || firebaseApiKey === "mock-api-key-for-build") {
                        console.error(`${authCtx} FATAL: NEXT_PUBLIC_FIREBASE_API_KEY is missing or mock. Login will fail. Set it in Vercel → Settings → Environment Variables.`);
                        throw new Error("Service configuration error. Please contact support.");
                    }

                    // ── STEP 2: Validate credentials ─────────────────────────
                    console.log(`${authCtx} authorize() called`);
                    const { email, password } = loginSchema.parse(credentials);
                    console.log(`${authCtx} credentials valid for: ${email}`);

                    // ── STEP 3: Rate limit check ─────────────────────────────
                    const { consumeLoginAttempt, resetLoginAttempts } = await import("@/lib/rate-limit");
                    const rateLimitResult = await consumeLoginAttempt(email);
                    console.log(`${authCtx} rate limit check: allowed=${rateLimitResult.allowed}`);

                    if (!rateLimitResult.allowed) {
                        throw new Error(rateLimitResult.error || "Too many login attempts. Please try again later.");
                    }

                    // ── STEP 4: Firebase authentication ────────────────────── 
                    console.log(`${authCtx} calling Firebase signInWithEmailAndPassword...`);
                    const userCredential = await signInWithEmailAndPassword(
                        firebaseAuth,
                        email,
                        password
                    );
                    console.log(`${authCtx} Firebase auth OK — uid: ${userCredential.user.uid}`);

                    // ── STEP 5: Reset rate limit on success ─────────────────
                    await resetLoginAttempts(email);

                    // ── STEP 6: Fetch user profile (cache-first) ─────────────
                    console.log(`${authCtx} checking profile cache...`);
                    const { getUserProfile } = await import("@/lib/user-cache");
                    const cachedProfile = await getUserProfile(userCredential.user.uid);

                    if (cachedProfile) {
                        console.log(`${authCtx} cache HIT — returning cached profile`);
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
                    console.log(`${authCtx} cache MISS — fetching from Firestore...`);
                    const { getAdminDb } = await import("@/lib/firebase-admin");
                    const adminDb = getAdminDb();

                    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(userCredential.user.uid).get();
                    console.log(`${authCtx} Firestore doc exists: ${userDoc.exists}`);

                    if (!userDoc.exists) {
                        console.error(`${authCtx} No user doc in Firestore for UID: ${userCredential.user.uid}`);
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
                        CacheKeys.userProfile(userCredential.user.uid),
                        {
                            id: userCredential.user.uid,
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

                    console.log(`${authCtx} authorize() SUCCESS — returning user object for ${email}`);
                    // Return user object for NextAuth session
                    return {
                        id: userCredential.user.uid,
                        email: userData.email,
                        name: userData.fullName,
                        image: null,
                        roles: userData.roles || [],
                        verified: userData.verified ?? true,
                    };
                } catch (error: any) {
                    // ── CRITICAL: Log the REAL error BEFORE mapping it ────────
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

                    const userMessage = firebaseErrorMap[code] || error.message || "Authentication failed.";
                    // NOTE: Must throw CredentialsSignin (not plain Error) — NextAuth v5
                    // maps any plain Error from authorize() to the generic 'Configuration' page.
                    throw new AuthError(userMessage);
                }
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            // On sign in, store user info in JWT
            if (user) {
                token.id = user.id;
                token.email = user.email;
                token.name = user.name;
                token.image = user.image;
                token.roles = user.roles;
                token.verified = user.verified ?? true;
                // Clear any stale cached Firebase token on fresh sign-in
                token.firebaseToken = undefined;
                token.firebaseTokenMintedAt = undefined;
            }
            return token;
        },
        async session({ session, token }) {
            // Add user info to session
            if (session.user) {
                session.user.id = token.id as string;
                session.user.email = token.email as string;
                session.user.name = token.name as string;
                session.user.image = token.image as string | null;
                session.user.roles = (token.roles as UserRole[]) || [];
                session.user.verified = token.verified as boolean;

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
    // CRITICAL: Allow login on localhost even in production mode (if using http)
    cookies: {
        sessionToken: {
            name: `next-auth.session-token`,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: process.env.NODE_ENV === "production" && process.env.NEXTAUTH_URL?.startsWith("https"),
            },
        },
    },
    secret: process.env.NEXTAUTH_SECRET,
    debug: process.env.NODE_ENV === "development" || process.env.NEXTAUTH_DEBUG === "true",
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
