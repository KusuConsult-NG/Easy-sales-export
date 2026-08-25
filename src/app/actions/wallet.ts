/**
 * Wallet System — Server Actions
 *
 * The wallet allows buyers to pre-load funds and pay for marketplace
 * orders without going through Paystack on every purchase.
 *
 * Minimum withdrawal: ₦5,000 (consistent with WAVE withdrawal policy).
 * All balances are stored in Naira (NGN) as plain integer amounts.
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { getBaseUrl } from "@/lib/server-utils";
import { COLLECTIONS } from "@/lib/types/firestore";
import { creditWalletOnce, debitWalletOnce, debitWalletLocked } from "@/lib/wallet-ledger";
import { claimStatusTransition } from "@/lib/status-transition";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import type { Wallet, WalletTransaction } from "@/lib/types/marketplace";
import { smsWithdrawalApproved, smsWithdrawalRejected } from "@/lib/africastalking";
import { pushWithdrawalDecision } from "@/lib/fcm";
import { hasAdminPermission, rolesWithPermission } from "@/lib/admin-permissions";
import { ActionResponse, withSafeAction } from "@/lib/safe-action";
import { getFeatureToggle } from "./feature-toggles";
import { z } from "zod";
import { paystackBaseUrl } from "@/lib/paystack-host";

const MIN_WITHDRAWAL = 5000;   // ₦5,000 minimum withdrawal (NGN)
const WALLET_COLLECTION = COLLECTIONS.WALLETS;
const TXN_COLLECTION = COLLECTIONS.WALLET_TRANSACTIONS;

// ─── Input Validation Schemas ────────────────────────────────────────────────

const FundWalletSchema = z.object({
    amountNGN: z.number().int().min(100, "Minimum wallet funding amount is ₦100")
});

const ConfirmWalletFundingSchema = z.object({
    reference: z.string().min(1, "Reference is required"),
    paidAt: z.date().optional(),
});

const WalletCheckoutSchema = z.object({
    orderId: z.string().min(1, "Order ID is required"),
    amountNGN: z.number().positive("Invalid checkout amount"),
});

const BankDetailsSchema = z.object({
    accountNumber: z.string().min(5, "Account number must be at least 5 digits").max(30),
    bankCode: z.string().min(2, "Bank code is required"),
    accountName: z.string().min(2, "Account name is required"),
    bankName: z.string().min(2, "Bank name is required"),
});

const WithdrawFromWalletSchema = z.object({
    amountNGN: z.number().min(MIN_WITHDRAWAL, `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL.toLocaleString()}`),
    bankDetails: BankDetailsSchema,
});

const GetWalletTransactionsSchema = z.object({
    limit: z.number().int().positive().optional(),
    startAfter: z.string().optional(),
}).optional();

const ProcessWalletWithdrawalSchema = z.object({
    transactionId: z.string().min(1, "Transaction ID is required"),
    action: z.enum(["approve", "reject"]),
    note: z.string().optional(),
});

const GetAdminWalletWithdrawalsSchema = z.object({
    status: z.string().optional(),
    limit: z.number().int().positive().optional(),
    lastDocId: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
}).optional();

// ─── Hydrated Interfaces ─────────────────────────────────────────────────────

export interface RawWithdrawalTransaction extends WalletTransaction {
    bankDetails?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
        bankCode: string;
    };
}

export interface EnrichedWithdrawal extends RawWithdrawalTransaction {
    user: {
        name: string;
        email: string;
        phone: string;
        bankDetails: {
            bankName: string;
            accountNumber: string;
            accountName: string;
            bankCode: string;
        };
    } | null;
}

// ---------------------------------------------------------------------------
// Internal: Get or create a wallet document for a user
// ---------------------------------------------------------------------------

async function _getOrCreateWallet(userId: string): Promise<Wallet> {
    const ref = db.collection(WALLET_COLLECTION).doc(userId);
    const snap = await ref.get();

    if (snap.exists) {
        return serializeDoc<Wallet>(snap.id, snap.data());
    }

    const wallet: Omit<Wallet, "id"> = {
        userId,
        balance: 0,
        currency: "NGN",
        createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
        updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    };

    await ref.set(wallet);
    const newSnap = await ref.get();
    return serializeDoc<Wallet>(userId, newSnap.data());
}

// ---------------------------------------------------------------------------
// GET: Retrieve current user's wallet
// ---------------------------------------------------------------------------

async function _getWalletAction(): Promise<ActionResponse<Wallet & { 
    stats?: { totalFunded: number; totalSpent: number; pendingWithdrawals: number };
    bankDetails?: { accountNumber: string; bankCode: string; accountName: string; bankName: string } | null;
}>> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
    const { session } = sessionResult;
    const userId = session.user.id;

    const wallet = await _getOrCreateWallet(userId);

    // Fetch aggregate stats over all transactions
    //
    // .all(), because "over all transactions" is what these three figures
    // claim to be. A bare .get() on an unbounded query stops at
    // DEFAULT_QUERY_LIMIT (5,000) and hands back a snapshot indistinguishable
    // from a complete one, so a long-standing account would silently see a
    // Total Funded and Total Spent that stopped counting — and a
    // Pending Withdrawals that could omit a real pending payout.
    const txnsSnap = await db.collection(TXN_COLLECTION)
        .where("userId", "==", userId)
        .all()
        .get();
    if (txnsSnap.truncated) {
        logger.error(`[Wallet] transaction sweep truncated for user ${userId} — the lifetime totals below understate the true figures.`);
    }

    let totalFunded = 0;
    let totalSpent = 0;
    let pendingWithdrawals = 0;

    txnsSnap.docs.forEach((doc) => {
        const data = doc.data();
        const amount = data.amount || 0;
        const status = data.status;
        const type = data.type;

        if (type === "funding" && status === "completed") {
            totalFunded += amount;
        } else if (type === "purchase") {
            totalSpent += Math.abs(amount);
        } else if (type === "withdrawal" && status === "pending") {
            pendingWithdrawals += Math.abs(amount);
        }
    });

    // Fetch user default bank details from profile
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    let bankDetails = null;

    if (userData) {
        const accountNumber = userData.bankAccountNumber || userData.bankDetails?.accountNumber || userData.bankAccount?.accountNumber || "";
        const bankCode = userData.bankCode || userData.bankDetails?.bankCode || userData.bankAccount?.bankCode || "";
        const bankName = userData.bankName || userData.bankDetails?.bankName || userData.bankAccount?.bankName || "";
        const accountName = userData.bankAccountName || userData.bankDetails?.accountName || userData.bankAccount?.accountName || userData.name || userData.fullName || "";

        if (accountNumber && bankName) {
            bankDetails = {
                accountNumber,
                bankCode,
                bankName,
                accountName
            };
        }
    }

    return { 
        error: null, 
        success: true as const, 
        data: { 
            ...wallet, 
            stats: { totalFunded, totalSpent, pendingWithdrawals },
            bankDetails
        } 
    };
}
export const getWalletAction = withSafeAction("getWalletAction", _getWalletAction);

// ---------------------------------------------------------------------------
// FUND: Initialize Paystack payment to top up the wallet
// ---------------------------------------------------------------------------

async function _fundWalletViaPaystackAction(amountNGN: number): Promise<ActionResponse<{ authorizationUrl: string; reference: string }>> {
    FundWalletSchema.parse({ amountNGN });

    const depositsEnabled = await getFeatureToggle("wallet_deposits");
    if (!depositsEnabled) {
        return { success: false as const, error: "Wallet deposits are currently disabled", data: null };
    }

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
    const { session } = sessionResult;
    const userId = session.user.id;
    const userEmail = session.user.email;

    const reference = `WALLET-${userId}-${Date.now()}`;
    const amountKobo = amountNGN * 100; // Paystack uses kobo

    const baseUrl = await getBaseUrl();
    const callbackUrl = `${baseUrl}/api/wallet/verify?ref=${reference}`;

    const paystackRes = await fetch(`${paystackBaseUrl()}/transaction/initialize`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            email: userEmail,
            amount: amountKobo,
            reference,
            channels: ["card", "bank_transfer", "bank", "ussd"],
            callback_url: callbackUrl,
            metadata: {
                userId,
                type: "wallet_funding",
                amountNGN,
            },
        }),
    });

    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
        return { success: false as const, error: paystackData.message || "Paystack initialization failed", data: null };
    }

    // Create a pending wallet transaction record
    await db.collection(TXN_COLLECTION).add({
        walletId: userId,
        userId,
        type: "funding",
        amount: amountNGN,
        balanceBefore: 0, // Will be recalculated on confirmation
        balanceAfter: 0,
        reference,
        description: `Wallet top-up — ₦${amountNGN.toLocaleString()}`,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { 
        error: null, 
        success: true as const, 
        data: {
            authorizationUrl: paystackData.data.authorization_url,
            reference
        }
    };
}
export const fundWalletViaPaystackAction = withSafeAction("fundWalletViaPaystackAction", _fundWalletViaPaystackAction);

// ---------------------------------------------------------------------------
// CONFIRM: Handle Paystack callback to credit the wallet
// ---------------------------------------------------------------------------

async function _confirmWalletFundingAction(reference: string, paidAt?: Date): Promise<ActionResponse<{ newBalance: number }>> {
    ConfirmWalletFundingSchema.parse({ reference, paidAt });

    // Verify with Paystack
    const paystackRes = await fetch(`${paystackBaseUrl()}/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== "success") {
        return { success: false as const, error: "Payment verification failed", data: null };
    }

    const metadata = paystackData.data.metadata;
    const amountNGN: number = metadata.amountNGN;
    const userId: string = metadata.userId;

    // Credit what Paystack says was actually paid, not just what the metadata
    // claims. The cooperative contribution path performs this same check; this
    // one did not, so any divergence between the charged amount and the
    // metadata would have been credited in full without complaint.
    // 1 naira of tolerance for rounding, matching _payment.ts.
    const amountPaidNGN = Number(paystackData.data.amount) / 100;
    if (!Number.isFinite(amountPaidNGN) || !Number.isFinite(amountNGN)) {
        logger.error(`[Wallet] Non-numeric amount for ${reference}`, { amountPaidNGN, amountNGN });
        return { success: false as const, error: "Payment verification failed", data: null };
    }
    if (Math.abs(amountPaidNGN - amountNGN) > 1) {
        logger.error(
            `[Wallet] Amount mismatch for ${reference}: Paystack charged ₦${amountPaidNGN}, metadata claims ₦${amountNGN}`
        );
        return { success: false as const, error: "Payment amount mismatch", data: null };
    }

    const txnSnap = await db.collection(TXN_COLLECTION)
        .where("reference", "==", reference)
        .limit(1)
        .get();

    const txnRef = txnSnap.empty ? null : txnSnap.docs[0].ref;
    const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

    // Claim the reference and credit the wallet in one database statement.
    //
    // This previously read the balance, added to it in JavaScript and wrote the
    // absolute result back inside runTransaction — which takes no lock, so two
    // payments landing together on one wallet lost an update. Idempotency was
    // decided by the "status == pending" query above, which two concurrent
    // deliveries of the same webhook could both pass.
    const { claimed, balance: newBalance } = await creditWalletOnce({
        reference,
        userId,
        amount: amountNGN,
        paymentType: "wallet_funding",
        source: "wallet_funding_action",
    });

    if (!claimed) {
        // A duplicate delivery of a payment already credited. Not an error.
        logger.info(`[Wallet] ${reference} already credited; ignoring duplicate`);
        return { success: false as const, error: "Already processed", data: null };
    }

    // Bookkeeping after the money has moved. These records are descriptive; the
    // balance and the reference claim above are the source of truth, so a
    // failure here cannot double-credit.
    if (txnRef) {
        await txnRef.update({
            balanceAfter: newBalance,
            status: "completed",
            updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection(COLLECTIONS.TRANSACTIONS).doc(txnRef.id).set({
            id: txnRef.id,
            userId,
            type: "funding",
            module: "wallet",
            amount: amountNGN,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Wallet funded successfully"
        }, { merge: true });
    }

    return { error: null, success: true as const, data: { newBalance } };
}
export const confirmWalletFundingAction = withSafeAction("confirmWalletFundingAction", _confirmWalletFundingAction);

// ---------------------------------------------------------------------------
// PURCHASE: Debit wallet to pay for a marketplace order
// ---------------------------------------------------------------------------

async function _walletCheckoutAction(
    orderId: string,
    amountNGN: number
): Promise<ActionResponse<{ newBalance: number }>> {
    WalletCheckoutSchema.parse({ orderId, amountNGN });

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
    const { session } = sessionResult;
    const userId = session.user.id;

    // Debit under a row lock, keyed on the order so a double-submitted checkout
    // charges once.
    //
    // The previous version read the balance and wrote back an absolute value
    // with no lock: two checkouts arriving together both saw the same balance,
    // both passed the sufficiency check, and both charged it — overdrawing the
    // wallet. The order id is the idempotency key because it is stable across
    // retries of the same purchase.
    // WHAT WAS WRONG HERE
    // -------------------
    // `amountNGN` came from the caller and was never compared to the order. The
    // function debited whatever it was told and wrote two ledger rows marked
    // `status: "completed"` for that amount.
    //
    // It never updates the order, so it could not mark an unpaid order paid —
    // but it could write a "completed" purchase row for ₦1 against a ₦50,000
    // order, and reconciliation reads those rows to decide whether a payment
    // produced what it should have.
    //
    // The order is loaded now, the caller must own it, and the amount comes
    // from `totalAmount` rather than the request. The parameter is retained so
    // the signature does not change and is deliberately ignored.
    const orderSnap = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
    if (!orderSnap.exists) {
        return { success: false as const, error: "Order not found", data: null };
    }

    const order = orderSnap.data() as { buyerId?: string; totalAmount?: number };

    if (order.buyerId !== userId) {
        return { success: false as const, error: "Unauthorized", data: null };
    }

    const orderTotal = Number(order.totalAmount || 0);
    if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
        return { success: false as const, error: "This order has no amount to charge", data: null };
    }

    const { ok, balance: newBalance, reason } = await debitWalletOnce({
        reference: `order:${orderId}`,
        userId,
        amount: orderTotal,
        purpose: "marketplace_checkout",
        metadata: { orderId },
    });

    if (!ok) {
        if (reason === "already_processed") {
            logger.info(`[Wallet] Order ${orderId} already charged; ignoring duplicate checkout`);
            return { error: null, success: true as const, data: { newBalance } };
        }
        return { success: false as const, error: "Insufficient wallet balance", data: null };
    }

    // Ledger records, written after the money moved.
    //
    // THE AMOUNT DEBITED, NOT THE AMOUNT REQUESTED.
    //
    // The caller-controlled `amountNGN` was replaced by `orderTotal` in the
    // debit above, and the comment there says the parameter "is deliberately
    // ignored" — but both ledger writes below still used it. So the wallet was
    // charged the right figure while two rows marked `status: "completed"`
    // recorded whatever the request asked for: a ₦1 purchase row against a
    // ₦50,000 order, from the same call. Reconciliation reads exactly these
    // rows to decide whether a payment produced what it should have, so the
    // half-applied fix left the discrepancy where it does the most harm.
    const shortId = orderId.substring(0, 8).toUpperCase();
    const txnRef = db.collection(TXN_COLLECTION).doc();
    await txnRef.set({
        walletId: userId,
        userId,
        type: "purchase",
        amount: -orderTotal, // Negative = debit
        balanceAfter: newBalance,
        orderId,
        description: `Marketplace purchase — Order #${shortId}`,
        status: "completed",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection(COLLECTIONS.TRANSACTIONS).doc(txnRef.id).set({
        id: txnRef.id,
        userId,
        type: "purchase",
        module: "wallet",
        amount: -orderTotal, // Explicitly negative to show debit in ledger.
        currency: "NGN",
        status: "completed",
        date: FieldValue.serverTimestamp(),
        reference: orderId,
        description: `Marketplace purchase — Order #${shortId}`
    });

    return { error: null, success: true as const, data: { newBalance } };
}
export const walletCheckoutAction = withSafeAction("walletCheckoutAction", _walletCheckoutAction);

// ---------------------------------------------------------------------------
// WITHDRAW: Submit a withdrawal request (admin-processed)
// ---------------------------------------------------------------------------

async function _withdrawFromWalletAction(
    amountNGN: number,
    bankDetails: z.infer<typeof BankDetailsSchema>
): Promise<ActionResponse<{ withdrawalId: string }>> {
    WithdrawFromWalletSchema.parse({ amountNGN, bankDetails });

    const withdrawalsEnabled = await getFeatureToggle("wallet_withdrawals");
    if (!withdrawalsEnabled) {
        return { success: false as const, error: "Wallet withdrawals are currently disabled", data: null };
    }

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
    const { session } = sessionResult;
    const userId = session.user.id;

    // Reserve the amount immediately (debit wallet, pending admin approval).
    //
    // The previous version claimed to be an atomicity fix but used
    // runTransaction, which takes no lock: two withdrawal requests arriving
    // together both read the same balance, both passed this check, and both
    // debited. debitWalletLocked takes the row lock, so they serialise.
    //
    // No idempotency reference here — each withdrawal request is a genuinely
    // new intent, and two of them should both succeed if the funds cover both.
    const { ok, balance: newBalance, reason } = await debitWalletLocked({
        userId,
        amount: amountNGN,
    });

    if (!ok) {
        logger.warn(`[Wallet] Withdrawal refused for ${userId}: ${reason}`);
        return { success: false as const, error: "Insufficient balance for withdrawal", data: null };
    }

    const txnRef = db.collection(TXN_COLLECTION).doc();
    await txnRef.set({
        walletId: userId,
        userId,
        type: "withdrawal",
        amount: -amountNGN,
        balanceAfter: newBalance,
        description: `Withdrawal request — ₦${amountNGN.toLocaleString()} to ${bankDetails.bankName}`,
        status: "pending",          // Pending admin processing
        bankDetails,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    const result = { withdrawalId: txnRef.id };

    // Notify admins of the pending withdrawal (Non-blocking post-commit)
    //
    // THE PEOPLE WHO CAN ACTUALLY PROCESS IT.
    //
    // This queried `cooperative_admin` and `super_admin`. Processing a wallet
    // withdrawal requires "finance:process_withdrawals", which the matrix gives
    // to `super_admin` and `admin` — so every cooperative_admin was sent to a
    // screen that refuses them, and no plain admin was told at all. Half the
    // people who can act never heard about the request; the rest could not act
    // on what they heard.
    //
    // Derived from the matrix now, so the audience cannot drift from the gate:
    // grant the permission to another role and it starts being notified.
    try {
        const notifiableRoles = rolesWithPermission("finance:process_withdrawals");
        const adminSnap = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains-any", notifiableRoles)
            .select()
            .get();

        const adminIds = Array.from(new Set(adminSnap.docs.map((d) => d.id)));

        const notifBatch = db.batch();
        adminIds.forEach((adminId) => {
            const nRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
            notifBatch.set(nRef, {
                userId: adminId,
                type: "payment",
                title: "Wallet Withdrawal Request",
                message: `A wallet withdrawal of ₦${amountNGN.toLocaleString()} has been requested.`,
                // /admin/wallets/withdrawals has never existed — there is no
                // /admin/wallets segment at all — so every "Process Withdrawal"
                // an admin clicked led to a 404. The page that processes these
                // is /admin/marketplace/withdrawals: it calls
                // processWalletWithdrawalAction, which is the very action this
                // notification is about. (/admin/withdrawals is a redirect to
                // the WAVE list, which is a different withdrawal entirely.)
                link: `/admin/marketplace/withdrawals`,
                linkText: "Process Withdrawal",
                read: false,
                createdAt: FieldValue.serverTimestamp(),
            });
        });
        if (adminIds.length > 0) await notifBatch.commit();
    } catch (notifErr) {
        logger.error("Withdrawal admin notification failed:", notifErr);
    }

    return { error: null, success: true as const, data: { withdrawalId: result.withdrawalId } };
}
export const withdrawFromWalletAction = withSafeAction("withdrawFromWalletAction", _withdrawFromWalletAction);

// ---------------------------------------------------------------------------
// GET HISTORY: Paginated wallet transaction history for current user
// ---------------------------------------------------------------------------

async function _getWalletTransactionsAction(options?: {
    limit?: number;
    startAfter?: string; // Last transaction doc ID for cursor pagination
}): Promise<ActionResponse<{ transactions: WalletTransaction[]; hasMore: boolean }>> {
    GetWalletTransactionsSchema.parse(options);

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
    const { session } = sessionResult;
    const userId = session.user.id;

    const pageSize = options?.limit || 20;
    // Fetch more to ensure we can satisfy the page limit after filtering
    let query = db.collection(TXN_COLLECTION)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(pageSize * 3 + 1);

    if (options?.startAfter) {
        const cursorDoc = await db.collection(TXN_COLLECTION).doc(options.startAfter).get();
        if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
        }
    }

    const snap = await query.get();
    const rawTransactions = serializeDocs<WalletTransaction>(snap.docs);
    
    // Filter out pending fundings
    const filtered = rawTransactions.filter(
        (t) => !(t.type === "funding" && t.status === "pending")
    );

    const hasMore = filtered.length > pageSize;
    const transactions = hasMore ? filtered.slice(0, pageSize) : filtered;

    return { error: null, success: true as const, data: { transactions, hasMore } };
}
export const getWalletTransactionsAction = withSafeAction("getWalletTransactionsAction", _getWalletTransactionsAction);

// ---------------------------------------------------------------------------
// SPECIFIC ADMIN AND MAINTENANCE MUTATIONS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ADMIN: Process a pending withdrawal (approve / reject)
// ---------------------------------------------------------------------------

async function _processWalletWithdrawalAction(
    transactionId: string,
    action: "approve" | "reject",
    note?: string
): Promise<ActionResponse<null>> {
    ProcessWalletWithdrawalSchema.parse({ transactionId, action, note });

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
    const adminId = sessionResult.session.user.id;

    if (!hasAdminPermission(sessionResult.session.user.roles, "finance:process_withdrawals")) {
        return { success: false as const, error: "Unauthorized", data: null };
    }

    const txnRef = db.collection(TXN_COLLECTION).doc(transactionId);
    const txnSnap = await txnRef.get();
    if (!txnSnap.exists) return { success: false as const, error: "Transaction not found", data: null };

    const txnData = txnSnap.data()!;
    if (txnData.status !== "pending") {
        return { success: false as const, error: "Transaction is no longer pending", data: null };
    }

    if (action === "approve") {
        const requestTime = txnData.createdAt;
        const requestDate = requestTime && typeof (requestTime as unknown as Timestamp).toDate === "function"
            ? (requestTime as unknown as Timestamp).toDate()
            : (requestTime ? new Date(requestTime) : new Date());

        const durationMs = Date.now() - requestDate.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        if (durationHours < 24) {
            return { success: false as const, error: `Withdrawals require a 24-hour pending hold. Please wait ${Math.ceil(24 - durationHours)} more hours.`, data: null };
        }
    }

    if (action === "reject") {
        // Return the reserved amount to the wallet.
        //
        // The previous version read the balance and wrote it back inside
        // runTransaction, guarded only by a "status == pending" check that took
        // no lock — so two admins rejecting the same withdrawal at once could
        // both refund it. The withdrawal id is a stable idempotency key, so the
        // refund is claimed exactly once regardless of how many times this runs.
        //
        // Recorded as "refund" rather than "completed": global-aggregation sums
        // completed rows as revenue, and money going back out is not revenue.
        const refundAmount = Math.abs(txnData.amount);

        const { claimed } = await creditWalletOnce({
            reference: `withdrawal-refund:${txnRef.id}`,
            userId: txnData.userId,
            amount: refundAmount,
            paymentType: "withdrawal_refund",
            source: "wallet_withdrawal_rejected",
            status: "refund",
            metadata: { withdrawalId: txnRef.id, rejectedBy: adminId },
        });

        if (!claimed) {
            // A lost claim means the refund ALREADY happened — rule 3 in
            // wallet-ledger.ts: that is a success, not an error.
            //
            // Returning early here also skipped the status update below, so a
            // rejection that raced left the withdrawal at "pending" for ever
            // while telling the admin it had failed. They would see it in the
            // queue again and try once more, and get the same answer.
            //
            // The status write is idempotent, so it runs either way and the
            // record ends up consistent with the money.
            logger.info(`[Wallet] Withdrawal ${txnRef.id} already refunded; settling status only`);
        }

        await txnRef.update({
            status: "failed",
            adminNote: note || "Withdrawal rejected by admin",
            processedBy: adminId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Post-commit side effects: Notifications
        try {
            await db.collection(COLLECTIONS.NOTIFICATIONS).add({
                userId: txnData.userId,
                type: "payment",
                title: "Withdrawal Rejected",
                message: `Your withdrawal request of ₦${Math.abs(txnData.amount).toLocaleString()} was rejected. The amount has been returned to your wallet.${note ? ` Reason: ${note}` : ""}`,
                link: "/dashboard/wallet",
                linkText: "View Wallet",
                read: false,
                createdAt: FieldValue.serverTimestamp(),
            });

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(txnData.userId).get();
            const phone: string | undefined = userDoc.data()?.phone ?? userDoc.data()?.phoneNumber;
            await Promise.allSettled([
                phone ? smsWithdrawalRejected(phone, Math.abs(txnData.amount), note) : Promise.resolve(),
                pushWithdrawalDecision(txnData.userId, false, Math.abs(txnData.amount)),
            ]);
        } catch (notifyErr) {
            logger.error("Rejection notification error:", notifyErr);
        }
    } else {
        // Approval Flow — 1. Claim the payout.
        //
        // This is the gate that stops a double payout. It was a check-then-write
        // inside runTransaction, which takes no lock: two admins approving the
        // same withdrawal at once both read "pending", both wrote
        // "payout_initiated", and both continued to the Paystack transfer below
        // — paying the user twice, out of the business's money, with nothing
        // raised. One conditional UPDATE means exactly one caller wins.
        const claim = await claimStatusTransition({
            collection: COLLECTIONS.WALLET_TRANSACTIONS,
            id: transactionId,
            from: "pending",
            to: "payout_initiated",
            patch: { processedBy: adminId },
        });

        if (!claim.claimed) {
            if (claim.status === null) {
                return { success: false as const, error: "Transaction not found", data: null };
            }
            // Another admin already took it. Not an error worth retrying.
            logger.info(
                `[Wallet] Withdrawal ${transactionId} already claimed (status: ${claim.status})`
            );
            return { success: false as const, error: "Withdrawal is no longer pending", data: null };
        }

        // 2. Execute payout
        const { paystackPayout, payoutReference } = await import("@/lib/paystack-transfer");
        const bankDetails = txnData.bankDetails || {};
        const payoutAmount = Math.abs(txnData.amount);

        const payoutRes = await paystackPayout(
            {
                accountNumber: bankDetails.accountNumber,
                bankCode: bankDetails.bankCode,
                accountName: bankDetails.accountName || "Recipient",
            },
            payoutAmount,
            `Wallet withdrawal: ${transactionId}`,
            // The same reference on every attempt at THIS withdrawal (#249), so
            // Paystack itself refuses a second transfer rather than honouring it.
            payoutReference("WALLET", transactionId),
        );

        if (!payoutRes.success) {
            /**
             * REOPENING THIS AFTER AN AMBIGUOUS FAILURE PAID PEOPLE TWICE (#250).
             *
             * Every failure used to revert the record to `pending` — the state
             * an admin approves from. But `success: false` also covers a
             * connection reset or a 5xx, where the transfer may have reached
             * Paystack and been honoured. Transfer accepted, response lost,
             * record reopened, admin clicks Approve again, second transfer with
             * a fresh random reference (#249), member paid twice, and both
             * ledger rows look correct.
             *
             * So only a DEFINITE refusal reopens it. Anything we cannot vouch
             * for stays out of the approvable pool and is logged for
             * reconciliation against Paystack's own record of the reference.
             */
            if (payoutRes.duplicate) {
                // Proof the first attempt went through: the member has been paid.
                logger.error(
                    `[Wallet] Withdrawal ${transactionId} was ALREADY transferred under reference ` +
                    `${payoutRes.reference}. Leaving it payout_initiated for reconciliation.`
                );
                await txnRef.update({
                    needsReconciliation: true,
                    adminNote: "Paystack reports this reference as already used — the original transfer stands.",
                    payoutReference: payoutRes.reference || null,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: "This withdrawal has already been transferred", data: null };
            }

            if (payoutRes.indeterminate) {
                logger.error(
                    `[Wallet] Payout for ${transactionId} FAILED INDETERMINATELY (${payoutRes.error}). ` +
                    `Reference ${payoutRes.reference}. The money may have moved; NOT returning it to pending.`
                );
                await txnRef.update({
                    needsReconciliation: true,
                    adminNote: `Payout outcome unknown: ${payoutRes.error || "no response from Paystack"}. `
                        + "Check the reference against Paystack before retrying.",
                    payoutReference: payoutRes.reference || null,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: "Payout outcome unknown — needs reconciliation", data: null };
            }

            // A definite refusal: nothing was sent, so this is safe to reopen.
            await txnRef.update({
                status: "pending",
                adminNote: `Payout attempt failed: ${payoutRes.error || "Unknown error"}`,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { success: false as const, error: payoutRes.error || "Paystack payout failed", data: null };
        }

        // 3. Mark as completed (Final status update + Ledger)
        //
        // Conditional on still being payout_initiated, so a concurrent writer
        // cannot silently overwrite the outcome of a transfer that has already
        // left the building.
        const completion = await claimStatusTransition({
            collection: COLLECTIONS.WALLET_TRANSACTIONS,
            id: transactionId,
            from: "payout_initiated",
            to: "completed",
            patch: {
                adminNote: note || null,
                transferCode: payoutRes.transferCode || null,
                payoutReference: payoutRes.reference || null,
            },
        });

        if (!completion.claimed) {
            // The transfer already succeeded, so this must not read as failure —
            // the money has moved. Record it loudly for reconciliation instead.
            logger.error(
                `[Wallet] Payout for ${transactionId} succeeded but the record was ` +
                `modified concurrently (status: ${completion.status}). ` +
                `Paystack reference: ${payoutRes.reference}. Needs manual reconciliation.`
            );
        }

        // Global Ledger Record (Unified Tracking).
        //
        // A plain write: the status claim above is what guarantees this runs
        // once, and a single-write runTransaction bought nothing but the
        // appearance of safety. Keyed on the Paystack reference, so a retry
        // overwrites rather than duplicating.
        const reference = payoutRes.reference || `WALLET-WITHDRAW-${transactionId}`;
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId: txnData.userId,
            type: "withdrawal",
            module: "wallet",
            amount: payoutAmount, // Withdrawal is stored as negative in wallet_txns, absolute in ledger
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: `Wallet withdrawal processed - ${transactionId}`
        });

        // Post-commit side effects: Notifications
        try {
            await db.collection(COLLECTIONS.NOTIFICATIONS).add({
                userId: txnData.userId,
                type: "payment",
                title: "Withdrawal Processed ✅",
                message: `Your withdrawal of ₦${payoutAmount.toLocaleString()} has been processed and transferred to your bank account.`,
                link: "/dashboard/wallet",
                linkText: "View Wallet",
                read: false,
                createdAt: FieldValue.serverTimestamp(),
            });

            const userDocApprove = await db.collection(COLLECTIONS.USERS).doc(txnData.userId).get();
            const phoneApprove: string | undefined = userDocApprove.data()?.phone ?? userDocApprove.data()?.phoneNumber;
            await Promise.allSettled([
                phoneApprove ? smsWithdrawalApproved(phoneApprove, payoutAmount) : Promise.resolve(),
                pushWithdrawalDecision(txnData.userId, true, payoutAmount),
            ]);
        } catch (notifyErr) {
            logger.error("Approval notification error:", notifyErr);
        }
    }

    // Who approved or rejected this withdrawal, and for how much.
    //
    // This is the platform's wallet payout path — it moves real money out
    // through Paystack — and it wrote nothing to audit_logs. Both branches are
    // covered by one record because both are decisions an admin made about
    // somebody's money.
    //
    // recordAdminAction, not createAdminAuditLog: by this line the transfer has
    // already been made and the ledger row written. A failure to record must
    // not report a completed payout as failed.
    await recordAdminAction({
        action: action === "approve" ? "withdrawal_approved" : "withdrawal_rejected",
        userId: adminId,
        targetId: transactionId,
        targetType: "wallet_withdrawal",
        metadata: { payeeId: txnData.userId, amount: Math.abs(Number(txnData.amount) || 0), note: note ?? null },
    });

    return { error: null, success: true as const , data: null };
}
export const processWalletWithdrawalAction = withSafeAction("processWalletWithdrawalAction", _processWalletWithdrawalAction);

// ---------------------------------------------------------------------------
// ADMIN: Get Paginated Wallet Withdrawals
// ---------------------------------------------------------------------------

async function _getAdminWalletWithdrawalsAction(options: {
    status?: string;
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<ActionResponse<EnrichedWithdrawal[]>> {
    GetAdminWalletWithdrawalsSchema.parse(options);

    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };

    // THIS LIST CARRIES BANK ACCOUNT NUMBERS.
    //
    // The gate was isAdmin() — true for all ten admin roles — while the rows it
    // returns hydrate every withdrawing user's bank name, account number,
    // account name, bank code, email and phone. The action this list exists to
    // feed, processWalletWithdrawalAction, requires
    // "finance:process_withdrawals", held by super_admin and admin only.
    //
    // So a support agent, a moderator, or any of the six module admins could
    // read every user's bank details from a queue they are not permitted to act
    // on. Gated on the permission the queue is FOR, which is the same
    // resolution the other bulk-PII readers took.
    if (!hasAdminPermission(sessionResult.session.user.roles, "finance:process_withdrawals")) {
        return { success: false as const, error: "Unauthorized" , data: null };
    }

    const fetchLimit = options.limit || 25;
    const sortDirection = options.sortOrder || "desc";
    let query = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
        .where("type", "==", "withdrawal")
        .orderBy("createdAt", sortDirection);

    if (options.status && options.status !== "all") {
        query = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
            .where("type", "==", "withdrawal")
            .where("status", "==", options.status)
            .orderBy("createdAt", sortDirection);
    }

    if (options.lastDocId) {
        const lastDoc = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(options.lastDocId).get();
        if (lastDoc.exists) {
            query = query.startAfter(lastDoc);
        }
    }

    const snap = await query.limit(fetchLimit + 1).get();
    const hasMore = snap.docs.length > fetchLimit;
    const docs = hasMore ? snap.docs.slice(0, fetchLimit) : snap.docs;

    const withdrawals = serializeDocs<RawWithdrawalTransaction>(docs);

    // HYDRATION: Batch-resolve user bank details
    const userIds = [...new Set(withdrawals.map(w => w.userId).filter(Boolean))];
    const userMap: Record<string, EnrichedWithdrawal["user"]> = {};

    if (userIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < userIds.length; i += 30) {
            chunks.push(userIds.slice(i, i + 30));
        }

        const userSnapshots = await Promise.all(
            chunks.map(chunk => 
                db.collection(COLLECTIONS.USERS)
                    .where("__name__", "in", chunk)
                    .get()
            )
        );

        userSnapshots.forEach(s => {
            s.forEach(doc => {
                const data = doc.data();
                userMap[doc.id] = {
                    name: data.name || data.fullName || "Unknown",
                    email: data.email || "",
                    phone: data.phone || "",
                    bankDetails: {
                        bankName: data.bankName || "N/A",
                        accountNumber: data.bankAccountNumber || "N/A",
                        accountName: data.bankAccountName || "N/A",
                        bankCode: data.bankCode || "N/A"
                    }
                };
            });
        });
    }

    const enrichedWithdrawals: EnrichedWithdrawal[] = withdrawals.map(w => ({
        ...w,
        user: userMap[w.userId] || null,
        // Fallback for UI components expecting root bankDetails
        bankDetails: userMap[w.userId]?.bankDetails || w.bankDetails || {
            bankName: "N/A",
            accountNumber: "N/A",
            accountName: "N/A",
            bankCode: "N/A"
        }
    }));

    const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

    return { 
        error: null, 
        success: true as const, 
        data: enrichedWithdrawals,
        lastDocId: nextCursor,
        hasMore
    };
}
export const getAdminWalletWithdrawalsAction = withSafeAction("getAdminWalletWithdrawalsAction", _getAdminWalletWithdrawalsAction);
