import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth as firebaseAuth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
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

                    // Fetch user profile from Firestore
                    const userDocRef = doc(db, COLLECTIONS.USERS, userCredential.user.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (!userDoc.exists()) {
                        throw new Error("User profile not found in database");
                    }

                    const userData = userDoc.data() as FirestoreUser;

                    // Success: Reset rate limit counter
                    await resetLoginAttempts(email);

                    // Return user object for NextAuth session
                    return {
                        id: userCredential.user.uid,
                        email: userData.email,
                        name: userData.fullName,
                        roles: userData.roles || [], // Multi-role support
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
                token.roles = user.roles; // Multi-role support
            }

            return token;
        },
        async session({ session, token }) {
            // Add user info to session
            if (session.user) {
                session.user.id = token.id as string;
                session.user.email = token.email as string;
                session.user.name = token.name as string;
                session.user.roles = (token.roles as UserRole[]) || []; // Multi-role support
                session.user.verified = token.verified as boolean;
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
        roles: UserRole[]; // Multi-role support
    }

    interface Session {
        user: {
            id: string;
            email: string;
            name: string;
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
        roles: UserRole[]; // Multi-role support
        verified: boolean;
    }
}
