export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * GET /api/admin/wave/withdrawals
 * List WAVE withdrawal requests (admin only) with cursor-based pagination.
 *
 * Query params:
 *   status   — filter: "pending" | "approved_pending_payout" | "completed" | "rejected" | "all" (default: "pending")
 *   cursor   — ISO timestamp of last item's requestedAt (for Load More)
 *   limit    — default 25, max 50
 *
 * Response: { success, data: { withdrawals }, meta: { cursor, hasMore } }
 */
export async function GET(request: NextRequest) {
    try {
        const db = getAdminDb();
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, data: null, error: "Admin access required", meta: { cursor: null, hasMore: false } },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status") || "pending";
        const cursorParam = searchParams.get("cursor");
        const rawLimit = parseInt(searchParams.get("limit") || "25");
        const limit = Math.min(Math.max(rawLimit, 1), 50);

        let query: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .orderBy("requestedAt", "desc")
            .limit(limit + 1); // +1 for hasMore detection

        if (status !== "all") {
            query = db
                .collection(COLLECTIONS.WAVE_WITHDRAWALS)
                .where("status", "==", status)
                .orderBy("requestedAt", "desc")
                .limit(limit + 1);
        }

        if (cursorParam) {
            const cursorDate = new Date(cursorParam);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        const snapshot = await query.get();
        const hasMore = snapshot.docs.length > limit;
        const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

        const withdrawals = docs.map(doc => ({
            withdrawalId: doc.id,
            ...doc.data(),
            requestedAt: doc.data().requestedAt?.toDate?.()?.toISOString() ?? null,
            processedAt: doc.data().processedAt?.toDate?.()?.toISOString() ?? null,
            completedAt: doc.data().completedAt?.toDate?.()?.toISOString() ?? null,
        }));

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().requestedAt?.toDate?.()?.toISOString() ?? null
            : null;

        return NextResponse.json({
            success: true,
            data: { withdrawals },
            meta: { cursor: nextCursor, hasMore },
        });
    } catch (error: any) {
        logger.error("GET /api/admin/wave/withdrawals error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to fetch withdrawals", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/admin/wave/withdrawals
 * Approve, reject, or complete a WAVE withdrawal request.
 *
 * Body: { withdrawalId, action: "approve"|"reject"|"complete", adminNotes?, transactionReference? }
 * Response: { success, data: { status }, meta: { cursor: null, hasMore: false } }
 */
export async function PATCH(request: NextRequest) {
    try {
        const db = getAdminDb();
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, data: null, error: "Admin access required", meta: { cursor: null, hasMore: false } },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { withdrawalId, action, adminNotes, transactionReference } = body;

        if (!withdrawalId || !action || !["approve", "reject", "complete"].includes(action)) {
            return NextResponse.json(
                { success: false, data: null, error: "Invalid request: withdrawalId and action (approve|reject|complete) required", meta: { cursor: null, hasMore: false } },
                { status: 400 }
            );
        }

        const ref = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
        const doc = await ref.get();

        if (!doc.exists) {
            return NextResponse.json(
                { success: false, data: null, error: "Withdrawal not found", meta: { cursor: null, hasMore: false } },
                { status: 404 }
            );
        }

        // Handle "complete" action for approved_pending_payout withdrawals
        if (action === "complete") {
            if (doc.data()?.status !== "approved_pending_payout" && doc.data()?.status !== "approved") {
                return NextResponse.json(
                    { success: false, data: null, error: "Can only complete approved withdrawals", meta: { cursor: null, hasMore: false } },
                    { status: 409 }
                );
            }
            await ref.update({
                status: "completed",
                completedBy: session.user.id,
                completedAt: FieldValue.serverTimestamp(),
                ...(adminNotes ? { adminNotes } : {}),
                ...(transactionReference ? { transactionReference } : {}),
            });
            logger.info(`WAVE withdrawal ${withdrawalId} completed by admin ${session.user.id}`);
            return NextResponse.json({
                success: true,
                data: { status: "completed" },
                meta: { cursor: null, hasMore: false },
            });
        }

        // Handle "approve" and "reject" — must be pending
        if (doc.data()?.status !== "pending") {
            return NextResponse.json(
                { success: false, data: null, error: "Withdrawal is no longer pending", meta: { cursor: null, hasMore: false } },
                { status: 409 }
            );
        }

        let newStatus = action === "approve" ? "approved_pending_payout" : "rejected";
        let payoutTransactionRef = transactionReference;
        let payoutAdminNotes = adminNotes;
        
        // PAYOUT — Trigger Paystack Transfer immediately on approval
        if (action === "approve") {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(doc.data()?.userId).get();
            const userData = userDoc.data();
            
            if (!userData?.bankAccountNumber || !userData?.bankCode) {
                 return NextResponse.json(
                     { success: false, data: null, error: "User bank details not configured. Cannot process payout.", meta: { cursor: null, hasMore: false } },
                     { status: 400 }
                 );
            }
            
            const { paystackPayout } = await import("@/lib/paystack-transfer");
            const payoutResult = await paystackPayout(
                 {
                     accountNumber: userData.bankAccountNumber,
                     bankCode: userData.bankCode,
                     accountName: userData.bankAccountName || userData.name,
                 },
                 doc.data()?.amount,
                 `WAVE Withdrawal payout - ${withdrawalId}`
            );
            
            if (!payoutResult.success) {
                 return NextResponse.json(
                     { success: false, data: null, error: `Paystack payout failed: ${payoutResult.error}`, meta: { cursor: null, hasMore: false } },
                     { status: 500 }
                 );
            }
            
            newStatus = "completed"; // Automatically mark as completed if Paystack succeeded
            payoutTransactionRef = payoutResult.reference || transactionReference;
            payoutAdminNotes = (adminNotes ? adminNotes + " - " : "") + "Auto-paid via Paystack.";
        }

        await db.runTransaction(async tx => {
            const freshDoc = await tx.get(ref);
            if (freshDoc.data()?.status !== "pending") {
                throw new Error("Withdrawal is no longer pending — may have been processed by another admin");
            }
            tx.update(ref, {
                status: newStatus,
                processedBy: session.user.id,
                processedAt: FieldValue.serverTimestamp(),
                ...(newStatus === "completed" ? {
                     completedBy: session.user.id,
                     completedAt: FieldValue.serverTimestamp()
                } : {}),
                ...(payoutAdminNotes ? { adminNotes: payoutAdminNotes } : {}),
                ...(payoutTransactionRef ? { transactionReference: payoutTransactionRef } : {}),
            });
        });

        logger.info(`WAVE withdrawal ${withdrawalId} set to ${newStatus} by admin ${session.user.id}`);
        return NextResponse.json({
            success: true,
            data: { status: newStatus },
            meta: { cursor: null, hasMore: false },
        });
    } catch (error: any) {
        logger.error("PATCH /api/admin/wave/withdrawals error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to process withdrawal", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
