
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { createAdminAuditLog } from "@/lib/audit-log-admin";

export const dynamic = 'force-dynamic';

// ⚡️ SCALABILITY FIX: Batch Processing Configuration
const MAX_BATCH_SIZE = 50; // Process max 50 items per cron run to avoid Timeout

export async function GET(req: NextRequest) {
    try {
        // 🔒 SECURITY: Verify Cron Secret
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const now = Timestamp.now();

        // 1. Find Mature Escrow Records (With Limit)
        // We only fetch the first 50. The next cron run (e.g. 5 mins later) will get the rest.
        const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("status", "==", "delivered")
            .where("escrowReleaseDate", "<=", now)
            .limit(MAX_BATCH_SIZE)
            .get();

        if (snapshot.empty) {
            return NextResponse.json({ message: 'No pending escrow releases found', processed: 0 });
        }

        const stats = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            totalValueReleased: 0
        };

        // Process this batch
        // Note: For high volume, we would use batches. For now, Promise.allSettled is safer to avoid one failure blocking others.
        const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const exportId = doc.id;
            const userId = data.userId;
            const amount = data.amount || 0;
            const roiString = data.roi || "15%"; // Default to lower bound

            // Parse ROI
            let roiPercentage = 0.15;
            try {
                const match = roiString.match(/(\d+)%/);
                if (match) {
                    roiPercentage = parseInt(match[1]) / 100;
                }
            } catch (e) {
                logger.warn(`Failed to parse ROI for ${exportId}, using default 15%`);
            }

            const totalPayout = amount * (1 + roiPercentage);

            await db.runTransaction(async (transaction) => {
                // Double check status inside transaction
                const freshDoc = await transaction.get(doc.ref);
                if (freshDoc.data()?.status !== "delivered") {
                    throw new Error("Status changed concurrently");
                }

                // 2. Update Status to Completed
                transaction.update(doc.ref, {
                    status: "completed",
                    completedAt: FieldValue.serverTimestamp(),
                    finalPayoutAmount: totalPayout,
                    updatedAt: FieldValue.serverTimestamp()
                });

                // 3. Credit User (If Cooperative Member)
                // We check if they have a cooperative membership
                const userDoc = await transaction.get(db.collection(COLLECTIONS.USERS).doc(userId));
                const cooperativeId = userDoc.data()?.cooperativeId;

                if (cooperativeId) {
                    const memberRef = db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId)
                        .collection("members").doc(userId);

                    const memberDoc = await transaction.get(memberRef);
                    if (memberDoc.exists) {
                        transaction.update(memberRef, {
                            savingsBalance: FieldValue.increment(totalPayout),
                            updatedAt: FieldValue.serverTimestamp()
                        });

                        // Log the credit
                        const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
                        transaction.set(txRef, {
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
                // If not cooperative member, the "Completed" status indicates ready for manual payout or other wallet logic
            });

            // Audit Log (outside transaction)
            await createAdminAuditLog({
                action: "escrow_released",
                userId: userId,
                targetId: exportId,
                targetType: "export_window",
                metadata: { amount, totalPayout, roiPercentage },
                details: "Automated Cron Release"
            });

            stats.totalValueReleased += totalPayout;
            return true;
        }));

        // Tally stats
        results.forEach(result => {
            if (result.status === "fulfilled") stats.succeeded++;
            else stats.failed++;
        });

        stats.processed = results.length;

        logger.info(`[Cron: Escrow Release] Batch of ${stats.processed} processed. Success: ${stats.succeeded}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);

        return NextResponse.json({
            success: true,
            ...stats,
            batchSize: MAX_BATCH_SIZE
        });

    } catch (error: any) {
        logger.error("[Cron: Escrow Release] Fatal Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
