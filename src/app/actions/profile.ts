/**
 * Server Actions for User Profile Management
 */

"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db, adminAuth } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";

// Validation schemas
const profileUpdateSchema = z.object({
    firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    email: z.string().email("Please enter a valid email address").optional(),
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

        const splitName = (fullName: string) => {
            const parts = fullName.trim().split(/\s+/).filter(Boolean);
            return {
                first: parts[0] || "",
                last: parts.length > 1 ? parts.slice(1).join(" ") : "",
            };
        };

        const nameSplit = splitName(userData.fullName || "");

        return {
            success: true,
            profile: {
                firstName: userData.firstName || nameSplit.first,
                lastName: userData.lastName || nameSplit.last,
                email: userData.email || "",
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
        logger.error("Get user profile error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update user profile information
 * 
 * 🔒 SECURITY NOTE: 
 * Identity fields like 'gender' and 'dateOfBirth' are EXCLUDED from this action.
 * They are set once during registration/verification and should ONLY be changeable 
 * via a specific admin request to prevent "Identity Hopping" in programs like WAVE.
 */
export async function updateUserProfileAction(data: {
    firstName?: string;
    lastName?: string;
    email?: string;
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

        // If email is changing, update Firebase Auth as well (not just Firestore)
        if (validated.email && validated.email !== session.user.email) {
            try {
                await adminAuth.updateUser(userId, { email: validated.email });
            } catch (authErr: any) {
                logger.error("Firebase Auth email update failed:", authErr);
                if (authErr.code === 'auth/email-already-exists') {
                    return { success: false, error: "That email address is already in use by another account." };
                }
                return { success: false, error: "Failed to update email. Please try again." };
            }
        }

        // Update Firestore — also compute fullName from parts
        const updatePayload: Record<string, any> = {
            ...validated,
            updatedAt: new Date(),
        };
        if (validated.firstName || validated.lastName) {
            const existingDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const existing = existingDoc.data() || {};
            const first = validated.firstName ?? existing.firstName ?? existing.fullName?.split(' ')[0] ?? "";
            const last = validated.lastName ?? existing.lastName ?? existing.fullName?.split(' ').slice(1).join(' ') ?? "";
            updatePayload.fullName = `${first} ${last}`.trim();
        }
        await db.collection(COLLECTIONS.USERS).doc(userId).update(updatePayload);

        return { success: true };
    } catch (error: any) {
        logger.error("Update user profile error:", error);

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
        logger.error("Update notification preferences error:", error);

        if (error instanceof z.ZodError) {
            return { success: false, error: "Invalid preferences data" };
        }

        return { success: false, error: error.message };
    }
}
