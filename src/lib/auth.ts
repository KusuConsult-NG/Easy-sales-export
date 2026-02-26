import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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
                try {
                    // Validate credentials with Zod
                    const { email, password } = loginSchema.parse(credentials);

                    // Check rate limiting BEFORE attempting authentication
                    const { consumeLoginAttempt, resetLoginAttempts } = await import("@/lib/rate-limit");
                    const rateLimitResult = await consumeLoginAttempt(email);

                    if (!rateLimitResult.allowed) {
                        throw new Error(rateLimitResult.error || "Too many login attempts. Please try again later.");
                    }

                    // Authenticate with Firebase
                    const userCredential = await signInWithEmailAndPassword(
                        firebaseAuth,
                        email,
                        password
                    );

                    // Success: Reset rate limit counter
                    await resetLoginAttempts(email);

                    // Fetch user profile - CHECK CACHE FIRST
                    const { getUserProfile } = await import("@/lib/user-cache");
                    const cachedProfile = await getUserProfile(userCredential.user.uid);

                    if (cachedProfile) {
                        // Cache hit - use cached profile
                        console.log('[Auth] Using cached user profile for:', email);
                        return {
                            id: cachedProfile.id,
                            email: cachedProfile.email,
                            name: cachedProfile.displayName,
                            image: cachedProfile.photoURL || null,
                            roles: (cachedProfile.roles || []) as UserRole[],
                            verified: true,
                        };
                    }

                    // Cache miss - fetch from Firestore using Admin SDK
                    console.log('[Auth] Cache miss - fetching from Firestore:', email);
                    const { getAdminDb } = await import("@/lib/firebase-admin");
                    const adminDb = getAdminDb();

                    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(userCredential.user.uid).get();

                    if (!userDoc.exists) {
                        throw new Error("User profile not found in database");
                    }

                    const userData = userDoc.data() as FirestoreUser;

                    // 🔒 SECURITY FIX: Check for banned status
                    // 🔒 SECURITY FIX: Check for banned/suspended status
                    if ((userData as any).isBanned === true || (userData as any).status === 'banned' || (userData as any).suspended === true) {
                        logger.warn(`Blocked login attempt for suspended/banned user: ${email}`);
                        throw new Error("Your account has been suspended. Please contact support.");
                    }

                    // Cache the profile for next time
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

                    // Return user object for NextAuth session
                    return {
                        id: userCredential.user.uid,
                        email: userData.email,
                        name: userData.fullName,
                        image: null, // Placeholder for future profile image support
                        roles: userData.roles || [], // Multi-role support
                        verified: userData.verified ?? true, // Email verification status (default true for existing users)
                    };
                } catch (error: any) {
                    console.error("Authorization error:", error.message);
                    throw new Error(error.message || "Invalid credentials");
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
    debug: process.env.NODE_ENV === "development", // Enable debug logs in dev
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
