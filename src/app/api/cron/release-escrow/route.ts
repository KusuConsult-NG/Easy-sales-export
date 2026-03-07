
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { createNotificationAction } from "@/app/actions/notifications";

export const dynamic = 'force-dynamic';

/** Process max items per loop to avoid Vercel timeout */
const MAX_BATCH_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Escrow auto-release threshold: if a seller requested release and no dispute
// was raised within this many days, auto-release to seller.
const ESCROW_AUTO_RELEASE_DAYS = 7;
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    try {
        // 🔒 Verify Cron Secret
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const now = Timestamp.now();
        const results = await Promise.allSettled([
            processExportWindows(now),
            processEscrowTransactions(now),
        ]);

        const exportResult = results[0].status === 'fulfilled' ? results[0].value : { error: (results[0] as PromiseRejectedResult).reason?.message };
        const escrowResult = results[1].status === 'fulfilled' ? results[1].value : { error: (results[1] as PromiseRejectedResult).reason?.message };

        return NextResponse.json({
            success: true,
            exportWindows: exportResult,
            escrowTransactions: escrowResult,
        });

    } catch (error: any) {
        logger.error("[Cron: Release] Fatal Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 1: Export Windows
// Unchanged logic — finds delivered export windows past their escrowReleaseDate
// and credits the user's cooperative savings balance.
// ─────────────────────────────────────────────────────────────────────────────
async function processExportWindows(now: Timestamp) {
    const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
        .where("status", "==", "delivered")
        .where("escrowReleaseDate", "<=", now)
        .limit(MAX_BATCH_SIZE)
        .get();

    if (snapshot.empty) return { processed: 0, succeeded: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, failed: 0, totalValueReleased: 0 };

    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const exportId = doc.id;
        const userId = data.userId;
        const amount = data.amount || 0;
        const roiString = data.roi || "15%";

        let roiPercentage = 0.15;
        try {
            const match = roiString.match(/(\d+)%/);
            if (match) roiPercentage = parseInt(match[1]) / 100;
        } catch {
            logger.warn(`[Cron: ExportWindows] Failed to parse ROI for ${exportId}, using default 15%`);
        }

        const totalPayout = amount * (1 + roiPercentage);

        await db.runTransaction(async (tx) => {
            const freshDoc = await tx.get(doc.ref);
            if (freshDoc.data()?.status !== "delivered") throw new Error("Status changed concurrently");

            tx.update(doc.ref, {
                status: "completed",
                completedAt: FieldValue.serverTimestamp(),
                finalPayoutAmount: totalPayout,
                updatedAt: FieldValue.serverTimestamp()
            });

            const userDoc = await tx.get(db.collection(COLLECTIONS.USERS).doc(userId));
            const cooperativeId = userDoc.data()?.cooperativeId;

            if (cooperativeId) {
                const memberRef = db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId)
                    .collection("members").doc(userId);
                const memberDoc = await tx.get(memberRef);
                if (memberDoc.exists) {
                    tx.update(memberRef, { savingsBalance: FieldValue.increment(totalPayout), updatedAt: FieldValue.serverTimestamp() });
                    const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
                    tx.set(txRef, {
                        type: "deposit",
                        subType: "export_return",
                        amount: totalPayout,
                        userId,
                        cooperativeId,
                        status: "completed",
                        description: `Export ROI: ${data.commodity} (${data.quantity})`,
                        createdAt: FieldValue.serverTimestamp()
                    });
                }
            }
        });

        await createAdminAuditLog({
            action: "escrow_released",
            userId,
            targetId: exportId,
            targetType: "export_window",
            metadata: { amount, totalPayout, roiPercentage },
            details: "Automated Cron Release"
        });

        stats.totalValueReleased += totalPayout;
        return true;
    }));

    results.forEach(r => r.status === "fulfilled" ? stats.succeeded++ : stats.failed++);
    stats.processed = results.length;

    logger.info(`[Cron: ExportWindows] Processed ${stats.processed}. Success: ${stats.succeeded}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
    return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 2: Escrow Transactions (marketplace / standalone escrow)
// Finds FUNDED escrow transactions where:
//   - releaseRequestedAt is set (seller asked for release)
//   - No active dispute (status is still "funded", not "disputed")
//   - More than ESCROW_AUTO_RELEASE_DAYS days have elapsed since request
//
// This gives the buyer time to raise a dispute after the seller ships.
// If no dispute is raised within the window, funds auto-release to seller.
// ─────────────────────────────────────────────────────────────────────────────
async function processEscrowTransactions(now: Timestamp) {
    const thresholdMs = Date.now() - ESCROW_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000;
    const thresholdTimestamp = Timestamp.fromMillis(thresholdMs);

    const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
        .where("status", "==", "funded")
        .where("releaseRequestedAt", "<=", thresholdTimestamp)
        .limit(MAX_BATCH_SIZE)
        .get();

    if (snapshot.empty) return { processed: 0, succeeded: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, failed: 0, totalValueReleased: 0 };

    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const escrowId = doc.id;
        const sellerId: string = data.sellerId;
        const buyerId: string = data.buyerId;
        const amount: number = data.amount || 0;
        const productName: string = data.productName || "Unknown product";

        await db.runTransaction(async (tx) => {
            const freshDoc = await tx.get(doc.ref);
            const freshData = freshDoc.data();

            // Guard: bail if status changed concurrently (e.g. buyer just filed a dispute)
            if (freshData?.status !== "funded") {
                throw new Error(`Escrow ${escrowId} status changed to '${freshData?.status}', skipping auto-release`);
            }

            tx.update(doc.ref, {
                status: "released",
                releasedBy: "cron",
                releasedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // Audit
        await createAdminAuditLog({
            action: "escrow_released",
            userId: "cron",
            targetId: escrowId,
            targetType: "escrow_transaction",
            metadata: { amount, sellerId, buyerId, trigger: "auto_release_after_7_days" },
            details: `Automated release: ${ESCROW_AUTO_RELEASE_DAYS}d window elapsed with no dispute`,
        });

        // Notify seller
        await createNotificationAction({
            userId: sellerId,
            type: "escrow",
            title: "Escrow Funds Auto-Released",
            message: `₦${amount.toLocaleString()} for "${productName}" has been automatically released to your account after the ${ESCROW_AUTO_RELEASE_DAYS}-day dispute window elapsed.`,
            link: `/escrow/${escrowId}`,
            linkText: "View Escrow",
        }).catch(e => logger.error(`[Cron: Escrow] Seller notification failed for ${escrowId}:`, e));

        // Notify buyer
        await createNotificationAction({
            userId: buyerId,
            type: "escrow",
            title: "Escrow Transaction Completed",
            message: `The escrow for "${productName}" has been automatically completed. The ${ESCROW_AUTO_RELEASE_DAYS}-day dispute window has elapsed.`,
            link: `/escrow/${escrowId}`,
            linkText: "View Escrow",
        }).catch(e => logger.error(`[Cron: Escrow] Buyer notification failed for ${escrowId}:`, e));

        stats.totalValueReleased += amount;
        return true;
    }));

    results.forEach(r => r.status === "fulfilled" ? stats.succeeded++ : stats.failed++);
    stats.processed = results.length;

    logger.info(`[Cron: EscrowTransactions] Processed ${stats.processed}. Success: ${stats.succeeded}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
    return stats;
}
