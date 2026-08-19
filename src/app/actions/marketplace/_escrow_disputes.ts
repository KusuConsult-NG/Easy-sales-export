"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createNotificationAction } from "@/app/actions/notifications";
import { smsDisputeResolved } from "@/lib/africastalking";
import { pushDisputeResolved } from "@/lib/fcm";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { Dispute, EscrowTransaction } from "@/lib/types/marketplace-escrow";
import { ESCROW_DISPUTEABLE_STATUSES } from "@/lib/escrow-status";
import { creditWalletOnce } from "@/lib/wallet-ledger";

/**
 * The two outcomes this resolver understands.
 *
 * The parameter is typed `"release_seller" | "refund_buyer"`, which is a
 * compile-time claim on a server action — the argument arrives as whatever was
 * sent. Every use below is `outcome === "release_seller" ? A : B`, so ANY other
 * string fell through to B and silently refunded the buyer: the escrow was
 * marked "refunded", the buyer credited, and both parties told the case was
 * decided against the seller. actions/disputes.ts validates its resolution for
 * exactly this reason — a "no_action" outcome used to refund there too.
 */
const DISPUTE_OUTCOMES = ["release_seller", "refund_buyer"] as const;

/**
 * Create dispute.
 *
 * Uses a Firestore transaction to atomically create the dispute document AND
 * update the escrow status. Previously two separate writes could leave
 * the escrow in `funded` while a dispute existed (or vice versa).
 */
async function _createDisputeAction(data: { escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    reason: string; }): Promise<{ success: true; error: null; data: { disputeId: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        // WHAT WAS WRONG HERE
        // -------------------
        // `session` was destructured and then never used. Every identity in the
        // dispute came from the caller: escrowId, initiatorId, respondentId.
        // Nothing checked that the caller had any connection to the escrow.
        //
        // So any authenticated user could open a dispute on ANY funded escrow —
        // moving it to "disputed" — and attribute it to whoever they named. The
        // audit row recorded `userId: data.initiatorId`, so it logged the person
        // the caller nominated rather than the person who acted.
        //
        // This is the vendor-ownership defect exactly: the session is
        // established and then used for nothing, so authentication stands in for
        // authorisation.
        //
        // The identities are now DERIVED rather than accepted. There is no
        // version of this where the caller says who they are, so there is
        // nothing left to forge.
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId);
        const escrowSnap = await escrowRef.get();
        if (!escrowSnap.exists) {
            return { success: false as const, error: "Escrow transaction not found" };
        }

        const escrow = escrowSnap.data() as EscrowTransaction;
        const callerId = session.user.id;

        const isBuyer = escrow.buyerId === callerId;
        const isSeller = escrow.sellerId === callerId;

        if (!isBuyer && !isSeller) {
            return { success: false as const, error: "Unauthorized" };
        }

        // Taken from the escrow, never from the request.
        const initiatedBy: "buyer" | "seller" = isBuyer ? "buyer" : "seller";
        const initiatorId = callerId;
        const respondentId = isBuyer ? escrow.sellerId : escrow.buyerId;

        const existingQuery = db.collection(COLLECTIONS.DISPUTES)
            .where("escrowId", "==", data.escrowId)
            .where("status", "in", ["open", "under_review"]);

        const existing = await existingQuery.get();
        if (!existing.empty) { return { success: false as const, error: "An active dispute already exists for this transaction"};
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();

        let escrowSnapData: EscrowTransaction | null = null;

        // CLAIMED, and from every disputeable status.
        //
        // TWO FAULTS IN ONE BLOCK.
        //
        // 1. This was a check-then-write inside runTransaction, which takes NO
        //    lock in this adapter. Two disputes raised on one escrow — the
        //    buyer and the seller at once, or one impatient double-click — both
        //    read a disputeable status and both created a DISPUTES row, leaving
        //    the escrow pointing at whichever wrote its disputeId last and an
        //    orphan dispute no resolution path can reach. actions/disputes.ts
        //    fixed exactly this by claiming the transition, and records the
        //    reasoning; this creator and the one in _escrow_actions.ts kept the
        //    old shape.
        //
        // 2. It required `status === "funded"` EXACTLY.
        //    ESCROW_DISPUTEABLE_STATUSES is funded/in_transit/delivered, and its
        //    own comment says a dispute must be raisable from anything a release
        //    can be claimed from, "or the freeze is decorative". Both release
        //    paths release from "delivered". So a buyer whose goods had shipped,
        //    or arrived damaged — the states where a dispute is the entire
        //    point — was told the escrow "must be in 'funded' state".
        //
        // The claim is the check now, so there is no window between them.
        const disputeClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: data.escrowId,
            fromAny: [...ESCROW_DISPUTEABLE_STATUSES],
            to: "disputed",
            patch: {
                disputeId: disputeRef.id,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!disputeClaim.claimed) {
            return {
                success: false as const,
                error: disputeClaim.status === null
                    ? "Escrow transaction not found"
                    : `Cannot dispute an escrow that is '${disputeClaim.status}'`,
            };
        }

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const escrowData = escrowDoc.data() as EscrowTransaction;
            escrowSnapData = escrowData;

            // Fields listed, not spread.
            //
            // This used to be `{ ...data, initiatedBy, initiatorId, ... }`, with
            // a comment explaining that the derived identities came after the
            // spread so a forged initiatorId could not survive. That was true,
            // and it was half the problem: field order stopped a caller
            // OVERWRITING the fields named below, but nothing stopped them
            // ADDING fields those lines never mention. `Dispute` declares
            // `resolution`, `resolvedBy` and `resolvedAt`, so a caller opening
            // an ordinary dispute could plant a resolution and attribute it to
            // an admin — the status would still read "open", but the admin
            // dispute view renders those fields.
            //
            // Two fields are wanted from the request. They are named. The
            // mass-assignment caveat in security-review-2026-08-10.md no longer
            // applies to this write.
            const dispute: Omit<Dispute, "id"> & { _version: number } = {
                escrowId: data.escrowId,
                reason: data.reason,
                initiatedBy,
                initiatorId,
                respondentId,
                // The parties as the ESCROW records them.
                //
                // Dispute resolution reads freshDispute.sellerId / buyerId and
                // throws "Target beneficiary ID not found on dispute" when they
                // are missing. Disputes created here carried neither, so every
                // dispute raised from the escrow page was UNRESOLVABLE — an
                // admin could neither release nor refund it. Money was not
                // misdirected; it was stuck.
                buyerId: escrowData.buyerId,
                sellerId: escrowData.sellerId,
                evidence: [],
                status: "open",
                _version: 0,
                createdAt: FieldValue.serverTimestamp() };

            tx.set(disputeRef, dispute);
            // The escrow's status and disputeId are written by the claim above.
            // Writing them here as well would put the transition AFTER the
            // dispute row, which is the ordering that let two callers through.
            tx.update(escrowRef, { _version: FieldValue.increment(1) });
        });

        await createAdminAuditLog({ action: "dispute_created",
            userId: initiatorId,
            targetId: disputeRef.id,
            targetType: "dispute",
            metadata: {
                escrowId: data.escrowId,
                initiatedBy: initiatedBy } });

        if (escrowSnapData) {
            const tx = escrowSnapData as EscrowTransaction;

            await createNotificationAction({
                userId: respondentId,
                type: "dispute",
                title: "Dispute Raised",
                message: `A dispute has been opened for escrow transaction "${tx.productName}". Our team will review the case.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }).catch((e) => logger.error("[createDisputeAction] Respondent notification failed:", e));

            await createNotificationAction({
                userId: initiatorId,
                type: "dispute",
                title: "Dispute Submitted",
                message: `Your dispute for "${tx.productName}" has been submitted. Our admin team will review and respond within 2–5 business days.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }).catch((e) => logger.error("[createDisputeAction] Initiator notification failed:", e));
        }

        return { error: null, success: true as const, data: { disputeId: disputeRef.id } };
    } catch (error) { logger.error("Dispute creation error:", {
            escrowId: data.escrowId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create dispute"};
    }
}


export async function createDisputeAction(data: Parameters<typeof _createDisputeAction>[0]) {
    return withFlexibleSafeAction("createDisputeAction", _createDisputeAction)(data);
}


/**
 * Admin resolves dispute.
 *
 * Uses requireAdmin() for live role re-validation.
 *
 * NOTHING CALLS THIS. The admin dispute screen resolves through
 * actions/disputes.ts — which supports partial refunds, credits through the
 * ledger primitive and validates its resolution — and calls into this file only
 * for escalateDisputeAction below. `index.ts` re-exports the module, so this is
 * a registered server action rather than dead code, and it is the second copy
 * of a money path: every defect fixed in the live resolver had to be fixed here
 * too, because a copy nobody runs is a copy nobody notices drifting. Removing a
 * "use server" export is the owner's call, not a side effect of a bug fix.
 */
async function _resolveDisputeAction(
    disputeId: string,
    adminId: string,
    resolution: string,
    outcome: "release_seller" | "refund_buyer"  // matches DisputeResolution type in marketplace.ts
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { // Live role re-validation — bypasses the stale JWT
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    /**
     * The admin who is actually signed in, not the one the caller names.
     *
     * `adminId` is a PARAMETER. requireAdmin() above proves the caller is an
     * admin, and then every attribution below — `resolvedBy` on the dispute,
     * `releasedBy` on the escrow, and the `userId` on the audit row — was taken
     * from the argument instead. So one admin could resolve a dispute and record
     * a colleague as having decided it, in the audit log meant to establish who
     * released the money. The argument is kept in the signature (callers pass
     * it) and no longer decides anything.
     */
    const actingAdminId = (adminCheck as { userId: string }).userId || adminId;

    if (!(DISPUTE_OUTCOMES as readonly string[]).includes(String(outcome))) {
        return {
            success: false as const,
            error: `Unknown outcome '${String(outcome)}'. Expected one of: ${DISPUTE_OUTCOMES.join(", ")}`,
            data: null,
        };
    }

    try {
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);

        let escrowId: string | null = null;
        let disputeData: Dispute | null = null;

        // Claim the resolution before moving any money.
        //
        // The status check ran inside runTransaction, which takes no lock, so
        // two admins resolving the same dispute at once both passed it and both
        // credited the payee. Claiming the dispute gates the whole operation:
        // whoever wins it is the only one who proceeds.
        //
        // Two attempts because a dispute may be resolved from either state, and
        // the compare-and-swap takes one `from` at a time. This is still safe
        // under a race: once the first attempt succeeds the status is
        // "resolved", so every later attempt fails both ways.
        const disputeSnap = await disputeRef.get();
        if (!disputeSnap.exists) {
            return { success: false as const, error: "Dispute not found", data: null };
        }
        const preDispute = disputeSnap.data() as Dispute;

        /**
         * The escrow is read BEFORE the dispute is claimed.
         *
         * It used to be read inside the transaction that follows the claim, and
         * a missing or unreadable escrow threw there — leaving the dispute
         * already marked "resolved", with a resolution and a resolver recorded,
         * and no money moved. A second attempt then fails the claim ("already
         * resolved"), so there is no way back through this action: the case is
         * closed, nobody has been paid, and the admin is told it failed.
         *
         * Checking first turns that into a refusal that changes nothing.
         */
        const preEscrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .doc(String(preDispute.escrowId ?? ""))
            .get();

        if (!preEscrowSnap.exists) {
            return { success: false as const, error: "Escrow transaction not found", data: null };
        }

        const preEscrow = preEscrowSnap.data() as EscrowTransaction;
        const escrowAmount = Number(preEscrow.amount);
        if (!Number.isFinite(escrowAmount) || escrowAmount <= 0) {
            return { success: false as const, error: "This escrow has no valid amount to settle", data: null };
        }

        let claim = await claimStatusTransition({
            collection: COLLECTIONS.DISPUTES,
            id: disputeId,
            from: "open",
            to: "resolved",
            patch: { resolution, resolvedBy: actingAdminId, resolvedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            claim = await claimStatusTransition({
                collection: COLLECTIONS.DISPUTES,
                id: disputeId,
                from: "under_review",
                to: "resolved",
                patch: { resolution, resolvedBy: actingAdminId, resolvedAt: new Date().toISOString() },
            });
        }

        if (!claim.claimed) {
            return {
                success: false as const,
                error: `Cannot resolve: dispute is already '${claim.status ?? "missing"}'`,
                data: null,
            };
        }

        escrowId = preDispute.escrowId;
        disputeData = preDispute;

        const releasingToSeller = outcome === "release_seller";
        const targetId = releasingToSeller ? preEscrow.sellerId : preEscrow.buyerId;

        /**
         * A seller wins the NET, the same figure an ordinary release pays.
         *
         * This credited `escrowData.amount` — the gross — so resolving a dispute
         * in the seller's favour handed over the platform fee that every
         * undisputed sale now withholds. Two release paths disagreeing about
         * what a seller is owed, which is the shape this audit has already found
         * twice on the escrow side.
         *
         * A refund is unchanged: the buyer gets back what they paid in, fee
         * included. That is the rule the live resolver in actions/disputes.ts
         * follows too.
         */
        const netAmount = Number((preEscrow as { netAmount?: unknown }).netAmount);
        const sellerPayout = Number.isFinite(netAmount) && netAmount > 0 ? netAmount : escrowAmount;
        const payoutAmount = releasingToSeller ? sellerPayout : escrowAmount;

        /**
         * The money moves through the ledger primitive, not by hand.
         *
         * The block that was here read the wallet and wrote a computed balance
         * inside runTransaction — which takes NO LOCK in this adapter — with no
         * idempotency reference at all. It is the exact shape its sibling in
         * _escrow_lifecycle.ts documents as replaced. creditWalletOnce moves the
         * balance in SQL and keys on the dispute, so a retry is a no-op rather
         * than a second payout.
         *
         * `DISPUTE-RES-${disputeId}` is deliberately the SAME reference the live
         * resolver in actions/disputes.ts uses. The two copies wrote the same
         * global-ledger id already; sharing the claim key means that if both ever
         * ran for one dispute, the second credits nothing instead of paying
         * twice and overwriting the first one's ledger row.
         */
        const credit = await creditWalletOnce({
            reference: `DISPUTE-RES-${disputeId}`,
            userId: targetId,
            amount: payoutAmount,
            paymentType: releasingToSeller ? "dispute_payout" : "dispute_refund",
            source: "escrow",
            status: releasingToSeller ? "disbursement" : "refund",
            metadata: { disputeId, escrowId, outcome },
        });

        if (!credit.claimed) {
            logger.warn("[resolveDisputeAction] wallet credit was already claimed; ledger rows left untouched", {
                disputeId, escrowId, targetId,
            });
        }

        const balanceAfter = credit.balance;
        const balanceBefore = credit.claimed ? balanceAfter - payoutAmount : balanceAfter;

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId!);
        await escrowRef.update({
            status: releasingToSeller ? "released" : "refunded",
            releasedBy: actingAdminId,
            [releasingToSeller ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp()
        });

        if (credit.claimed) {
            // Both ledger rows keyed on the dispute rather than auto-generated,
            // so a retry overwrites its own row instead of showing the payee two
            // settlements for one decision.
            const txId = `DISPUTE-RES-${disputeId}`;

            await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(txId).set({
                id: txId,
                walletId: targetId,
                userId: targetId,
                type: releasingToSeller ? "funding" : "refund",
                amount: payoutAmount,
                balanceBefore,
                balanceAfter,
                reference: escrowId,
                description: `Dispute Resolution (${outcome}) for escrow #${String(escrowId).substring(0, 8)}`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            await db.collection(COLLECTIONS.TRANSACTIONS).doc(txId).set({
                id: txId,
                userId: targetId,
                type: releasingToSeller ? "dispute_payout" : "dispute_refund",
                module: "escrow",
                amount: payoutAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Dispute Resolution (${outcome}) for "${preEscrow.productName}"`
            });
        }

        await createAdminAuditLog({ action: "dispute_resolved",
            userId: actingAdminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: {
                escrowId,
                outcome } });

        if (disputeData) {
            const d = disputeData as Dispute;

            // Notify initiator
            await createNotificationAction({
                userId: d.initiatorId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_seller"
                    ? `Your dispute has been resolved. Funds have been released to the seller.`
                    : `Your dispute has been resolved. Funds will be refunded to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution" }).catch((e) => logger.error("[resolveDisputeAction] Initiator notification failed:", e));

            // Notify respondent
            await createNotificationAction({
                userId: d.respondentId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_seller"
                    ? `The dispute for your escrow transaction has been resolved. Funds have been released to you.`
                    : `The dispute for your escrow transaction has been resolved. A refund will be issued to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution" }).catch((e) => logger.error("[resolveDisputeAction] Respondent notification failed:", e));

            // SMS + Push to both parties (non-fatal)
            const [initiatorDoc, respondentDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(d.initiatorId).get(),
                db.collection(COLLECTIONS.USERS).doc(d.respondentId).get(),
            ]);
            const initiatorPhone: string | undefined = initiatorDoc.data()?.phone ?? initiatorDoc.data()?.phoneNumber;
            const respondentPhone: string | undefined = respondentDoc.data()?.phone ?? respondentDoc.data()?.phoneNumber;
            const outcomeLabel = outcome === "release_seller" ? "release_seller" : "refund_buyer";
            await Promise.allSettled([
                initiatorPhone ? smsDisputeResolved(initiatorPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                respondentPhone ? smsDisputeResolved(respondentPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                pushDisputeResolved(d.initiatorId, d.respondentId, escrowId ?? disputeId),
            ]);
        }

        return { error: null, success: true as const, data: { message: "Dispute resolved" } };
    } catch (error) { logger.error("Dispute resolution error:", {
            disputeId,
            adminId,
            outcome,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to resolve dispute"};
    }
}


export const resolveDisputeAction = withFlexibleSafeAction("resolveDisputeAction", _resolveDisputeAction);


/**
 * Admin escalates an open or under_review dispute.
 * Sets escalated = true, changes status to under_review, logs audit, and
 * notifies both parties so they know their case is being prioritised.
 */
async function _escalateDisputeAction(
    disputeId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    try {
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
        let disputeData: Dispute | null = null;

        // Atomic read-validate-write inside a transaction to eliminate the
        // double-escalation race condition that existed with a bare .update().
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(disputeRef);
            if (!snap.exists) throw new Error("Dispute not found");

            const data = snap.data() as Dispute;
            if (!(["open", "under_review"] as const).includes(data.status as "open" | "under_review")) {
                throw new Error(`Dispute cannot be escalated — current status: ${data.status}`);
            }
            if ((data as any).escalated) { throw new Error("Dispute is already escalated");
            }

            disputeData = data;

            tx.update(disputeRef, { escalated: true,
                escalatedAt: FieldValue.serverTimestamp(),
                escalatedBy: (adminCheck as { userId: string }).userId,
                status: "under_review" });
        });

        const data = disputeData as unknown as Dispute;

        await createAdminAuditLog({ action: "dispute_escalated",
            userId: (adminCheck as { userId: string }).userId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { escrowId: data.escrowId } });

        // Notify both parties
        await Promise.allSettled([
            createNotificationAction({
                userId: data.initiatorId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "Your dispute has been escalated to senior review. A decision will be reached within 1–3 business days.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }),
            createNotificationAction({
                userId: data.respondentId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "The dispute for your escrow transaction has been escalated to senior review.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }),
        ]);

        return { error: null, success: true as const, data: { message: "Dispute escalated" } };
    } catch (error) { logger.error("Dispute escalation error:", {
            disputeId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to escalate dispute"};
    }
}


export const escalateDisputeAction = withFlexibleSafeAction("escalateDisputeAction", _escalateDisputeAction);
