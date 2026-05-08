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
import { versionedUpdate } from "@/lib/optimistic-locking";
import { FieldValue } from "firebase-admin/firestore";

// Validation schemas
const profileUpdateSchema = z.object({ firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    otherName: z.string().max(50).optional(),
    email: strictEmailSchema.optional(),
    phone: strictPhoneSchema.optional(),
    location: z.string().optional(),
    bio: z.string().max(500).optional(),
    identityDocument: z.string().optional(),
    version: z.number().optional() });

const notificationPreferencesSchema = z.object({ email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean() });

/**
 * Get user profile data
 */
export const getUserProfileAction = withSafeAction("getUserProfileAction", async () => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
    const { session } = sessionResult;

    const userId = session.user.id;
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

    if (!userDoc.exists) { return { success: false as const, error: "User profile not found", data: null };
    }

    const userData = userDoc.data()!;

    const splitName = (fullName: string) => { const parts = fullName.trim().split(/\s+/).filter(Boolean);
        return {
            first: parts[0] || "",
            last: parts.length > 1 ? parts.slice(1).join(" ") : "" };
    };

    const nameSplit = splitName(userData.fullName || "");

    return { 
        error: null, 
        success: true as const, 
        data: {
            ...userData,
            firstName: nameSplit.first,
            lastName: nameSplit.last,
            version: userData._version || 0
        }
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
export const updateUserProfileAction = withSafeAction("updateUserProfileAction", async (data: { firstName?: string;
    lastName?: string;
    otherName?: string;
    email?: string;
    phone?: string;
    location?: string;
    bio?: string;
    identityDocument?: string;
    version?: number; }) => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
    const { session } = sessionResult;

    const validated = profileUpdateSchema.parse(data);
    const userId = session.user.id;

    if (validated.email && validated.email !== session.user.email) { try {
            await adminAuth.updateUser(userId, { email: validated.email });
        } catch (authErr: any) { logger.error("Firebase Auth email update failed:", authErr);
            if (authErr.code === 'auth/email-already-exists') {
                return { success: false as const, error: "That email address is already in use by another account.", data: null };
            }
            return { success: false as const, error: "Failed to update email. Please try again.", data: null };
        }
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

    await db.runTransaction(async (transaction) => {
        const existingDoc = await transaction.get(userRef);
        const existing = existingDoc.data() || {};

        const updatePayload: Record<string, any> = { ...validated,
            profileComplete: true };
        // Remove version from payload as it's handled by versionedUpdate
        delete updatePayload.version;

        if (validated.firstName || validated.lastName || validated.otherName) { const first = validated.firstName ?? existing.firstName ?? existing.fullName?.split(' ')[0] ?? "";
            const last = validated.lastName ?? existing.lastName ?? existing.fullName?.split(' ').slice(1).join(' ') ?? "";
            const other = validated.otherName ?? existing.otherName ?? "";
            updatePayload.fullName = [first, other, last].filter(Boolean).join(' ').trim();
        }

        await versionedUpdate(transaction, userRef, validated.version, updatePayload);
    });

    await invalidateUserCache(userId);

    return { error: null, success: true as const , data: null };
});

/**
 * Update notification preferences
 */
export const updateNotificationPreferencesAction = withSafeAction("updateNotificationPreferencesAction", async (preferences: { email: boolean;
    push: boolean;
    sms: boolean; }) => { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
    const { session } = sessionResult;

    // Validate input
    const validated = notificationPreferencesSchema.parse(preferences);

    const userId = session.user.id;

    // Update Firestore
    await db.collection(COLLECTIONS.USERS).doc(userId).update({ notifications: validated,
        updatedAt: new Date() });

    return { error: null, success: true as const , data: null };
});
