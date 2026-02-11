/**
 * Server Actions for User Profile Management
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";

// Validation schemas
const profileUpdateSchema = z.object({
    phone: z.string().optional(),
    location: z.string().optional(),
    bio: z.string().max(500).optional(),
});

const notificationPreferencesSchema = z.object({
    email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean(),
});

/**
 * Get user profile data
 */
export async function getUserProfileAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { success: false, error: "User profile not found" };
        }

        const userData = userDoc.data()!;

        return {
            success: true,
            profile: {
                phone: userData.phone || "",
                location: userData.location || "",
                bio: userData.bio || "",
                notifications: userData.notifications || {
                    email: true,
                    push: false,
                    sms: true,
                },
            },
        };
    } catch (error: any) {
        console.error("Get user profile error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update user profile information
 */
export async function updateUserProfileAction(data: {
    phone?: string;
    location?: string;
    bio?: string;
}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        // Validate input
        const validated = profileUpdateSchema.parse(data);

        const userId = session.user.id;

        // Update Firestore
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            ...validated,
            updatedAt: new Date(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update user profile error:", error);

        if (error instanceof z.ZodError) {
            return { success: false, error: "Invalid profile data" };
        }

        return { success: false, error: error.message };
    }
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferencesAction(preferences: {
    email: boolean;
    push: boolean;
    sms: boolean;
}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        // Validate input
        const validated = notificationPreferencesSchema.parse(preferences);

        const userId = session.user.id;

        // Update Firestore
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            notifications: validated,
            updatedAt: new Date(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update notification preferences error:", error);

        if (error instanceof z.ZodError) {
            return { success: false, error: "Invalid preferences data" };
        }

        return { success: false, error: error.message };
    }
}
