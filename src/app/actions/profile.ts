/**
 * Server Actions for User Profile Management
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db, adminAuth } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import { strictEmailSchema, strictPhoneSchema } from "@/lib/schemas";
import { withSafeAction } from "@/lib/safe-action";
import { invalidateUserCache } from "@/lib/cache-invalidation";

// Validation schemas
const profileUpdateSchema = z.object({
    firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    otherName: z.string().max(50).optional(),
    email: strictEmailSchema.optional(),
    phone: strictPhoneSchema.optional(),
    location: z.string().optional(),
    bio: z.string().max(500).optional(),
    identityDocument: z.string().optional(),
});

const notificationPreferencesSchema = z.object({
    email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean(),
});

/**
 * Get user profile data
 */
export const getUserProfileAction = withSafeAction("getUserProfileAction", async () => {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

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

    return { success: true, data: { profile: {
            firstName: userData.firstName || nameSplit.first,
            lastName: userData.lastName || nameSplit.last,
            otherName: userData.otherName || "",
            email: userData.email || "",
            phone: userData.phone || "",
            stateOfOrigin: userData.stateOfOrigin || "",
            lga: userData.lga || "",
            location: userData.location || "",
            bio: userData.bio || "",
            identityDocument: userData.identityDocument || "",
            notifications: userData.notifications || {
                email: true,
                push: false,
                sms: true, } },
        },
    };
});

/**
 * Update user profile information
 * 
 * 🔒 SECURITY NOTE: 
 * Identity fields like 'gender' and 'dateOfBirth' are EXCLUDED from this action.
 * They are set once during registration/verification and should ONLY be changeable 
 * via a specific admin request to prevent "Identity Hopping" in programs like WAVE.
 */
export const updateUserProfileAction = withSafeAction("updateUserProfileAction", async (data: {
    firstName?: string;
    lastName?: string;
    otherName?: string;
    email?: string;
    phone?: string;
    location?: string;
    bio?: string;
    identityDocument?: string;
}) => {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    // Validate input. ZodError will be beautifully handled by withSafeAction!
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
        // Mark profile as explicitly completed. The hub-guard checks this flag
        // as a fast-exit on every page load. Once set, the user NEVER sees the
        // profile completion screen again on future logins.
        profileComplete: true,
        updatedAt: new Date(),
    };
    if (validated.firstName || validated.lastName || validated.otherName) {
        const existingDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existing = existingDoc.data() || {};
        const first = validated.firstName ?? existing.firstName ?? existing.fullName?.split(' ')[0] ?? "";
        const last = validated.lastName ?? existing.lastName ?? existing.fullName?.split(' ').slice(1).join(' ') ?? "";
        const other = validated.otherName ?? existing.otherName ?? "";
        updatePayload.fullName = [first, other, last].filter(Boolean).join(' ').trim();
    }
    await db.collection(COLLECTIONS.USERS).doc(userId).update(updatePayload);

    // Invalidate Redis cache so hub-guard reads the fresh profileComplete flag
    await invalidateUserCache(userId);

    return { success: true };
});

/**
 * Update notification preferences
 */
export const updateNotificationPreferencesAction = withSafeAction("updateNotificationPreferencesAction", async (preferences: {
    email: boolean;
    push: boolean;
    sms: boolean;
}) => {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    // Validate input
    const validated = notificationPreferencesSchema.parse(preferences);

    const userId = session.user.id;

    // Update Firestore
    await db.collection(COLLECTIONS.USERS).doc(userId).update({
        notifications: validated,
        updatedAt: new Date(),
    });

    return { success: true };
});
