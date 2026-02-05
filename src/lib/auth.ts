import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth as firebaseAuth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import { loginSchema } from "./schemas";
import { COLLECTIONS } from "./types/firestore";
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
                        email: userCredential.user.email!,
                        name: userData.fullName,
                        role: userData.role,
                        verified: userData.verified,
                    };
                } catch (error: any) {
                    console.error("Authentication error:", error);

                    // Handle Firebase auth errors
                    if (error.code === "auth/invalid-credential") {
                        throw new Error("Invalid email or password");
                    }
                    if (error.code === "auth/user-not-found") {
                        throw new Error("No account found with this email");
                    }
                    if (error.code === "auth/wrong-password") {
                        throw new Error("Incorrect password");
                    }
                    if (error.code === "auth/too-many-requests") {
                        throw new Error("Too many failed attempts. Please try again later");
                    }

                    throw new Error(error.message || "Authentication failed. Please try again");
                }
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            // Attach user data to JWT on sign in
            if (user) {
                token.id = user.id;
                token.role = user.role;
                token.verified = user.verified;
            }
            return token;
        },
        async session({ session, token }) {
            // Attach user data to session from JWT
            if (session.user) {
                session.user.id = token.id as string;
                session.user.role = token.role as "member" | "exporter" | "admin" | "vendor" | "super_admin";
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
declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            email: string;
            name: string;
            role: "member" | "exporter" | "admin" | "vendor" | "super_admin";
            verified: boolean;
        };
    }

    interface User {
        id: string;
        email: string;
        name: string;
        role: "member" | "exporter" | "admin" | "vendor" | "super_admin";
        verified: boolean;
    }
}

declare module "@auth/core/jwt" {
    interface JWT {
        id: string;
        role: "member" | "exporter" | "admin" | "vendor" | "super_admin";
        verified: boolean;
    }
}
