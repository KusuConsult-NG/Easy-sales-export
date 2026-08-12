
import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { claimStatusTransition } from "@/lib/status-transition";
import { createAdminAuditLog } from "@/lib/audit-log";
// The notification ACTION now requires a session, which a cron run does not
// have. This route is already gated by CRON_SECRET, so it calls the service
// directly — the same layer the action delegates to.
import { createNotification as createNotificationAction } from "@/infrastructure/notifications/service";

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
        //
        // WHAT WAS WRONG HERE
        // -------------------
        // This was:
        //
        //     if (authHeader !== `Bearer ${process.env.CRON_SECRET}`)
        //
        // With CRON_SECRET unset, the template produces the literal string
        // "Bearer undefined" — so anyone sending `Authorization: Bearer
        // undefined` matched it and the route ran. The secret is NOT currently
        // configured, which is the state this would have shipped in.
        //
        // This route releases escrow funds: it pays sellers. An open trigger
        // for it is an open trigger for payouts.
        //
        // process-email-queue, reconcile-paystack and reconcile-fulfilment all
        // already refuse when the secret is missing. Two of five did not — the
        // same shape as the vendor writers and the escrow confirm.
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
            logger.error('[release-escrow] CRON_SECRET is not configured; refusing to run');
            return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
        }

        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const now = Timestamp.now();
        const results = await Promise.allSettled([
            processExportWindows(now),
            processEscrowTransactions(now),
            processDeliveredEscrowTransactions(now),
        ]);

        const exportResult = results[0].status === 'fulfilled' ? results[0].value : { error: (results[0] as PromiseRejectedResult).reason?.message };
        const escrowResult = results[1].status === 'fulfilled' ? results[1].value : { error: (results[1] as PromiseRejectedResult).reason?.message };
        const deliveredEscrowResult = results[2].status === 'fulfilled' ? results[2].value : { error: (results[2] as PromiseRejectedResult).reason?.message };

        return NextResponse.json({
            success: true,
            exportWindows: exportResult,
            escrowTransactions: escrowResult,
            deliveredEscrowTransactions: deliveredEscrowResult,
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

    if (snapshot.empty) return { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

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

        // Claim the payout before making it.
        //
        // This read the status, checked it, then updated — inside
        // runTransaction, which takes no lock. Two overlapping cron runs both
        // saw "delivered" and both credited the member's savings.
        //
        // That got worse, not better, when FieldValue.increment became atomic
        // (migration 010): before, one of the two credits was likely lost, which
        // accidentally masked the duplicate. Now both would land and the member
        // would be paid twice.
        const claim = await claimStatusTransition({
            collection: COLLECTIONS.EXPORT_WINDOWS,
            id: doc.id,
            from: "delivered",
            to: "completed",
            patch: { finalPayoutAmount: totalPayout, completedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            logger.info(
                `[Cron] Export window ${doc.id} already ${claim.status ?? "gone"}; skipping payout.`
            );
            return;
        }

        await db.runTransaction(async (tx) => {
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

    // A lost claim returns early, so it resolves with undefined. Counting that
    // as a success would report payouts that never happened.
    results.forEach(r => {
        if (r.status === "rejected") stats.failed++;
        else if (r.value === true) stats.succeeded++;
        else stats.skipped++;
    });
    stats.processed = results.length;

    logger.info(`[Cron: ExportWindows] Processed ${stats.processed}. Success: ${stats.succeeded}. Skipped: ${stats.skipped}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
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

    if (snapshot.empty) return { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const escrowId = doc.id;
        const sellerId: string = data.sellerId;
        const buyerId: string = data.buyerId;
        const amount: number = data.amount || 0;
        const productName: string = data.productName || "Unknown product";

        // Claim the release before crediting the seller.
        //
        // The old guard read the status and checked it inside runTransaction,
        // which takes no lock — so two overlapping runs both saw "funded" and
        // both credited the seller's wallet. The compare-and-swap also still
        // does the job the guard was there for: a buyer filing a dispute moves
        // the status off "funded", and this then refuses to release.
        const claim = await claimStatusTransition({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: doc.id,
            from: "funded",
            to: "released",
            patch: { releasedBy: "cron", releasedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            logger.info(
                `[Cron] Escrow ${escrowId} is '${claim.status ?? "missing"}', not 'funded' — skipping auto-release.`
            );
            return;
        }

        await db.runTransaction(async (tx) => {
            // 2. Credit Seller's Wallet
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(sellerId);
            const walletSnap = await tx.get(walletRef);
            let balanceBefore = 0;
            
            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: sellerId,
                    balance: amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                balanceBefore = walletSnap.data()?.balance || 0;
                tx.update(walletRef, {
                    balance: FieldValue.increment(amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // 3. Record in Wallet Transactions
            const walletTxRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            tx.set(walletTxRef, {
                id: walletTxRef.id,
                walletId: sellerId,
                userId: sellerId,
                type: "funding",
                amount: amount,
                balanceBefore,
                balanceAfter: balanceBefore + amount,
                reference: escrowId,
                description: `Payout for order #${data.orderId || escrowId.substring(0, 8)} (Escrow auto-released after 7d)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 3. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${escrowId.substring(0, 8)}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Escrow Payout for "${productName}"`
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

    // A lost claim returns early, so it resolves with undefined. Counting that
    // as a success would report payouts that never happened.
    results.forEach(r => {
        if (r.status === "rejected") stats.failed++;
        else if (r.value === true) stats.succeeded++;
        else stats.skipped++;
    });
    stats.processed = results.length;

    logger.info(`[Cron: EscrowTransactions] Processed ${stats.processed}. Success: ${stats.succeeded}. Skipped: ${stats.skipped}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
    return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 3: Delivered Escrow Transactions (24h Auto-Release)
// Finds escrow transactions where:
//   - status is "delivered"
//   - updatedAt is <= 24 hours ago (meaning 24 hours without confirmation)
// ─────────────────────────────────────────────────────────────────────────────
async function processDeliveredEscrowTransactions(now: Timestamp) {
    const thresholdMs = Date.now() - 24 * 60 * 60 * 1000;
    const thresholdTimestamp = Timestamp.fromMillis(thresholdMs);

    const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
        .where("status", "==", "delivered")
        .where("updatedAt", "<=", thresholdTimestamp)
        .limit(MAX_BATCH_SIZE)
        .get();

    if (snapshot.empty) return { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0 };

    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const escrowId = doc.id;
        const sellerId: string = data.sellerId;
        const buyerId: string = data.buyerId;
        const amount: number = data.amount || data.grossAmount || 0;
        const productName: string = data.productName || "Unknown product";
        const orderId: string | undefined = data.orderId;

        // Query associated escrow transactions for this order (outside transaction)
        let orderEscrowsDocs: any[] = [];
        if (orderId) {
            const querySnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get();
            orderEscrowsDocs = querySnap.docs;
        }

        // Claim the release before crediting the seller. Same reasoning as the
        // two loops above: the status check took no lock, so two overlapping
        // runs both saw "delivered" and both paid out.
        const claim = await claimStatusTransition({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: doc.id,
            from: "delivered",
            to: "released",
            patch: { releasedBy: "cron", releasedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            logger.info(
                `[Cron] Escrow ${escrowId} is '${claim.status ?? "missing"}', not 'delivered' — skipping auto-release.`
            );
            return;
        }

        await db.runTransaction(async (tx) => {

            // 2. Credit Seller's Wallet
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(sellerId);
            const walletSnap = await tx.get(walletRef);
            let balanceBefore = 0;
            
            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: sellerId,
                    balance: amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                balanceBefore = walletSnap.data()?.balance || 0;
                tx.update(walletRef, {
                    balance: FieldValue.increment(amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // 3. Record in Wallet Transactions
            const walletTxRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            tx.set(walletTxRef, {
                id: walletTxRef.id,
                walletId: sellerId,
                userId: sellerId,
                type: "funding",
                amount: amount,
                balanceBefore,
                balanceAfter: balanceBefore + amount,
                reference: escrowId,
                description: orderId ? `Payout for order #${orderId} (Escrow auto-released after 24h)` : `Escrow Payout for "${productName}" (24h Auto-Release)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 4. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${escrowId.substring(0, 8)}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Escrow Payout for "${productName}" (24h Auto-Release)`
            });

            // 5. Update Order Status if all escrows for this order are released
            if (orderId && orderEscrowsDocs.length > 0) {
                const otherEscrows = orderEscrowsDocs.filter(d => d.id !== escrowId);
                const allOthersReleased = otherEscrows.every(d => d.data().status === "released");
                if (allOthersReleased) {
                    const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
                    tx.update(orderRef, {
                        status: "completed",
                        paymentStatus: "paid_to_seller",
                        escrowReleased: true,
                        escrowReleasedAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp(),
                        _version: FieldValue.increment(1)
                    });
                }
            }
        });

        // Notify seller
        await createNotificationAction({
            userId: sellerId,
            type: "escrow",
            title: "Escrow Funds Auto-Released",
            message: `₦${amount.toLocaleString()} for "${productName}" has been automatically released to your account after 24 hours in delivered status.`,
            link: `/escrow/${escrowId}`,
            linkText: "View Escrow",
        }).catch(e => logger.error(`[Cron: Escrow] Seller notification failed for ${escrowId}:`, e));

        // Notify buyer
        await createNotificationAction({
            userId: buyerId,
            type: "escrow",
            title: "Escrow Transaction Completed",
            message: `The escrow for "${productName}" has been automatically completed. 24 hours have passed since delivery.`,
            link: `/escrow/${escrowId}`,
            linkText: "View Escrow",
        }).catch(e => logger.error(`[Cron: Escrow] Buyer notification failed for ${escrowId}:`, e));

        stats.totalValueReleased += amount;
        return true;
    }));

    // A lost claim returns early, so it resolves with undefined. Counting that
    // as a success would report payouts that never happened.
    results.forEach(r => {
        if (r.status === "rejected") stats.failed++;
        else if (r.value === true) stats.succeeded++;
        else stats.skipped++;
    });
    stats.processed = results.length;

    logger.info(`[Cron: DeliveredEscrowTransactions] Processed ${stats.processed}. Success: ${stats.succeeded}. Skipped: ${stats.skipped}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
    return stats;
}

