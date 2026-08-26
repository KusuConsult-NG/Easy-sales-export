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

        // Was: `{ ...settings, updatedBy, updatedAt }` — #317, and #43's class.
        //
        // The parameter is TYPED as five fields, but a type is not a runtime
        // guard: the spread wrote whatever keys the caller actually sent. The
        // general settings screen was sending the whole ActionResponse
        // envelope, so `success: true`, `error: null` and a nested `data`
        // object were being merged into platform_settings/general — while none
        // of the five real fields were written at all.
        //
        // Named explicitly now, so the document holds these keys and no others
        // whatever a caller passes.
        await db.collection(COLLECTIONS.PLATFORM_SETTINGS).doc("general").set({
            platformName: settings.platformName,
            supportEmail: settings.supportEmail,
            contactPhone: settings.contactPhone,
            defaultCurrency: settings.defaultCurrency,
            maintenanceMode: settings.maintenanceMode === true,
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
        // Was: success:true with the same hardcoded defaults returned below for
        // a MISSING document — #317.
        //
        // A read failure was presented as the platform's live configuration.
        // The defaults branch above is legitimate: no settings row means the
        // defaults genuinely apply. A thrown error means we do not know what
        // the settings are, and saying "maintenanceMode: false" when
        // maintenance mode may be ON is the one wrong answer with immediate
        // operational consequence.
        //
        // It also defeated the caller doing the right thing:
        // admin/settings/general checks `data?.success === false` and toasts
        // the error — the check #295 exists to have. success:true made it
        // unreachable, so the admin saw placeholder values (including the
        // literal "+234 000 000 0000") presented as current, and Save would
        // write them over the real ones.
        logger.error("Get platform settings error:", error);
        return { success: false as const, error: "Could not load platform settings", data: null };
    }
}

export const savePlatformSettingsAction = withFlexibleSafeAction("savePlatformSettingsAction", _savePlatformSettingsAction);

export const getPlatformSettingsAction = withFlexibleSafeAction("getPlatformSettingsAction", _getPlatformSettingsAction);
