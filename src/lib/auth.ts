import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth as firebaseAuth } from "./firebase";
import { loginSchema } from "./schemas";
import { COLLECTIONS, type UserRole } from "./types/firestore";
import type { User as FirestoreUser } from "./types/firestore";

/**
 * NextAuth v5 Configuration
 * 
 * Integrates Firebase Authentication with NextAuth for session management
 * and protected route implementation.
 */

// Export real NextAuth configuration
export const { handlers, signIn, signOut, auth } = NextAuth({
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
        async jwt({ token, user, trigger }) {
            // On sign in, store user info in JWT
            if (user) {
                token.id = user.id;
                token.email = user.email;
                token.name = user.name;
                token.image = user.image;
                token.roles = user.roles; // Multi-role support
                token.verified = user.verified ?? true; // Email verification status

                // CRITICAL: Generate Firebase Custom Token for client-side SDK authentication
                try {
                    const { getAdminAuth } = await import("@/lib/firebase-admin");
                    const adminAuth = getAdminAuth();
                    // Create custom token with claims matching the user's role
                    const customToken = await adminAuth.createCustomToken(user.id, {
                        roles: user.roles,
                        verified: user.verified ?? true
                    });
                    token.firebaseToken = customToken;
                } catch (error) {
                    console.error("Failed to generate custom token:", error);
                }
            }

            // Ensure Firebase Custom Token exists (mint if missing or expired check could go here)
            // We mint it if it's missing, which handles existing sessions and new logins
            if (!token.firebaseToken && token.id) {
                try {
                    const { getAdminAuth } = await import("@/lib/firebase-admin");
                    const adminAuth = getAdminAuth();
                    const roles = (token.roles as any[]) || [];
                    const verified = (token.verified as boolean) ?? true;

                    // Create custom token
                    const customToken = await adminAuth.createCustomToken(token.id as string, {
                        roles,
                        verified
                    });
                    token.firebaseToken = customToken;
                } catch (error) {
                    console.error("Failed to generate custom token in JWT callback:", error);
                }
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
                session.user.roles = (token.roles as UserRole[]) || []; // Multi-role support
                session.user.verified = token.verified as boolean;

                // Pass custom token to client
                if (token.firebaseToken) {
                    session.firebaseToken = token.firebaseToken as string;
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
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    secret: process.env.NEXTAUTH_SECRET,
});

/**
 * Type augmentation for NextAuth
 * Extends the default session and user types with custom fields
 */
// TypeScript module augmentation for NextAuth
declare module "next-auth" {
    interface User {
        id: string;
        email: string;
        name: string;
        image?: string | null;
        roles: UserRole[]; // Multi-role support
        verified?: boolean; // Email verification status
        serviceRegistrations?: any; // Service access tracking
    }

    interface Session {
        firebaseToken?: string; // Custom token for Firebase SDK
        user: {
            id: string;
            email: string;
            name: string;
            image?: string | null;
            roles: UserRole[]; // Multi-role support
            verified: boolean;
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        id: string;
        email: string;
        name: string;
        image?: string | null;
        roles: UserRole[]; // Multi-role support
        verified: boolean;
        firebaseToken?: string;
    }
}
