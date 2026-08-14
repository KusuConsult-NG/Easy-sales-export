"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { claimStatusTransition } from "@/lib/status-transition";
import { claimPaymentOnce } from "@/lib/wallet-ledger";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog, logAdminFinancialAction } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createNotificationAction } from "@/app/actions/notifications";
import { verifyPaystackPayment } from "@/lib/paystack-server";
import { smsEscrowReleased } from "@/lib/africastalking";
import { pushEscrowReleased, pushDisputeResolved } from "@/lib/fcm";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { EscrowTransaction } from "@/lib/types/marketplace-escrow";

/**
 * Create escrow transaction
 */
async function _createEscrowAction(data: { buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    productName: string;
    productDescription: string; }): Promise<{ success: true; error: null; data: { escrowId: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== data.buyerId) { return { success: false as const, error: "Unauthorized", data: null };
        }

        // Validate at RUNTIME. The parameter type is TypeScript and is erased
        // at the wire — this is a server action, so `amount` arrives as whatever
        // the caller sent. A negative or non-finite amount cannot be funded
        // (confirmEscrowPayment compares it against what Paystack actually
        // charged), but it can be CREATED, and release credits the seller
        // `escrowData.amount`.
        if (!Number.isFinite(data.amount) || data.amount <= 0) {
            return { success: false as const, error: "Invalid escrow amount", data: null };
        }
        if (!data.sellerId || data.sellerId === data.buyerId) {
            return { success: false as const, error: "Invalid seller", data: null };
        }

        // NOTE ON THE ORDERING BELOW, which is load-bearing.
        //
        // `...data` is spread FIRST and the security-relevant fields are set
        // AFTER, so a caller who sends `status: "funded"` has it overwritten.
        // Reversing these lines would turn this into a privilege escalation:
        // an escrow could be created already funded, without payment.
        //
        // Fourteen sites in this codebase spread caller data into a write and
        // every one of them is safe for exactly this reason. That is a property
        // of field order in an object literal, which is a thin thing to rest on.
        const escrow: Omit<EscrowTransaction, "id"> & { _version: number } = { ...data,
            participants: [data.buyerId, data.sellerId],
            status: "pending",
            _version: 0,
            createdAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).add(escrow);

        (async () => { try {
                await createAdminAuditLog({
                    action: "escrow_created",
                    userId: data.buyerId,
                    targetId: docRef.id,
                    targetType: "escrow_transaction",
                    metadata: {
                        amount: data.amount,
                        seller: data.sellerId,
                        product: data.productName } });

                await createNotificationAction({
                    userId: data.buyerId,
                    type: "escrow",
                    title: "Escrow Created",
                    message: `Your escrow for "${data.productName}" (₦${data.amount.toLocaleString()}) has been created. Please complete payment to secure the transaction.`,
                    link: `/escrow/${docRef.id}`,
                    linkText: "View Escrow" });

                await createNotificationAction({
                    userId: data.sellerId,
                    type: "escrow",
                    title: "New Escrow Transaction",
                    message: `A buyer has initiated a secured escrow for "${data.productName}" (₦${data.amount.toLocaleString()}). Funds will be held until delivery is confirmed.`,
                    link: `/escrow/${docRef.id}`,
                    linkText: "View Escrow" });
            } catch (sideEffectError) { logger.error("[createEscrowAction] Side effects failed:", sideEffectError);
            }
        })();

        return { error: null, success: true as const, data: { escrowId: docRef.id } };
    } catch (error) { logger.error("Escrow creation error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create escrow transaction"};
    }
}


export const createEscrowAction = withFlexibleSafeAction("createEscrowAction", _createEscrowAction);


/**
 * Confirm payment and move to funded status.
 *
 * Runs inside a transaction to guard the state transition:
 * only `pending → funded` is valid.
 */
async function _confirmEscrowPaymentAction(
    escrowId: string,
    paymentReference: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        // The session is REQUIRED, and its failure is no longer swallowed.
        //
        // This read `requireSession().catch(() => null)`, so an authentication
        // failure produced null and execution carried on. Combined with the
        // missing ownership check below, that made this endpoint effectively
        // unauthenticated — on a function that marks escrow as funded.
        sessionResult = await requireSession();
        if (!sessionResult?.session?.user?.id) {
            return { success: false as const, error: "Authentication required" };
        }
        const callerId = sessionResult.session.user.id;

        let paystackData: Awaited<ReturnType<typeof verifyPaystackPayment>>;
        try {
            paystackData = await verifyPaystackPayment(paymentReference);
        } catch (e: any) { logger.error("[confirmEscrowPayment] Paystack verification failed:", e);
            return { success: false as const, error: "Payment verification failed: " + (e.message ?? "Unknown error")};
        }

        if (paystackData.data.status !== "success") { return { success: false as const, error: `Payment not confirmed. Paystack status: '${paystackData.data.status}'. Please complete payment and try again.`
            };
        }

        const escrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowSnap.exists) return { success: false as const, error: "Escrow transaction not found"};

        const escrowDoc = escrowSnap.data() as EscrowTransaction;

        const paidAmountNaira = paystackData.data.amount / 100;
        const expectedAmount = escrowDoc.amount;

        if (Math.abs(paidAmountNaira - expectedAmount) > 1) {
            logger.warn(
                `[confirmEscrowPayment] Amount mismatch on ${escrowId}: expected ₦${expectedAmount}, got ₦${paidAmountNaira}`
            );
            return { success: false as const, error: `Payment amount mismatch. Expected ₦${expectedAmount.toLocaleString()}, received ₦${paidAmountNaira.toLocaleString()}.`
            };
        }

        // Only the buyer may confirm their own escrow.
        //
        // escrowId came from the caller and was never checked against them.
        // _createEscrowAction in this same file has always compared
        // `session.user.id !== data.buyerId`; this function did not.
        if (escrowDoc.buyerId !== callerId) {
            logger.warn(`[confirmEscrowPayment] ${callerId} attempted to confirm escrow ${escrowId} owned by ${escrowDoc.buyerId}`);
            return { success: false as const, error: "Unauthorized" };
        }

        // Claim the payment reference. ONE reference funds ONE escrow.
        //
        // Nothing claimed it before. The only checks were "Paystack says this
        // reference succeeded" and "the amount matches within ₦1" — so a single
        // real payment could be replayed to fund any number of DIFFERENT escrows
        // of that amount. The platform would believe N escrows were funded
        // having received the money once, and escrow release pays sellers out of
        // that belief.
        //
        // The status is "escrow_funding", not "completed": this records that a
        // payment was applied to an escrow, and platform_revenue_totals() sums
        // completed rows as revenue. Money moving into escrow is not revenue.
        const claim = await claimPaymentOnce({
            reference: paymentReference,
            userId: callerId,
            amount: paidAmountNaira,
            type: "escrow_funding",
            source: "escrow_confirm",
            status: "escrow_funding",
            metadata: { escrowId },
        });

        if (!claim.claimed) {
            logger.warn(`[confirmEscrowPayment] reference ${paymentReference} already used; refusing to fund ${escrowId}`);
            return { success: false as const, error: "This payment has already been applied" };
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        // pending -> funded as a claim, not a read-then-write.
        //
        // The check that was here compared data.status inside runTransaction,
        // which takes no lock — the shape atomic-money-migration.md documents
        // throughout. It listed this transition as deliberately unconverted
        // because "a double-apply duplicates notifications rather than money".
        // That reasoning held only while the reference was unclaimed and the
        // caller unverified; with both fixed it costs nothing to make it a claim.
        const statusClaim = await claimStatusTransition({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: escrowId,
            from: "pending",
            to: "funded",
            patch: {
                paymentReference,
                paidAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });

        if (!statusClaim.claimed) {
            return {
                success: false as const,
                error: statusClaim.status === null
                    ? "Escrow transaction not found"
                    : `Invalid state transition: expected 'pending', got '${statusClaim.status}'`,
            };
        }

        const escrowData: EscrowTransaction | null = escrowDoc;

        if (escrowData) { const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "payment_completed",
                tx.buyerId,
                tx.amount,
                escrowId,
                { paymentReference, channel: paystackData.data.channel }
            );

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Payment Confirmed",
                message: `Your payment of ₦${tx.amount.toLocaleString()} for "${tx.productName}" has been secured in escrow.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[confirmEscrowPaymentAction] Buyer notification failed:", e));

            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funded",
                message: `Funds of ₦${tx.amount.toLocaleString()} for "${tx.productName}" have been secured in escrow. You can now proceed with delivery.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[confirmEscrowPaymentAction] Seller notification failed:", e));
        }

        return { error: null, success: true as const, data: { message: "Payment confirmed" } };
    } catch (error) { logger.error("Payment confirmation error:", {
            escrowId,
            paymentReference,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to confirm payment"};
    }
}


export const confirmEscrowPaymentAction = withFlexibleSafeAction("confirmEscrowPaymentAction", _confirmEscrowPaymentAction);


/**
 * Seller requests escrow release.
 *
 * Runs inside a transaction: only a `funded` escrow belonging to this seller
 * can be marked for release.
 */
async function _requestEscrowReleaseAction(
    escrowId: string,
    sellerId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired"};
        }
        if (sessionResult.session.user.id !== sellerId) { return { success: false as const, error: "Unauthorized"};
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;

            if (data.sellerId !== sellerId) throw new Error("Unauthorized");
            if (data.status !== "funded") {
                throw new Error(
                    `Invalid state transition: expected 'funded', got '${data.status}'`
                );
            }

            escrowData = data;

            tx.update(escrowRef, { releaseRequestedAt: FieldValue.serverTimestamp(),
                releaseRequestedBy: sellerId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (escrowData) {
            const tx = escrowData as EscrowTransaction;

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Release Requested",
                message: `The seller has requested release of escrow funds for "${tx.productName}". Please confirm delivery if you have received the goods.`,
                link: `/escrow/${escrowId}`,
                linkText: "Review Request" }).catch((e) => logger.error("[requestEscrowReleaseAction] Buyer notification failed:", e));
        }

        return { error: null, success: true as const, data: { message: "Release requested" } };
    } catch (error) { logger.error("Release request error:", {
            escrowId,
            sellerId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to request release"};
    }
}


export const requestEscrowReleaseAction = withFlexibleSafeAction("requestEscrowReleaseAction", _requestEscrowReleaseAction);


/**
 * Admin releases escrow to seller.
 *
 * Uses requireAdmin() for live role re-validation (not stale JWT).
 * Runs inside a transaction: only a `funded` escrow can be released.
 */
async function _releaseEscrowAction(
    escrowId: string,
    adminId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    try {
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        let escrowData: EscrowTransaction | null = null;

        // Claim the release before crediting the seller.
        //
        // The status check ran inside runTransaction, which takes no lock, so
        // two admins releasing the same escrow at once both read "funded" and
        // both credited the seller's wallet. Migration 010 made that worse
        // rather than better: concurrent increments used to lose one another,
        // which hid the duplicate; now both land and the seller is paid twice.
        const preClaim = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!preClaim.exists) {
            return { success: false as const, error: "Escrow transaction not found", data: null };
        }
        escrowData = preClaim.data() as EscrowTransaction;

        const claim = await claimStatusTransition({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: escrowId,
            from: "funded",
            to: "released",
            patch: { releasedBy: adminId, releasedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                error: `Invalid state transition: expected 'funded', got '${claim.status ?? "missing"}'`,
                data: null,
            };
        }

        await db.runTransaction(async (tx) => {
            const data = escrowData as EscrowTransaction;

            // Credit the Seller's Wallet
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(data.sellerId);
            const walletSnap = await tx.get(walletRef);
            let balanceBefore = 0;
            
            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: data.sellerId,
                    balance: data.amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                balanceBefore = walletSnap.data()?.balance || 0;
                tx.update(walletRef, {
                    balance: FieldValue.increment(data.amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // Record transaction in seller's wallet_transactions history
            const sellerTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            tx.set(sellerTxnRef, {
                id: sellerTxnRef.id,
                walletId: data.sellerId,
                userId: data.sellerId,
                type: "funding",
                amount: data.amount,
                balanceBefore,
                balanceAfter: balanceBefore + data.amount,
                reference: escrowId,
                description: `Payout for escrow #${escrowId.substring(0, 8)} (Escrow released)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 3. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${escrowId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: data.sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: data.amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Escrow Payout for "${data.productName}"`
            });
        });

        if (escrowData) { const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "escrow_released",
                adminId,
                tx.amount,
                escrowId,
                {
                    sellerId: tx.sellerId,
                    buyerId: tx.buyerId }
            );

            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funds Released",
                message: `₦${tx.amount.toLocaleString()} for "${tx.productName}" has been released to you by an admin.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details" }).catch((e) => logger.error("[releaseEscrowAction] Seller notification failed:", e));

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Transaction Completed",
                message: `The escrow for "${tx.productName}" has been completed and funds released to the seller.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details" }).catch((e) => logger.error("[releaseEscrowAction] Buyer notification failed:", e));

            const [sellerDoc, buyerDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(tx.sellerId).get(),
                db.collection(COLLECTIONS.USERS).doc(tx.buyerId).get(),
            ]);
            const sellerPhone: string | undefined = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
            const orderRef = escrowId; 
            await Promise.allSettled([
                sellerPhone ? smsEscrowReleased(sellerPhone, orderRef, tx.amount) : Promise.resolve(),
                pushEscrowReleased(tx.sellerId, orderRef, tx.amount, escrowId),
                pushDisputeResolved(tx.buyerId, tx.sellerId, orderRef),
            ]);
        }

        return { error: null, success: true as const, data: { message: "Escrow released" } };
    } catch (error) { logger.error("Escrow release error:", {
            escrowId,
            adminId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to release escrow"};
    }
}


export const releaseEscrowAction = withFlexibleSafeAction("releaseEscrowAction", _releaseEscrowAction);
