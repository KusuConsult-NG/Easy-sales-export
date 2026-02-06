"use server";

import { signIn, signOut } from "@/lib/auth";
import { auth as firebaseAuth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { registerSchema, loginSchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { User as FirestoreUser } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Server Actions for Authentication
 * 
 * These actions handle user login, registration, and logout
 * with Firebase and NextAuth v5 integration.
 */

export async function loginAction(prevState: any, formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
        // Validate with Zod
        const validatedData = loginSchema.parse({ email, password });

        // Sign in with NextAuth - redirectTo will trigger redirect on success
        await signIn("credentials", {
            email: validatedData.email,
            password: validatedData.password,
            redirectTo: "/dashboard",
        });

        // This won't be reached due to redirect, but needed for TypeScript
        return { error: "", success: true };

    } catch (error) {
        // Re-throw redirect errors to allow Next.js to handle navigation
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof (error as any).digest === 'string' &&
            (error as any).digest.startsWith('NEXT_REDIRECT')) {
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
    const gender = formData.get("gender") as string;
    const role = formData.get("role") as string;

    try {
        // Validate with Zod
        const validatedData = registerSchema.parse({
            fullName,
            email,
            password,
            confirmPassword,
        });

        // Validate role
        const allowedRoles = ["member", "exporter", "vendor"];
        if (!role || !allowedRoles.includes(role)) {
            return { error: "Please select a valid account type", success: false };
        }

        // Create Firebase Auth user
        const userCredential = await createUserWithEmailAndPassword(
            firebaseAuth,
            validatedData.email,
            validatedData.password
        );

        // Create Firestore user profile
        const userProfile: Omit<FirestoreUser, "createdAt" | "updatedAt"> = {
            uid: userCredential.user.uid,
            fullName: validatedData.fullName,
            email: validatedData.email,
            role: role as "member" | "exporter" | "admin" | "vendor" | "super_admin",
            verified: true, // No email verification implemented
            gender: gender as "male" | "female" | undefined,
        };

        await setDoc(doc(db, COLLECTIONS.USERS, userCredential.user.uid), {
            ...userProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Auto sign-in after registration (with redirect to dashboard)
        await signIn("credentials", {
            email: validatedData.email,
            password: validatedData.password,
            redirectTo: "/dashboard",
        });

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
