"use server";

import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeValue } from "@/lib/firestore-serialize";
import { hasAdminPermission } from "@/lib/admin-permissions";

// ============================================
// Platform Settings (Admin)
// ============================================

async function _savePlatformSettingsAction(
    settings: {
        platformName: string;
        supportEmail: string;
        contactPhone: string;
        defaultCurrency: string;
        maintenanceMode: boolean;
    }
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "config:update")) {
            return { error: "Unauthorized: Admin access required", success: false as const };
        }

        await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").set({
            ...settings,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await createAdminAuditLog({
            action: "config_updated",
            userId: session.user.id,
            targetId: "general",
            targetType: "platform_settings",
            metadata: { changes: settings },
        });

        return { error: null, success: true as const, message: "Platform settings saved successfully" };
    } catch (error: any) {
        logger.error("Save platform settings error:", error);
        return { error: "Failed to save settings", success: false as const };
    }
}

async function _getPlatformSettingsAction(): Promise<ActionResponse<any>> {
    try {
        const doc = await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").get();
        if (!doc.exists) {
            return {
                success: true,
                error: null,
                data: {
                    platformName: "Easy Sales Export",
                    supportEmail: "info@easysalesexport.com",
                    contactPhone: "+234 000 000 0000",
                    defaultCurrency: "NGN",
                    maintenanceMode: false,
                }
            };
        }
        return { success: true, error: null, data: serializeValue(doc.data()) as any };
    } catch (error: any) {
        logger.error("Get platform settings error:", error);
        return {
            success: true,
            error: null,
            data: {
                platformName: "Easy Sales Export",
                supportEmail: "info@easysalesexport.com",
                contactPhone: "+234 000 000 0000",
                defaultCurrency: "NGN",
                maintenanceMode: false,
            }
        };
    }
}

export const savePlatformSettingsAction = withFlexibleSafeAction("savePlatformSettingsAction", _savePlatformSettingsAction);

export const getPlatformSettingsAction = withFlexibleSafeAction("getPlatformSettingsAction", _getPlatformSettingsAction);
