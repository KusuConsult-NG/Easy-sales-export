import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";

const db = getAdminDb();

/**
 * GET /api/admin/wave/withdrawals
 * List WAVE withdrawal requests (admin only)
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status") || "pending";

        let query: FirebaseFirestore.Query = db.collection("wave_withdrawals")
            .orderBy("requestedAt", "desc")
            .limit(50);

        if (status !== "all") {
            query = db.collection("wave_withdrawals")
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
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json();
        const { withdrawalId, action, adminNotes, transactionReference } = body;

        if (!withdrawalId || !action || !["approve", "reject"].includes(action)) {
            return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
        }

        const ref = db.collection("wave_withdrawals").doc(withdrawalId);
        const doc = await ref.get();

        if (!doc.exists) {
            return NextResponse.json({ success: false, error: "Withdrawal not found" }, { status: 404 });
        }

        if (doc.data()?.status !== "pending") {
            return NextResponse.json({ success: false, error: "Withdrawal is no longer pending" }, { status: 409 });
        }

        const newStatus = action === "approve" ? "completed" : "rejected";

        await ref.update({
            status: newStatus,
            processedBy: session.user.id,
            processedAt: FieldValue.serverTimestamp(),
            ...(adminNotes ? { adminNotes } : {}),
            ...(transactionReference ? { transactionReference } : {}),
        });

        logger.info(`WAVE withdrawal ${withdrawalId} ${newStatus} by admin ${session.user.id}`);
        return NextResponse.json({ success: true, status: newStatus });
    } catch (error: any) {
        logger.error("Admin WAVE withdrawal PATCH error:", error);
        return NextResponse.json({ success: false, error: "Failed to process withdrawal" }, { status: 500 });
    }
}
