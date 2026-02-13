"use server";

import { signIn, signOut } from "@/lib/auth";
import { db, adminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { registerSchema, loginSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { User as FirestoreUser } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { LEGACY_ROLE_MAP, type LegacyRole, type UserRole } from "@/lib/types/roles";
import { getPrimaryApp } from "@/lib/role-app-mapping";

/**
 * Server Actions for Authentication
 * 
 * These actions handle user login, registration, and logout
 * with Firebase and NextAuth v5 integration.
 */

export async function loginAction(prevState: any, formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const redirectTo = formData.get("redirectTo") as string; // Module-specific redirect

    try {
        // Validate with Zod
        const validatedData = loginSchema.parse({ email, password });

        // DO NOT MODIFY – AUTH STABILITY
        // Sign in first, then redirect explicitly (form actions don't handle NEXT_REDIRECT from signIn)
        await signIn("credentials", {
            email: validatedData.email,
            password: validatedData.password,
            redirect: false,
        });

        // DO NOT MODIFY – AUTH STABILITY
        // Explicit redirect required for form actions
        // Use module-specific redirectTo if provided, otherwise default to /dashboard
        redirect(redirectTo || "/dashboard");
        return { error: "", success: true }; // Defensive - redirect throws, but just in case


    } catch (error) {
        // DO NOT MODIFY – AUTH STABILITY  
        // Re-throw redirect to allow Next.js navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof error.digest === 'string' &&
            error.digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        logger.error("Login error", error);

        if (error instanceof AuthError) {
            switch (error.type) {
                case "CredentialsSignin":
                    return { error: "Invalid email or password", success: false };
                case "CallbackRouteError":
                    return { error: "Authentication failed. Please try again", success: false };
                default:
                    return { error: "An error occurred during login", success: false };
            }
        }

        if (error instanceof Error) {
            return { error: error.message, success: false };
        }

        return { error: "An unexpected error occurred", success: false };
    }
}

export async function registerAction(prevState: any, formData: FormData) {
    const fullName = formData.get("fullName") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;
    const gender = formData.get("gender") as "male" | "female";
    const platforms = formData.getAll("platforms[]") as string[]; // Multi-platform selection

    try {
        // Validate with Zod
        const validatedData = registerSchema.parse({
            fullName,
            email,
            password,
            confirmPassword,
        });

        // Validate platforms (at least one required)
        const allowedPlatforms = ["marketplace", "export", "cooperatives", "farm-nation", "academy", "wave"];
        if (!platforms || platforms.length === 0) {
            return { error: "Please select at least one platform", success: false };
        }

        // Validate all platforms are allowed
        const invalidPlatforms = platforms.filter(p => !allowedPlatforms.includes(p));
        if (invalidPlatforms.length > 0) {
            return { error: "Invalid platform selection", success: false };
        }

        // Create Firebase Auth user via Admin SDK
        const userRecord = await adminAuth.createUser({
            email: validatedData.email,
            password: validatedData.password,
            displayName: validatedData.fullName,
            emailVerified: true, // Auto-verify for now
        });

        // Build role set based on platform selections + gender
        const roles: Set<UserRole> = new Set(["general_user"]); // Everyone gets general_user

        // Map platform selections to roles
        if (platforms.includes("marketplace")) {
            roles.add("buyer");
            roles.add("seller");
        }
        if (platforms.includes("export")) {
            roles.add("export_participant");
        }
        if (platforms.includes("cooperatives")) {
            roles.add("cooperative_member");
        }
        if (platforms.includes("farm-nation")) {
            roles.add("investor"); // Default Farm Nation role (can upgrade to farmer/land_owner later)
        }
        if (platforms.includes("academy")) {
            roles.add("academy_participant"); // Explicit Academy access
        }

        // AUTO-GRANT WAVE for females
        if (gender === "female") {
            roles.add("wave_participant");
        }

        const userRoles = Array.from(roles);

        // Create Firestore user profile
        const userProfile: Omit<FirestoreUser, "createdAt" | "updatedAt"> = {
            uid: userRecord.uid,
            fullName: validatedData.fullName,
            email: validatedData.email,
            roles: userRoles,
            verified: false,
            gender: gender,
        };

        await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set({
            ...userProfile,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // REGISTRATION MUST ESTABLISH SESSION — DO NOT MODIFY
        // Determine primary app or use callback URL
        const callbackUrl = formData.get("callbackUrl") as string;
        const primaryApp = callbackUrl || getPrimaryApp(userProfile.roles);

        // Auto sign-in after registration and redirect to primary app or callback
        // redirect:false prevents session from being established on client
        // We MUST redirect to allow session cookie to be set
        await signIn("credentials", {
            email: validatedData.email,
            password: validatedData.password,
            redirect: false,
        });

        // Manual redirect to ensure cookie propagation
        redirect(primaryApp);

        // This line never executes because signIn redirects
        return { error: "", success: true };
    } catch (error: any) {
        // Re-throw redirect errors to allow Next.js to handle navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof error.digest === 'string' &&
            error.digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        logger.error("Registration error", error);

        // Handle Firebase auth errors
        if (error.code === "auth/email-already-in-use") {
            return { error: "An account with this email already exists", success: false };
        }
        if (error.code === "auth/weak-password") {
            return { error: "Password is too weak", success: false };
        }
        if (error.code === "auth/invalid-email") {
            return { error: "Invalid email address", success: false };
        }

        if (error instanceof Error) {
            return { error: error.message, success: false };
        }

        return { error: "Registration failed. Please try again", success: false };
    }
}

export async function logoutAction() {
    await signOut({ redirectTo: "/auth/login" });
}
