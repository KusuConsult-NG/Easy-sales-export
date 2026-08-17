"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { claimStatusTransition } from "@/lib/status-transition";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createNotificationAction } from "@/app/actions/notifications";
import { smsDisputeResolved } from "@/lib/africastalking";
import { pushDisputeResolved } from "@/lib/fcm";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { Dispute, EscrowTransaction } from "@/lib/types/marketplace-escrow";

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

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const escrowData = escrowDoc.data() as EscrowTransaction;
            if (escrowData.status !== "funded") {
                throw new Error(
                    `Cannot dispute: escrow must be in 'funded' state, currently '${escrowData.status}'`
                );
            }

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
            tx.update(escrowRef, { status: "disputed", 
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
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
 * Uses a transaction to atomically update both dispute and escrow documents.
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

        let claim = await claimStatusTransition({
            collection: COLLECTIONS.DISPUTES,
            id: disputeId,
            from: "open",
            to: "resolved",
            patch: { resolution, resolvedBy: adminId, resolvedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            claim = await claimStatusTransition({
                collection: COLLECTIONS.DISPUTES,
                id: disputeId,
                from: "under_review",
                to: "resolved",
                patch: { resolution, resolvedBy: adminId, resolvedAt: new Date().toISOString() },
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

        await db.runTransaction(async (tx) => {
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId!);
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");
            const escrowData = escrowDoc.data() as EscrowTransaction;

            // 2. Update escrow status
            const finalStatus = outcome === "release_seller" ? "released" : "refunded";
            tx.update(escrowRef, { 
                status: finalStatus,
                releasedBy: adminId,
                [outcome === "release_seller" ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp() 
            });

            // 3. Financial Action (Wallet Credit/Refund)
            const targetId = outcome === "release_seller" ? escrowData.sellerId : escrowData.buyerId;
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(targetId);
            const walletSnap = await tx.get(walletRef);
            let balanceBefore = 0;

            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: targetId,
                    balance: escrowData.amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                balanceBefore = walletSnap.data()?.balance || 0;
                tx.update(walletRef, {
                    balance: FieldValue.increment(escrowData.amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // Record transaction in target's wallet_transactions history
            const targetTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            tx.set(targetTxnRef, {
                id: targetTxnRef.id,
                walletId: targetId,
                userId: targetId,
                type: outcome === "release_seller" ? "funding" : "refund",
                amount: escrowData.amount,
                balanceBefore,
                balanceAfter: balanceBefore + escrowData.amount,
                reference: escrowId,
                description: `Dispute Resolution (${outcome}) for escrow #${escrowId.substring(0, 8)}`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 4. Record in Global Ledger
            const txId = `DISPUTE-RES-${disputeId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: targetId,
                type: outcome === "release_seller" ? "dispute_payout" : "dispute_refund",
                module: "escrow",
                amount: escrowData.amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Dispute Resolution (${outcome}) for "${escrowData.productName}"`
            });
        });

        await createAdminAuditLog({ action: "dispute_resolved",
            userId: adminId,
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
