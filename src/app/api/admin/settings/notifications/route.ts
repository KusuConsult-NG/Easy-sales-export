export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";

const SETTINGS_DOC = "platform_settings/notifications";

/**
 * The settings this screen owns.
 *
 * Shared by the GET defaults and the POST allow-list so the two cannot drift —
 * a document holding keys the screen does not render is how a preference
 * becomes unreachable.
 *
 * None of these is read anywhere else in the platform, and there is no
 * admin-directed email sender at all. See the note on the settings page.
 */
const NOTIFICATION_KEYS = [
    "newUserEmail",
    "exportRequestEmail",
    "loanApplicationEmail",
    "systemAlerts",
    "weeklyDigest",
] as const;

/**
 * GET /api/admin/settings/notifications
 * Returns current notification settings
 */
export async function GET() {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const doc = await db.doc(SETTINGS_DOC).get();
        const settings = doc.exists ? doc.data() : {
            newUserEmail: true,
            exportRequestEmail: true,
            loanApplicationEmail: true,
            systemAlerts: true,
            weeklyDigest: false,
        };
        return NextResponse.json({ success: true, settings });
    } catch (error: any) {
        logger.error("Failed to get notification settings:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/admin/settings/notifications
 * Saves notification settings to Firestore
 */
export async function POST(request: Request) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json();
        const { settings } = body;

        if (!settings || typeof settings !== "object") {
            return NextResponse.json({ success: false, error: "Invalid settings" }, { status: 400 });
        }

        // Only the keys this screen owns, as booleans.
        //
        // `...settings` wrote the caller's object into the config document
        // wholesale — any key, any type, any size. The blast radius is small
        // while nothing reads the document, which is exactly why it is worth
        // constraining now: whoever builds the notifier will read from here and
        // should find only what this screen puts in it.
        const patch: Record<string, boolean> = {};
        for (const key of NOTIFICATION_KEYS) {
            if (key in settings) patch[key] = Boolean(settings[key]);
        }

        if (Object.keys(patch).length === 0) {
            return NextResponse.json(
                { success: false, error: "No known notification settings were provided" },
                { status: 400 }
            );
        }

        await db.doc(SETTINGS_DOC).set({
            ...patch,
            updatedAt: new Date(),
            updatedBy: session.user.id,
        }, { merge: true });

        return NextResponse.json({ success: true, message: "Notification settings saved" });
    } catch (error: any) {
        logger.error("Failed to save notification settings:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
