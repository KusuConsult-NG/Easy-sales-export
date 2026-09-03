export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { getAdminDb } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";

const COLLECTION = "platform_settings";
const DOC = "localization";

const DEFAULTS = {
    defaultLanguage: "en",
    defaultCurrency: "NGN",
    languages: [
        { code: "en", name: "English",        nativeName: "English",  enabled: true,  primary: true  },
        { code: "ha", name: "Hausa",           nativeName: "Hausa",    enabled: true,  primary: false },
        { code: "yo", name: "Yoruba",          nativeName: "Yorùbá",   enabled: false, primary: false },
        { code: "ig", name: "Igbo",            nativeName: "Igbo",     enabled: false, primary: false },
        { code: "fr", name: "French",          nativeName: "Français",  enabled: false, primary: false },
    ],
    currencies: [
        { code: "NGN", name: "Nigerian Naira",  symbol: "₦", enabled: true,  primary: true  },
        { code: "USD", name: "US Dollar",       symbol: "$", enabled: true,  primary: false },
        { code: "GBP", name: "British Pound",   symbol: "£", enabled: true,  primary: false },
        { code: "EUR", name: "Euro",            symbol: "€", enabled: false, primary: false },
        { code: "GHS", name: "Ghanaian Cedi",   symbol: "₵", enabled: false, primary: false },
        { code: "KES", name: "Kenyan Shilling", symbol: "KSh", enabled: false, primary: false },
    ],
    timezone: "Africa/Lagos",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
};

/**
 * GET /api/admin/settings/localization
 */
export async function GET() {
    try {
        const session = (await requireSession()).session;
        // #364. Reading platform configuration is what config:read names, so
        // `support` — the read-only assistance role, which holds it — can now
        // see the languages and currencies it is asked about. Writing still
        // takes config:update, which is super_admin and admin as before.
        if (!hasAdminPermission(session?.user?.roles, "config:read")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = getAdminDb();
        const doc = await db.collection(COLLECTION).doc(DOC).get();
        const settings = doc.exists ? { ...DEFAULTS, ...doc.data() } : DEFAULTS;

        return NextResponse.json({ success: true, settings });
    } catch (error) {
        logger.error("GET /api/admin/settings/localization error:", error);
        return NextResponse.json({ error: "Failed to load localization settings" }, { status: 500 });
    }
}

/**
 * POST /api/admin/settings/localization
 */
export async function POST(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "config:update")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { languages, currencies, defaultLanguage, defaultCurrency, timezone, dateFormat, timeFormat } = body;

        // Validate: at least one language and one currency must be enabled
        const hasEnabledLang = languages?.some((l: any) => l.enabled);
        const hasEnabledCurr = currencies?.some((c: any) => c.enabled);
        if (!hasEnabledLang || !hasEnabledCurr) {
            return NextResponse.json({ error: "At least one language and one currency must be enabled" }, { status: 400 });
        }

        // Validate: the default language/currency must be among enabled ones
        const defaultLangEnabled = languages?.find((l: any) => l.code === defaultLanguage && l.enabled);
        const defaultCurrEnabled = currencies?.find((c: any) => c.code === defaultCurrency && c.enabled);
        if (!defaultLangEnabled) {
            return NextResponse.json({ error: "Default language must be an enabled language" }, { status: 400 });
        }
        if (!defaultCurrEnabled) {
            return NextResponse.json({ error: "Default currency must be an enabled currency" }, { status: 400 });
        }

        const db = getAdminDb();
        await db.collection(COLLECTION).doc(DOC).set({
            languages,
            currencies,
            defaultLanguage,
            defaultCurrency,
            timezone: timezone || "Africa/Lagos",
            dateFormat: dateFormat || "DD/MM/YYYY",
            timeFormat: timeFormat || "24h",
            updatedAt: new Date().toISOString(),
            updatedBy: session.user.id,
        }, { merge: true });

        // #364. This write became permission-gated in the same change, which is
        // how the audit ratchet found it: the Server Action door
        // (_savePlatformSettingsAction) has recorded config_updated all along
        // and the API door recorded nothing. Two doors, one write, one of them
        // leaving no trace.
        await recordAdminAction({
            action: "config_updated",
            userId: session.user.id,
            targetId: DOC,
            targetType: "platform_settings",
            metadata: { defaultLanguage, defaultCurrency, timezone: timezone || "Africa/Lagos" },
        });

        return NextResponse.json({ success: true, message: "Localization settings saved" });
    } catch (error) {
        logger.error("POST /api/admin/settings/localization error:", error);
        return NextResponse.json({ error: "Failed to save localization settings" }, { status: 500 });
    }
}
