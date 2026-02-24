import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/** GET /api/admin/password-resets — list all reset token records */
export async function GET(_req: NextRequest) {
    try {
        const session = await auth();
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

/** DELETE /api/admin/password-resets — purge expired and used tokens */
export async function DELETE(_req: NextRequest) {
    try {
        const session = await auth();
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
        const toDelete = new Map<string, FirebaseFirestore.DocumentReference>();
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

        return NextResponse.json({ success: true, deleted });
    } catch (error) {
        logger.error("Admin password resets DELETE error:", error);
        return NextResponse.json({ success: false, error: "Failed to purge tokens" }, { status: 500 });
    }
}
