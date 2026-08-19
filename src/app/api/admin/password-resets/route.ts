export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { withRateLimit } from "@/lib/rate-limit";
import { recordAdminAction } from "@/lib/audit-log";

/** GET /api/admin/password-resets — list all reset token records */
async function getPasswordResetsHandler(_req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const snap = await db
            .collection(COLLECTIONS.PASSWORD_RESETS)
            .orderBy("createdAt", "desc")
            .limit(200)
            .get();

        const records = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                email: d.email,
                used: d.used,
                usedAt: d.usedAt?.toDate?.()?.toISOString() ?? null,
                expiry: d.expiry,
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            };
        });

        return NextResponse.json({ success: true, records });
    } catch (error) {
        logger.error("Admin password resets GET error:", error);
        return NextResponse.json({ success: false, error: "Failed to fetch records" }, { status: 500 });
    }
}

export const GET = withRateLimit(getPasswordResetsHandler);

/** DELETE /api/admin/password-resets — purge expired and used tokens */
async function deletePasswordResetsHandler(_req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const now = Date.now();

        // Expired tokens
        const expiredSnap = await db
            .collection(COLLECTIONS.PASSWORD_RESETS)
            .where("expiry", "<", now)
            .limit(500)
            .get();

        // Used tokens
        const usedSnap = await db
            .collection(COLLECTIONS.PASSWORD_RESETS)
            .where("used", "==", true)
            .limit(500)
            .get();

        // Deduplicate (a token can be both used AND expired)
        const toDelete = new Map<string, any>();
        for (const doc of [...expiredSnap.docs, ...usedSnap.docs]) {
            toDelete.set(doc.id, doc.ref);
        }

        // Batch delete (max 500 per batch)
        const refs = Array.from(toDelete.values());
        let deleted = 0;
        for (let i = 0; i < refs.length; i += 500) {
            const batch = db.batch();
            refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
            await batch.commit();
            deleted += Math.min(500, refs.length - i);
        }

        await recordAdminAction({
            action: 'password_resets_purged',
            userId: session.user.id,
            targetType: 'password_reset_tokens',
            metadata: { deleted },
        });
        return NextResponse.json({ success: true, deleted });
    } catch (error) {
        logger.error("Admin password resets DELETE error:", error);
        return NextResponse.json({ success: false, error: "Failed to purge tokens" }, { status: 500 });
    }
}

export const DELETE = withRateLimit(deletePasswordResetsHandler);
