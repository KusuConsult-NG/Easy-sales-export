"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Clear Legacy Password Flag Action
 * Removes the 'requiresPasswordChange' flag from a user's Firestore profile
 * after they have successfully updated their temporary password.
 */
export async function clearLegacyPasswordFlagAction() { try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        
        await userRef.update({ requiresPasswordChange: FieldValue.delete(),
            passwordChangedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        logger.info(`[clearLegacyPasswordFlagAction] Security flag cleared for user ${session.user.id}`);
        return { success: true as const, error: null };
    } catch (error: any) { logger.error("[clearLegacyPasswordFlagAction] Error clearing security flag", error);
        return { success: false as const, error: error.message, data: null };
    }
}
