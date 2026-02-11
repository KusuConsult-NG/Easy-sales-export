"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { DEFAULT_TOGGLES, type FeatureToggle } from "@/lib/feature-toggles";
import { createAuditLog } from "@/lib/audit-log";

/**
 * Get feature toggle state
 * Returns default if not found in database
 */
export async function getFeatureToggle(featureName: string): Promise<boolean> {
    try {
        const toggleRef = doc(db, COLLECTIONS.FEATURE_TOGGLES, featureName);
        const toggleDoc = await getDoc(toggleRef);

        if (!toggleDoc.exists()) {
            // Return default value
            return DEFAULT_TOGGLES[featureName] ?? false;
        }

        const toggle = toggleDoc.data() as FeatureToggle;
        return toggle.enabled;
    } catch (error) {
        console.error(`Failed to get feature toggle for ${featureName}:`, error);
        // Return default on error
        return DEFAULT_TOGGLES[featureName] ?? false;
    }
}

/**
 * Update feature toggle state (admin only)
 */
export async function updateFeatureToggle(
    featureName: string,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized: Admin access required" };
        }

        const toggleRef = doc(db, COLLECTIONS.FEATURE_TOGGLES, featureName);
        const toggleDoc = await getDoc(toggleRef);

        const previousState = toggleDoc.exists() ? (toggleDoc.data() as FeatureToggle).enabled : DEFAULT_TOGGLES[featureName];

        if (toggleDoc.exists()) {
            // Update existing toggle
            await updateDoc(toggleRef, {
                enabled,
                updatedAt: serverTimestamp(),
            });
        } else {
            // Create new toggle
            await setDoc(toggleRef, {
                id: featureName,
                name: featureName,
                description: `Feature toggle for ${featureName}`,
                enabled,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: session.user.id,
            });
        }

        // Audit log
        await createAuditLog({
            action: "feature_toggled",
            userId: session.user.id,
            userEmail: session.user.email!,
            targetId: featureName,
            targetType: "feature_toggle",
            metadata: {
                featureName,
                previousState,
                newState: enabled,
            },
            details: `Feature '${featureName}' ${enabled ? "enabled" : "disabled"}`,
        });

        return { success: true };
    } catch (error: any) {
        console.error("Failed to update feature toggle:", error);
        return { success: false, error: error.message || "Failed to update toggle" };
    }
}

/**
 * Get all feature toggles (admin only)
 */
export async function getAllFeatureToggles(): Promise<{
    success: boolean;
    data?: FeatureToggle[];
    error?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized: Admin access required" };
        }

        const togglesRef = collection(db, COLLECTIONS.FEATURE_TOGGLES);
        const snapshot = await getDocs(togglesRef);

        const toggles = snapshot.docs.map(doc => doc.data() as FeatureToggle);

        return { success: true, data: toggles };
    } catch (error: any) {
        console.error("Failed to get feature toggles:", error);
        return { success: false, error: error.message || "Failed to fetch toggles" };
    }
}

/**
 * Check if user has access to feature based on toggle settings
 */
export async function hasFeatureAccess(
    featureName: string,
    userId: string,
    userRole?: string
): Promise<boolean> {
    try {
        const toggleRef = doc(db, COLLECTIONS.FEATURE_TOGGLES, featureName);
        const toggleDoc = await getDoc(toggleRef);

        if (!toggleDoc.exists()) {
            // Feature not found, use default
            return DEFAULT_TOGGLES[featureName] ?? false;
        }

        const toggle = toggleDoc.data() as FeatureToggle;

        if (!toggle.enabled) {
            return false;
        }

        // Check role restrictions
        if (toggle.targetRoles && toggle.targetRoles.length > 0) {
            if (!userRole || !toggle.targetRoles.includes(userRole)) {
                return false;
            }
        }

        // Check user-specific access
        if (toggle.targetUsers && toggle.targetUsers.length > 0) {
            if (!toggle.targetUsers.includes(userId)) {
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error(`Failed to check feature access for ${featureName}:`, error);
        return DEFAULT_TOGGLES[featureName] ?? false;
    }
}
