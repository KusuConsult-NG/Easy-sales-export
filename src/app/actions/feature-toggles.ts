"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { DEFAULT_TOGGLES, resolveToggle, type FeatureToggle } from "@/lib/feature-toggles";
import { createAdminAuditLog } from "@/lib/audit-log";

/**
 * Get feature toggle state
 * Returns default if not found in database
 */
export async function getFeatureToggle(featureName: string): Promise<boolean> { try {
        const toggleRef = db.collection(COLLECTIONS.FEATURE_TOGGLES).doc(featureName);
        const toggleDoc = await toggleRef.get();

        return resolveToggle(featureName, {
            stored: toggleDoc.exists ? (toggleDoc.data() as FeatureToggle).enabled : undefined,
        });
    } catch (error) {
        // A READ FAILURE IS NOT A DEFAULT (#245). This returned
        // DEFAULT_TOGGLES on error, and seven of those default to true — so any
        // transient database error re-enabled a feature an admin had killed.
        // See resolveToggle in lib/feature-toggles.ts.
        logger.error(`Failed to get feature toggle for ${featureName} — failing CLOSED:`, error);
        return resolveToggle(featureName, { readFailed: true });
    }
}

/**
 * Update feature toggle state (admin only)
 */
export async function updateFeatureToggle(
    featureName: string,
    enabled: boolean
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;

        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) { return { success: false as const, error: "Unauthorized: Admin access required"};
        }

        const toggleRef = db.collection(COLLECTIONS.FEATURE_TOGGLES).doc(featureName);
        const toggleDoc = await toggleRef.get();

        const previousState = toggleDoc.exists ? (toggleDoc.data() as FeatureToggle).enabled : DEFAULT_TOGGLES[featureName];

        if (toggleDoc.exists) { // Update existing toggle
            await toggleRef.update({
                enabled,
                updatedAt: FieldValue.serverTimestamp() });
        } else {
            // Create new toggle
            await toggleRef.set({
                id: featureName,
                name: featureName,
                description: `Feature toggle for ${featureName}`,
                enabled,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdBy: session.user.id });
        }

        // Audit log
        await createAdminAuditLog({ action: "feature_toggled",
            userId: session.user.id,
            userEmail: session.user.email || "",
            targetId: featureName,
            targetType: "feature_toggle",
            metadata: {
                featureName,
                previousState,
                newState: enabled },
            details: `Feature '${featureName}' ${enabled ? "enabled" : "disabled"}` });

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Failed to update feature toggle:", error);
        return { success: false as const, error: error.message || "Failed to update toggle"};
    }
}

/**
 * Get all feature toggles (admin only)
 */
export async function getAllFeatureToggles(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;

        if (!session?.user || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) { return { success: false as const, error: "Unauthorized: Admin access required"};
        }

        const togglesRef = db.collection(COLLECTIONS.FEATURE_TOGGLES);
        const snapshot = await togglesRef.get();

        const toggles = snapshot.docs.map(doc => doc.data() as FeatureToggle);

        return { error: null,  success: true as const, data: toggles};
    } catch (error: any) { logger.error("Failed to get feature toggles:", error);
        return { success: false as const, error: error.message || "Failed to fetch toggles"};
    }
}

/**
 * Check if user has access to feature based on toggle settings
 */
export async function hasFeatureAccess(
    featureName: string,
    userId: string,
    userRole?: string
): Promise<boolean> { try {
        const toggleRef = db.collection(COLLECTIONS.FEATURE_TOGGLES).doc(featureName);
        const toggleDoc = await toggleRef.get();

        if (!toggleDoc.exists) {
            // Feature not found, use default
            return resolveToggle(featureName, { stored: undefined });
        }

        const toggle = toggleDoc.data() as FeatureToggle;

        if (!toggle.enabled) { return false;
        }

        // Check role restrictions
        if (toggle.targetRoles && toggle.targetRoles.length > 0) { if (!userRole || !toggle.targetRoles.includes(userRole)) {
                return false;
            }
        }

        // Check user-specific access
        if (toggle.targetUsers && toggle.targetUsers.length > 0) { if (!toggle.targetUsers.includes(userId)) {
                return false;
            }
        }

        return true;
    } catch (error) {
        // Fails closed for the reason recorded on resolveToggle (#245).
        logger.error(`Failed to check feature access for ${featureName} — failing CLOSED:`, error);
        return resolveToggle(featureName, { readFailed: true });
    }
}
