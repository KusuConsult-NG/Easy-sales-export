export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

const SETTINGS_DOC = "platform_settings/notifications";

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

        await db.doc(SETTINGS_DOC).set({
            ...settings,
            updatedAt: new Date(),
        }, { merge: true });

        return NextResponse.json({ success: true, message: "Notification settings saved" });
    } catch (error: any) {
        logger.error("Failed to save notification settings:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
