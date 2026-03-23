export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";

/**
 * GET /api/admin/wave/withdrawals
 * List WAVE withdrawal requests (admin only)
 */
export async function GET(request: NextRequest) {
    try {
        const db = getAdminDb();
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status") || "pending";

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .orderBy("requestedAt", "desc")
            .limit(50);

        if (status !== "all") {
            query = db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
                .where("status", "==", status)
                .orderBy("requestedAt", "desc")
                .limit(50);
        }

        const snapshot = await query.get();
        const withdrawals = snapshot.docs.map(doc => ({
            withdrawalId: doc.id,
            ...doc.data(),
            requestedAt: doc.data().requestedAt?.toDate?.() ?? null,
            processedAt: doc.data().processedAt?.toDate?.() ?? null,
        }));

        return NextResponse.json({ success: true, withdrawals });
    } catch (error: any) {
        logger.error("Admin WAVE withdrawals GET error:", error);
        return NextResponse.json({ success: false, error: "Failed to fetch withdrawals" }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/wave/withdrawals
 * Approve or reject a WAVE withdrawal request
 */
export async function PATCH(request: NextRequest) {
    try {
        const db = getAdminDb();
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json();
        const { withdrawalId, action, adminNotes, transactionReference } = body;

        if (!withdrawalId || !action || !["approve", "reject", "complete"].includes(action)) {
            return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
        }

        const ref = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
        const doc = await ref.get();

        if (!doc.exists) {
            return NextResponse.json({ success: false, error: "Withdrawal not found" }, { status: 404 });
        }

        // For "complete" action, we accept approved_pending_payout; for approve/reject we need pending
        if (action === "complete") {
            if (doc.data()?.status !== "approved_pending_payout") {
                return NextResponse.json({ success: false, error: "Can only complete approved_pending_payout withdrawals" }, { status: 409 });
            }
            await ref.update({
                status: "completed",
                completedBy: session.user.id,
                completedAt: FieldValue.serverTimestamp(),
                ...(adminNotes ? { adminNotes } : {}),
                ...(transactionReference ? { transactionReference } : {}),
            });
            logger.info(`WAVE withdrawal ${withdrawalId} completed by admin ${session.user.id}`);
            return NextResponse.json({ success: true, status: "completed" });
        }

        if (doc.data()?.status !== "pending") {
            return NextResponse.json({ success: false, error: "Withdrawal is no longer pending" }, { status: 409 });
        }

        // CRITICAL BUG FIX: 'approve' must set status to 'approved_pending_payout'
        // (queued for bank transfer), NOT 'completed'.
        // 'completed' is only set by the 'complete' action after the transfer is done.
        // Previously: approve → 'completed' (bypassed the payout step entirely)
        const newStatus = action === "approve" ? "approved_pending_payout" : "rejected";

        await db.runTransaction(async (tx) => {
            const freshDoc = await tx.get(ref);
            if (freshDoc.data()?.status !== "pending") {
                throw new Error("Withdrawal is no longer pending — may have been processed by another admin");
            }
            tx.update(ref, {
                status: newStatus,
                processedBy: session.user.id,
                processedAt: FieldValue.serverTimestamp(),
                ...(adminNotes ? { adminNotes } : {}),
                ...(transactionReference ? { transactionReference } : {}),
            });
        });

        logger.info(`WAVE withdrawal ${withdrawalId} ${newStatus} by admin ${session.user.id}`);
        return NextResponse.json({ success: true, status: newStatus });
    } catch (error: any) {
        logger.error("Admin WAVE withdrawal PATCH error:", error);
        return NextResponse.json({ success: false, error: "Failed to process withdrawal" }, { status: 500 });
    }
}
