/**
 * GET /api/admin/marketplace/withdrawals
 * Lists wallet withdrawal transactions for admin review.
 * Optional query param: ?status=pending|processing|completed|rejected|all
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { hasAdminPermission } from "@/lib/admin-permissions";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /**
         *   #339 THE THIRD DOOR ONTO THE WITHDRAWAL QUEUE.
         *
         *        This was isAdmin() — true for all TEN admin roles — over rows
         *        that carry `bankDetails` in the clear. wallet.ts writes it onto
         *        the withdrawal transaction itself at request time:
         *
         *            type: "withdrawal", ..., bankDetails,
         *
         *        and this route spreads the whole document into the response.
         *
         *        Two other readers of the same rows are already gated on
         *        "finance:process_withdrawals" — the one the admin screen
         *        actually calls (wallet.ts getAdminWalletWithdrawalsAction,
         *        which refuses outright) and admin/_withdrawals.ts (which strips
         *        the PII for a caller who may not process). This route was
         *        neither. It is not wired to any screen, which is exactly why it
         *        was missed and exactly why it stayed open: an HTTP GET needs no
         *        caller in the bundle to be reachable with a session cookie.
         *
         *        Gated on the permission the queue is FOR, matching the reader
         *        the screen uses. The route is kept, not removed.
         */
        if (!hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const statusFilter = searchParams.get("status") || "pending";

        const db = getAdminDb();
        let query = db
            .collection(COLLECTIONS.WALLET_TRANSACTIONS)
            .where("type", "==", "withdrawal")
            .orderBy("createdAt", "desc")
            .limit(100);

        if (statusFilter !== "all") {
            query = db
                .collection(COLLECTIONS.WALLET_TRANSACTIONS)
                .where("type", "==", "withdrawal")
                .where("status", "==", statusFilter)
                .orderBy("createdAt", "desc")
                .limit(100);
        }

        const snap = await query.get();
        const withdrawals = snap.docs.map((d) => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                // Convert Firestore Timestamps to ISO strings for JSON serialisation
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? data.updatedAt ?? null,
                processedAt: data.processedAt?.toDate?.()?.toISOString() ?? data.processedAt ?? null,
                amount: Math.abs(data.amount ?? 0), // Store as positive for display
            };
        });

        return NextResponse.json({ withdrawals });
    } catch (error: any) {
        logger.error("[admin/marketplace/withdrawals] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch withdrawals" },
            { status: 500 }
        );
    }
}
