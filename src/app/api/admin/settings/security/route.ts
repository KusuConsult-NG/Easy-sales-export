export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";

const COLLECTION = "platform_settings";
const DOC = "security";

export async function GET() {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = getAdminDb();
        const doc = await db.collection(COLLECTION).doc(DOC).get();
        const data = doc.exists ? doc.data() : null;

        return NextResponse.json({
            success: true,
            settings: data ?? {
                sessionDurationDays: 30,
                idleTimeoutHours: 24,
                enforceMfa: true,
                maxLoginAttempts: 5,
                lockoutDurationMinutes: 30,
            },
        });
    } catch (error) {
        logger.error("GET /api/admin/settings/security error:", error);
        return NextResponse.json({ error: "Failed to load security settings" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.roles?.includes("super_admin")) {
            return NextResponse.json({ error: "Only super admins can change security settings" }, { status: 403 });
        }

        const body = await req.json();
        const { sessionDurationDays, idleTimeoutHours, enforceMfa, maxLoginAttempts, lockoutDurationMinutes } = body;

        const db = getAdminDb();
        await db.collection(COLLECTION).doc(DOC).set({
            sessionDurationDays: Number(sessionDurationDays) || 30,
            idleTimeoutHours: Number(idleTimeoutHours) || 24,
            enforceMfa: Boolean(enforceMfa),
            maxLoginAttempts: Number(maxLoginAttempts) || 5,
            lockoutDurationMinutes: Number(lockoutDurationMinutes) || 30,
            updatedAt: new Date().toISOString(),
            updatedBy: session.user.id,
        }, { merge: true });

        return NextResponse.json({ success: true, message: "Security settings saved" });
    } catch (error) {
        logger.error("POST /api/admin/settings/security error:", error);
        return NextResponse.json({ error: "Failed to save security settings" }, { status: 500 });
    }
}
