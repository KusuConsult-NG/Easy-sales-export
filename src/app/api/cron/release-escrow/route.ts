
import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { balanceFieldOf } from "@/lib/cooperative-member-balance";
import { exportWindowReturnMultiplier } from "@/lib/export-window-status";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import {
    ESCROW_DELIVERED_AUTO_RELEASE_MS,
    ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS,
    ESCROW_UNCONFIRMED_AUTO_RELEASE_MS,
} from "@/lib/escrow-release-copy";
import { ESCROW_DISPATCH_RELEASABLE_FROM } from "@/lib/escrow-status";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { creditWalletOnce } from "@/lib/wallet-ledger";
import { createAdminAuditLog } from "@/lib/audit-log";
// The notification ACTION now requires a session, which a cron run does not
// have. This route is already gated by CRON_SECRET, so it calls the service
// directly — the same layer the action delegates to.
import { createNotification as createNotificationAction } from "@/infrastructure/notifications/service";
import { refuseUnauthorisedCron } from "@/lib/cron-auth";

export const dynamic = 'force-dynamic';

/** Process max items per loop to avoid Vercel timeout */
const MAX_BATCH_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
//   BOTH AUTO-RELEASE WINDOWS NOW COME FROM lib/escrow-release-copy — #968.
//
//   `const ESCROW_AUTO_RELEASE_DAYS = 7` used to sit here, a bare number in a
//   route, feeding notification copy that no screen agreed with because no
//   screen mentioned it. That is the drift #390 extracted the 24-hour window to
//   stop, and this constant was left behind by that pass. Its replacement is
//   exported beside the sentences that state it to a buyer, so the timer and the
//   disclosure cannot come apart.
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
        //
        // #659 — and that rule now lives in lib/cron-auth rather than here,
        // because it was written out eight times and the eight had drifted.
        const refusal = refuseUnauthorisedCron(req, 'release-escrow');
        if (refusal) return refusal;

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

    // `unpaid` is counted separately from `skipped` on purpose: a skip is a
    // window somebody else already claimed and is fine, an unpaid one is money
    // owed to a member that this job closed the door on. Collapsing the two
    // would put the thing needing a human back inside the number that means
    // "nothing to do".
    if (snapshot.empty) return { processed: 0, succeeded: 0, skipped: 0, unpaid: 0, failed: 0, totalValueReleased: 0 };

    const stats = { processed: 0, succeeded: 0, skipped: 0, unpaid: 0, failed: 0, totalValueReleased: 0 };

    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const exportId = doc.id;
        const userId = data.userId;
        const amount = data.amount || 0;

        // THE PAYOUT RATE DISAGREED WITH THE ADVERTISED ONE — #324.
        //
        // This was:
        //
        //     const roiString = data.roi || "15%";
        //     let roiPercentage = 0.15;
        //     const match = roiString.match(/(\d+)%/);
        //     if (match) roiPercentage = parseInt(match[1]) / 100;
        //     const totalPayout = amount * (1 + roiPercentage);
        //
        // Nothing writes an `roi` onto an export window — lib/export-window-status
        // establishes that and it still holds — so the configured branch never
        // ran and the hardcoded default was always in force. That default was
        // 15, while /export/windows/[id] quotes the investor
        // exportWindowRoiPercent(), which is 20 for a window recording nothing,
        // and both fulfilment paths record expectedReturn as `amount * 1.20`.
        //
        // So every delivered window paid 1.15x against a 1.20x quote: a
        // five-point shortfall on every export return, silently. The helper's
        // own doc had already named this failure — "using anything else would
        // have the page advertise one figure and the payout compute another" —
        // and this was the one path in the module that had never adopted it.
        //
        // It also never read `roiPercentage`, the field payments/service.ts
        // tells the operator to add, so a correctly configured window was paid
        // the default too.
        const returnMultiplier = exportWindowReturnMultiplier(data);
        const roiPercentage = returnMultiplier - 1;

        const totalPayout = amount * returnMultiplier;

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

        // THE PAYOUT WAS GATED ON A FIELD NOTHING WRITES.
        //
        // This was:
        //
        //     const cooperativeId = userDoc.data()?.cooperativeId;
        //     if (cooperativeId) { ...credit the nested member... }
        //
        // dashboard.ts already established — in a comment it still carries —
        // that NOTHING writes `cooperativeId` onto a USER document. It lives on
        // the membership record and on withdrawal rows. So for every member
        // created by any current path, this gate was shut.
        //
        // (#385: this used to name JoinCooperativeModal as the one writer and
        // call it "a client-side Firebase-SDK file from before the Supabase
        // migration" — wrong in all three parts, and repeated from here into
        // three other files before anyone read the file. That write is gone
        // now; there are no writers at all.)
        //
        // The dashboard's version of that bug showed a member ₦0 savings.
        // THIS one is worse in every direction:
        //
        //   - the window was ALREADY claimed "delivered" → "completed" above,
        //     with finalPayoutAmount written, so it can never be picked up
        //     again — the compare-and-swap that #249–#251 added to stop double
        //     payouts also makes a missed payout permanent;
        //   - an `escrow_released` audit row was written regardless;
        //   - stats.totalValueReleased added the payout and stats.succeeded
        //     counted it, so the cron reported money it had not moved.
        //
        // A member's export capital plus ROI silently went nowhere, the ledger
        // said it had been released, and nothing anywhere could find it again.
        //
        // Two corrections. The lookup now runs in the order dashboard.ts was
        // fixed to use — the CURRENT top-level membership first, keyed by user
        // id, with the legacy nested subcollection only as a fallback behind a
        // cooperativeId that a pre-migration member may still carry. And when
        // neither record exists the payout is NOT reported as made: the window
        // is flagged for reconciliation and counted as unpaid.
        const credited = await db.runTransaction(async (tx) => {
            const rootRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const rootDoc = await tx.get(rootRef);

            let memberRef: any = null;
            let memberData: Record<string, unknown> | null = null;
            let cooperativeId: string | null = null;

            if (rootDoc.exists) {
                memberRef = rootRef;
                memberData = rootDoc.data() ?? null;
                cooperativeId = (rootDoc.data()?.cooperativeId as string) ?? null;
            } else {
                const userDoc = await tx.get(db.collection(COLLECTIONS.USERS).doc(userId));
                const legacyCooperativeId = userDoc.data()?.cooperativeId;
                if (legacyCooperativeId) {
                    const nestedRef = db.collection(COLLECTIONS.COOPERATIVES).doc(legacyCooperativeId)
                        .collection("members").doc(userId);
                    const nestedDoc = await tx.get(nestedRef);
                    if (nestedDoc.exists) {
                        memberRef = nestedRef;
                        memberData = nestedDoc.data() ?? null;
                        cooperativeId = legacyCooperativeId;
                    }
                }
            }

            if (!memberRef) return false;

            // A legacy nested member keys their savings `balance`, not
            // `savingsBalance`, and the dashboard reads that name — so
            // crediting the fixed name here paid an export return into
            // a field the member could never see. See
            // lib/cooperative-member-balance.ts.
            tx.update(memberRef, { [balanceFieldOf(memberData)]: FieldValue.increment(totalPayout), updatedAt: FieldValue.serverTimestamp() });
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
            return true;
        });

        if (!credited) {
            // The window is already closed and cannot be reclaimed, so the only
            // honest thing left is to say so loudly and to somebody who can act.
            //
            // #318's flag, on #318's reasoning: the money is not moved here and
            // not retried here — a person credits it once, by hand, after
            // checking it was not already credited. reconcile-fulfilment scans
            // exportWindows for this flag, so it is on the daily report rather
            // than in a log line nobody reads.
            const note = `Export return of ₦${totalPayout.toLocaleString()} was NOT credited: `
                + `user ${userId} has no cooperative membership record, in either `
                + `${COLLECTIONS.COOPERATIVE_MEMBERS} or a legacy nested members subcollection. `
                + `The export window is already CLOSED and cannot be reprocessed by this job. `
                + `Credit the member by hand after confirming no deposit exists for this window.`;

            await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId).update({
                needsReconciliation: true,
                needsReconciliationAt: FieldValue.serverTimestamp(),
                payoutError: note,
            });

            logger.error(`[Cron: ExportWindows] ${exportId} closed WITHOUT paying the member`, {
                exportId, userId, amount, totalPayout,
            });

            await createAdminAuditLog({
                action: "payment_failed",
                userId,
                targetId: exportId,
                targetType: "export_window",
                metadata: { amount, totalPayout, roiPercentage, reason: "no_cooperative_membership" },
                details: note,
            });

            return "unpaid";
        }

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
        else if (r.value === "unpaid") stats.unpaid++;
        else stats.skipped++;
    });
    stats.processed = results.length;

    logger.info(`[Cron: ExportWindows] Processed ${stats.processed}. Success: ${stats.succeeded}. Skipped: ${stats.skipped}. Unpaid: ${stats.unpaid}. Value: ₦${stats.totalValueReleased.toLocaleString()}`);
    return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 2: DISPATCHED BUT NEVER CONFIRMED — #968
//
// Finds escrow rows where:
//   - the order was dispatched more than ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS
//     ago (`shippedAt`, stamped by _updateOrderStatusAction at dispatch)
//   - the status is still one of ESCROW_DISPATCH_RELEASABLE_FROM — so the buyer
//     has NOT confirmed (that moves the row to "delivered", where loop 3 takes
//     over with a 24-hour window) and has NOT disputed (that freezes it)
//
// WHAT THIS LOOP USED TO BE, and why it was worse than broken. It queried
// `releaseRequestedAt <= now - 7 days`, and the only writer of that field was
// requestEscrowReleaseAction, which had no caller. So it had never fired — which
// meant a buyer who simply never came back left the seller's money in escrow FOR
// EVER, with no path to payment that did not depend on the buyer choosing to act.
//
// THE BACKLOG IS NOT PAID, deliberately. An escrow written before #968 shipped
// carries no `shippedAt` at all, and a `where` on a missing field does not match
// it, so those rows are structurally out of reach of the query above rather than
// filtered out by a date somebody has to maintain. That is the owner's decision
// and it is REPORTED rather than left to be inferred from a count of zero: see
// `unstamped` below, and scripts/escrow-unconfirmed-backlog.ts, which reads the
// orders and classifies them properly for a human to release by hand.
// ─────────────────────────────────────────────────────────────────────────────
async function processEscrowTransactions(now: Timestamp) {
    const thresholdMs = Date.now() - ESCROW_UNCONFIRMED_AUTO_RELEASE_MS;
    const thresholdTimestamp = Timestamp.fromMillis(thresholdMs);

    //   NO INDEX IS ADDED FOR THIS, DELIBERATELY. The pair (status, shippedAt)
    //   is a new composite predicate over document_collections, and reaching for
    //   an expression index is the reflex. 022_jsonb_expression_indexes.sql
    //   already measured that question and answered it: at this size Postgres
    //   sequential-scans these tables and is right to, and creating the index
    //   costs write throughput on every insert for nothing. That migration also
    //   states its own re-measure trigger — document_collections past ~100,000
    //   rows, or one collection_name past ~50,000 — which is the condition to
    //   revisit this under, not a hunch about a new query being slow.
    const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
        .where("status", "in", [...ESCROW_DISPATCH_RELEASABLE_FROM])
        .where("shippedAt", "<=", thresholdTimestamp)
        .limit(MAX_BATCH_SIZE)
        .get();

    //   The rows this loop is declining to pay. Counted even when there is
    //   nothing to release, because "processed: 0" on its own reads as "no
    //   unconfirmed orders exist" when it can equally mean "there are twelve and
    //   none of them carries a dispatch stamp".
    const unstamped = await countUnstampedEscrows();

    if (snapshot.empty) return { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0, unstamped };

    const stats = { processed: 0, succeeded: 0, skipped: 0, failed: 0, totalValueReleased: 0, unstamped };

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
        // the status off the set below, and this then refuses to release.
        //
        //   #968 fromAny, not `from: "funded"`. The query admits every status in
        //   ESCROW_DISPATCH_RELEASABLE_FROM, and a single-status claim would have
        //   silently refused every `in_transit` row the query returned — a loop
        //   that looks like it is working and pays a subset of what it selected.
        //   The set is the SAME constant the query and the dispatch stamp use, so
        //   the three cannot drift apart.
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: doc.id,
            fromAny: [...ESCROW_DISPATCH_RELEASABLE_FROM],
            to: "released",
            patch: { releasedBy: "cron", releasedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            logger.info(
                `[Cron] Escrow ${escrowId} is '${claim.status ?? "missing"}', not awaiting `
                + `confirmation — skipping dispatch auto-release.`
            );
            return;
        }

        // THE AUTO-RELEASE PAID THE GROSS, BY HAND — #325.
        //
        // Both sibling release paths were repaired and this third one was
        // missed by both. _escrow_lifecycle.ts's own note even says so of ITS
        // sibling: "was moved onto credit_wallet_once for exactly these
        // reasons; this one was missed". Neither repair reached the cron.
        //
        // 1. THE FEE. Three escrow creators compute `platformFee` and store it
        //    with `netAmount`. Both sibling paths pay `netAmount`, gross only as
        //    a fallback. This loop credited `data.amount` — the gross — so the
        //    platform's own commission was handed to the seller. The same
        //    escrow paid a different amount depending on whether an admin
        //    pressed Release or the 7-day timer fired. #113/#109's shape.
        //
        // 2. THE CREDIT. It read the wallet and wrote a computed balance:
        //
        //        if (!walletSnap.exists) tx.set(walletRef, { balance: amount })
        //        else                    tx.update(walletRef, { balance: increment(...) })
        //
        //    The increment branch is safe; the set branch is not, and the claim
        //    above does not cover it. The claim stops one escrow being released
        //    twice — it does nothing when TWO DIFFERENT escrows for the same
        //    seller are released in the same run before that seller has a wallet
        //    row. Both take the set branch and the last write wins, so one
        //    payout is simply gone. runTransaction takes no lock on this adapter
        //    and cannot roll back. That is the verbatim reasoning from the
        //    sibling's note, and it applies here unchanged.
        //
        // 3. NO IDEMPOTENCY REFERENCE, so a re-run credited again.
        //
        // The reference is deliberately the SAME string the admin path uses, so
        // an admin release and a timer release of one escrow cannot both pay.
        const netStored = Number((data as any).netAmount);
        const sellerPayout = Number.isFinite(netStored) && netStored > 0 ? netStored : amount;

        const credit = await creditWalletOnce({
            reference: `escrow-release:${escrowId}`,
            userId: sellerId,
            amount: sellerPayout,
            paymentType: "escrow_release",
            source: "marketplace_escrow",
            // NOT "completed": platform_revenue_totals() sums completed rows,
            // and an escrow release is platform-held money going OUT.
            status: "disbursement",
            metadata: { escrowId, orderId: data.orderId ?? "", productName, trigger: "auto_release_unconfirmed_after_dispatch" },
        });

        // claimed:false means an earlier attempt already credited this escrow.
        // That is success, not an error — the money is where it should be.
        const balanceAfter = credit.balance;
        const balanceBefore = credit.claimed ? balanceAfter - sellerPayout : balanceAfter;

        await db.runTransaction(async (tx) => {
            // The money moved above, through the ledger primitive. These rows
            // are history, and their ids are derived from the escrow rather than
            // random so a retry overwrites instead of showing the seller the
            // same payout twice.
            const walletTxRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
                .doc(`escrow-release-${escrowId}`);
            tx.set(walletTxRef, {
                id: walletTxRef.id,
                walletId: sellerId,
                userId: sellerId,
                type: "funding",
                amount: sellerPayout,
                balanceBefore,
                balanceAfter,
                reference: escrowId,
                description: `Payout for order #${data.orderId || escrowId} (Escrow auto-released ${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS}d after dispatch, unconfirmed)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // The global ledger id was `ESCROW-RELEASE-${escrowId.substring(0, 8)}`.
            // Truncating an id to make a key is #104 exactly — there it was five
            // characters of a seller id and two sellers on one order collided.
            // Eight characters of an escrow id is the same bet on a smaller
            // scale, and the sibling path already keys on the whole id.
            const txId = `ESCROW-RELEASE-${escrowId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: sellerPayout,
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
            metadata: { amount, sellerId, buyerId, trigger: "auto_release_unconfirmed_after_dispatch" },
            details: `Automated release: dispatched ${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS}d ago, buyer never confirmed, no dispute raised`,
        });

        // Notify seller
        await createNotificationAction({
            userId: sellerId,
            type: "escrow",
            title: "Escrow Funds Auto-Released",
            message: `₦${amount.toLocaleString()} for "${productName}" has been automatically released to your account: it was dispatched ${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS} days ago and the buyer did not confirm receipt or raise a dispute.`,
            link: `/escrow/${escrowId}`,
            linkText: "View Escrow",
        }).catch(e => logger.error(`[Cron: Escrow] Seller notification failed for ${escrowId}:`, e));

        // Notify buyer
        await createNotificationAction({
            userId: buyerId,
            type: "escrow",
            title: "Escrow Transaction Completed",
            message: `The escrow for "${productName}" has been released to the seller. It was dispatched ${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS} days ago and was not confirmed or disputed before the deadline.`,
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

/**
 * How many escrows are awaiting confirmation with NO dispatch stamp — #968.
 *
 * These are the rows the loop above structurally cannot pay: escrows that were
 * already sitting in the collection when the five-day rule shipped, plus orders
 * that genuinely have not been dispatched yet. The two are not separated here,
 * and saying so is the point — scripts/escrow-unconfirmed-backlog.ts reads the
 * ORDERS to tell them apart, which is a join this route deliberately does not do
 * on every cron tick.
 *
 * WHY IT IS A SUBTRACTION. There is no "field is absent" predicate on this
 * adapter, so the stamped rows are counted with a `<=` against a date no real
 * shipment can exceed — the same (status, shippedAt) index the paying query
 * uses — and taken off the total. Two aggregate counts, no documents read.
 *
 * Reported rather than logged: a number that only reaches the log is a number
 * nobody reads until they already suspect something.
 */
async function countUnstampedEscrows(): Promise<number> {
    try {
        const col = () => db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("status", "in", [...ESCROW_DISPATCH_RELEASABLE_FROM]);

        const [awaiting, stamped] = await Promise.all([
            col().count().get(),
            col().where("shippedAt", "<=", Timestamp.fromMillis(Date.UTC(3000, 0, 1))).count().get(),
        ]);

        const total = Number(awaiting.data().count ?? 0);
        const withStamp = Number(stamped.data().count ?? 0);
        //   Floored: an inconsistent pair of counts across two reads must not
        //   report a negative backlog, which reads as a bug in the wrong place.
        return Math.max(0, total - withStamp);
    } catch (error) {
        //   A failed count must not fail the payouts. -1 says "not measured",
        //   which is honest, where 0 would claim an empty backlog.
        logger.error("[Cron: EscrowTransactions] Unstamped backlog count failed", error);
        return -1;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 3: Delivered Escrow Transactions (24h Auto-Release)
// Finds escrow transactions where:
//   - status is "delivered"
//   - updatedAt is <= 24 hours ago (meaning 24 hours without confirmation)
// ─────────────────────────────────────────────────────────────────────────────
async function processDeliveredEscrowTransactions(now: Timestamp) {
    // #390. Was a bare `24 * 60 * 60 * 1000` here and a window no screen
    // mentioned at all, which is how six screens came to describe a release
    // that waits for a person. The number and the sentences buyers and
    // sellers read now come from the same constant.
    const thresholdMs = Date.now() - ESCROW_DELIVERED_AUTO_RELEASE_MS;
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

        // #325, identical to the 7-day loop above. This one paid the gross and
        // credited by hand too — the same escrow, the same seller, a third
        // amount depending only on which timer fired.
        const netStored = Number((data as any).netAmount);
        const sellerPayout = Number.isFinite(netStored) && netStored > 0 ? netStored : amount;

        const credit = await creditWalletOnce({
            reference: `escrow-release:${escrowId}`,
            userId: sellerId,
            amount: sellerPayout,
            paymentType: "escrow_release",
            source: "marketplace_escrow",
            status: "disbursement",
            metadata: { escrowId, orderId: orderId ?? "", productName, trigger: "auto_release_after_24h_delivered" },
        });

        const balanceAfter = credit.balance;
        const balanceBefore = credit.claimed ? balanceAfter - sellerPayout : balanceAfter;

        await db.runTransaction(async (tx) => {
            const walletTxRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
                .doc(`escrow-release-${escrowId}`);
            tx.set(walletTxRef, {
                id: walletTxRef.id,
                walletId: sellerId,
                userId: sellerId,
                type: "funding",
                amount: sellerPayout,
                balanceBefore,
                balanceAfter,
                reference: escrowId,
                description: orderId ? `Payout for order #${orderId} (Escrow auto-released after 24h)` : `Escrow Payout for "${productName}" (24h Auto-Release)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // The whole escrow id, not eight characters of it — see the note in
            // the 7-day loop.
            const txId = `ESCROW-RELEASE-${escrowId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: sellerPayout,
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

