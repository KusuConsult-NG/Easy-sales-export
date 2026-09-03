export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { hasAdminPermission, isSuperAdmin } from "@/lib/admin-permissions";
import { getAdminDb } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";

const COLLECTION = "platform_settings";
const DOC = "security";

export async function GET() {
    try {
        const session = (await requireSession()).session;
        // #364. NOT config:read, which `support` holds. Lockout thresholds and
        // the MFA switch are security posture rather than ordinary settings,
        // so this asks for security:view_logs — super_admin and admin, exactly
        // the two roles the hand-written check allowed. Writing stays
        // super_admin only, as it was.
        if (!hasAdminPermission(session?.user?.roles, "security:view_logs")) {
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
        if (!session?.user || !isSuperAdmin(session.user.roles)) {
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

        // #364. Not reached by the audit ratchet — this route is gated on
        // isSuperAdmin rather than a permission — but the change it makes is
        // the platform's session lifetime, MFA enforcement and lockout
        // thresholds. If any write on this platform belongs in the audit log,
        // it is this one.
        await recordAdminAction({
            action: "config_updated",
            userId: session.user.id,
            targetId: DOC,
            targetType: "platform_settings",
            metadata: {
                sessionDurationDays: Number(sessionDurationDays) || 30,
                idleTimeoutHours: Number(idleTimeoutHours) || 24,
                enforceMfa: Boolean(enforceMfa),
                maxLoginAttempts: Number(maxLoginAttempts) || 5,
                lockoutDurationMinutes: Number(lockoutDurationMinutes) || 30,
            },
        });

        return NextResponse.json({ success: true, message: "Security settings saved" });
    } catch (error) {
        logger.error("POST /api/admin/settings/security error:", error);
        return NextResponse.json({ error: "Failed to save security settings" }, { status: 500 });
    }
}
