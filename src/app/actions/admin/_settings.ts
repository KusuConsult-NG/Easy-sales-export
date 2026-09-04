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
import { requireAdmin } from "@/lib/require-admin";
import { invalidateSystemSettingsCache } from "@/lib/cache-invalidation";
import {
    SYSTEM_SETTINGS_DOCS,
    SYSTEM_SETTINGS_DEFAULTS,
    systemSettingsFieldsFor,
    checkSystemSetting,
    checkSystemSettingsPatch,
    type SystemSettingsDoc,
} from "@/lib/system-settings";

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

// ============================================
// System Settings — the money knobs (#381)
// ============================================

/**
 *   #381 THE PLATFORM'S FEE CONFIGURATION HAD NO WRITER.
 *
 *        `system_settings` held the marketplace platform fee, the order floor
 *        and ceiling, the delivery fee, the USD→NGN rate an export buyer is
 *        charged at, and the WAVE commission. Three readers, ZERO writers, so
 *        every one of those numbers was permanently the constant in
 *        lib/system-settings and changing any of them meant a deploy.
 *
 *        The exchange rate is the one with a clock on it: export products are
 *        priced in dollars and charged in naira at `usdToNgn`, and a rate
 *        frozen in source is wrong the day after it is written.
 *
 *        These two are that writer. Everything they enforce comes from
 *        SYSTEM_SETTINGS_FIELDS, so the screen and the validator cannot drift.
 */
async function _getSystemSettingsAction(): Promise<ActionResponse<any>> {
    try {
        const gate = await requireAdmin("config:read");
        if ("error" in gate) return { success: false as const, error: gate.error, data: null };

        const docs = await Promise.all(
            SYSTEM_SETTINGS_DOCS.map((id) =>
                db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(id).get()),
        );

        // The stored values ON TOP OF the defaults, which is exactly what the
        // getters do. A screen showing bare stored values would present a blank
        // for every field nobody has saved yet, and Save would then write those
        // blanks over the defaults the platform is actually running on — #295's
        // defect, which is what that finding fixed on three other screens.
        const data: Record<string, Record<string, number>> = {};
        SYSTEM_SETTINGS_DOCS.forEach((id, i) => {
            const stored = (docs[i].exists ? docs[i].data() : {}) ?? {};
            const merged: Record<string, number> = {};
            for (const field of systemSettingsFieldsFor(id)) {
                const raw = (stored as Record<string, unknown>)[field.key];
                const check = checkSystemSetting(field, raw);
                merged[field.key] = check.ok
                    ? check.value
                    : SYSTEM_SETTINGS_DEFAULTS[id][field.key];
            }
            data[id] = merged;
        });

        return { success: true, error: null, data };
    } catch (error: any) {
        // #317's rule: a read failure is not a set of defaults. Saying "the fee
        // is 5%" when we could not read it, and then letting Save write that
        // back, is how a stored setting gets silently replaced by a guess.
        logger.error("Get system settings error:", error);
        return { success: false as const, error: "Could not load system settings", data: null };
    }
}

async function _saveSystemSettingsAction(
    doc: string,
    values: Record<string, unknown>,
): Promise<ActionState> {
    try {
        const gate = await requireAdmin("config:update");
        if ("error" in gate) return { success: false as const, error: gate.error };
        const adminId = (gate as { userId: string }).userId;

        if (!SYSTEM_SETTINGS_DOCS.includes(doc as SystemSettingsDoc)) {
            return {
                success: false as const,
                error: `Unknown settings group "${doc}"`,
            };
        }
        const target = doc as SystemSettingsDoc;

        // Bounds-checked, and REFUSED rather than clamped. A silently clamped
        // exchange rate would be a wrong charge presented as a saved setting.
        const checked = checkSystemSettingsPatch(target, values ?? {});
        if (!checked.ok) return { success: false as const, error: checked.error };

        // Named keys only — `checked.values` holds exactly the fields
        // SYSTEM_SETTINGS_FIELDS declares for this document, so a caller
        // sending extra keys cannot get them into the row. #43's class, and the
        // same defect #317 found one function up in this very file.
        await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(target).set({
            ...checked.values,
            updatedBy: adminId,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Before returning success. These values are cached for an hour, so a
        // save that does not invalidate is a save that has not happened yet
        // while the screen says it has.
        await invalidateSystemSettingsCache();

        await createAdminAuditLog({
            action: "config_updated",
            userId: adminId,
            targetId: target,
            targetType: "system_settings",
            metadata: { changes: checked.values },
        });

        return { error: null, success: true as const, message: "Settings saved and applied" };
    } catch (error: any) {
        logger.error("Save system settings error:", error);
        return { error: "Failed to save settings", success: false as const };
    }
}

export const savePlatformSettingsAction = withFlexibleSafeAction("savePlatformSettingsAction", _savePlatformSettingsAction);

export const getPlatformSettingsAction = withFlexibleSafeAction("getPlatformSettingsAction", _getPlatformSettingsAction);

export const getSystemSettingsAction = withFlexibleSafeAction("getSystemSettingsAction", _getSystemSettingsAction);

export const saveSystemSettingsAction = withFlexibleSafeAction("saveSystemSettingsAction", _saveSystemSettingsAction);
