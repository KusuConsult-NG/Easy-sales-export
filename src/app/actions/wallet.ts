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

import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import type { Wallet, WalletTransaction } from "@/lib/types/marketplace";
import { smsWithdrawalApproved, smsWithdrawalRejected } from "@/lib/termii";
import { pushWithdrawalDecision } from "@/lib/fcm";
import { isAdmin } from "@/lib/admin-permissions";

const MIN_WITHDRAWAL = 5000;   // ₦5,000 minimum withdrawal (NGN)
const WALLET_COLLECTION = COLLECTIONS.WALLETS;
const TXN_COLLECTION = COLLECTIONS.WALLET_TRANSACTIONS;

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
        createdAt: FieldValue.serverTimestamp() as any,
        updatedAt: FieldValue.serverTimestamp() as any,
    };

    await ref.set(wallet);
    const newSnap = await ref.get();
    return serializeDoc<Wallet>(userId, newSnap.data());
}

// ---------------------------------------------------------------------------
// GET: Retrieve current user's wallet
// ---------------------------------------------------------------------------

export async function getWalletAction(): Promise<{
    error: null, success: true | false;
    wallet?: Wallet;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        const wallet = await _getOrCreateWallet(userId);
        return { error: null, success: true as const, wallet };
    } catch (err: any) {
        logger.error("getWalletAction error:", err);
        return { success: false as const, error: err.message || "Failed to retrieve wallet" };
    }
}

// ---------------------------------------------------------------------------
// FUND: Initialize Paystack payment to top up the wallet
// ---------------------------------------------------------------------------

export async function fundWalletViaPaystackAction(amountNGN: number): Promise<{
    error: null, success: true | false;
    authorizationUrl?: string;
    reference?: string;
}> {
    // Deposits are disabled per request
    const isFundingEnabled = false;
    if (!isFundingEnabled) {
        return { success: false as const, error: "Wallet deposits are currently disabled." };
    }

    try {
        if (typeof amountNGN !== 'number' || !Number.isFinite(amountNGN) || amountNGN < 100) {
            return { success: false as const, error: "Minimum wallet funding amount is ₦100" };
        }

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;
        const userEmail = sessionResult.session.user.email;

        const reference = `WALLET-${userId}-${Date.now()}`;
        const amountKobo = amountNGN * 100; // Paystack uses kobo

        const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: userEmail,
                amount: amountKobo,
                reference,
                channels: ["bank_transfer"],
                callback_url: `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://easysalesexport.com'}/api/wallet/verify?ref=${reference}`,
                metadata: {
                    userId,
                    type: "wallet_funding",
                    amountNGN,
                },
            }),
        });

        const paystackData = await paystackRes.json();
        if (!paystackData.status) {
            return { success: false as const, error: paystackData.message || "Paystack initialization failed" };
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

        return { error: null, success: true as const, authorizationUrl: paystackData.data.authorization_url,
            reference, };
    } catch (err: any) {
        logger.error("fundWalletViaPaystackAction error:", err);
        return { success: false as const, error: err.message || "Failed to initiate wallet funding" };
    }
}

// ---------------------------------------------------------------------------
// CONFIRM: Handle Paystack callback to credit the wallet
// ---------------------------------------------------------------------------

export async function confirmWalletFundingAction(reference: string): Promise<{
    error: null, success: true | false;
    newBalance?: number;
}> {
    try {
        // Verify with Paystack
        const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        });
        const paystackData = await paystackRes.json();

        if (!paystackData.status || paystackData.data.status !== "success") {
            return { success: false as const, error: "Payment verification failed" };
        }

        const metadata = paystackData.data.metadata;
        const amountNGN: number = metadata.amountNGN;
        const userId: string = metadata.userId;

        // Guard: idempotency — mark txn as done only once
        const txnSnap = await db.collection(TXN_COLLECTION)
            .where("reference", "==", reference)
            .where("status", "==", "pending")
            .limit(1)
            .get();

        if (txnSnap.empty) {
            // Either already processed or not found — safe to ignore
            return { success: true as const, error: "Already processed" };
        }

        const txnRef = txnSnap.docs[0].ref;

        // Credit wallet via Firestore transaction for atomicity
        const walletRef = db.collection(WALLET_COLLECTION).doc(userId);

        const newBalance = await db.runTransaction(async (t) => {
            const walletSnap = await t.get(walletRef);
            const currentBalance = walletSnap.exists ? (walletSnap.data()?.balance || 0) : 0;
            const updatedBalance = currentBalance + amountNGN;

            if (walletSnap.exists) {
                t.update(walletRef, { balance: updatedBalance, updatedAt: FieldValue.serverTimestamp() });
            } else {
                t.set(walletRef, {
                    userId,
                    balance: updatedBalance,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // Update the pending transaction record
            t.update(txnRef, {
                balanceBefore: currentBalance,
                balanceAfter: updatedBalance,
                status: "completed",
                updatedAt: FieldValue.serverTimestamp(),
            });

            t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(txnRef.id), {
                id: txnRef.id,
                userId,
                type: "funding",
                module: "wallet",
                amount: amountNGN,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: "Wallet funded successfully"
            }, { merge: true });

            return updatedBalance;
        });

        return { error: null, success: true as const, newBalance };
    } catch (err: any) {
        logger.error("confirmWalletFundingAction error:", err);
        return { success: false as const, error: err.message || "Failed to confirm funding" };
    }
}

// ---------------------------------------------------------------------------
// PURCHASE: Debit wallet to pay for a marketplace order
// ---------------------------------------------------------------------------

export async function walletCheckoutAction(
    orderId: string,
    amountNGN: number
): Promise<{ error: string | null, success: true | false; newBalance?: number;  }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        // CRITICAL SECURITY FIX: Prevent negative-amount inflation attacks and NaN corruption
        if (typeof amountNGN !== 'number' || !Number.isFinite(amountNGN) || amountNGN <= 0) {
            return { success: false as const, error: "Invalid checkout amount" };
        }

        const walletRef = db.collection(WALLET_COLLECTION).doc(userId);

        const newBalance = await db.runTransaction(async (t) => {
            const snap = await t.get(walletRef);
            const currentBalance = snap.exists ? (snap.data()?.balance || 0) : 0;

            if (currentBalance < amountNGN) {
                throw new Error("Insufficient wallet balance");
            }

            const updatedBalance = currentBalance - amountNGN;

            if (snap.exists) {
                t.update(walletRef, { balance: updatedBalance, updatedAt: FieldValue.serverTimestamp() });
            } else {
                t.set(walletRef, {
                    userId,
                    balance: updatedBalance,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // Record the transaction
            const txnRef = db.collection(TXN_COLLECTION).doc();
            t.set(txnRef, {
                walletId: userId,
                userId,
                type: "purchase",
                amount: -amountNGN, // Negative = debit
                balanceBefore: currentBalance,
                balanceAfter: updatedBalance,
                orderId,
                description: `Marketplace purchase — Order`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(txnRef.id), {
                id: txnRef.id,
                userId,
                type: "purchase",
                module: "wallet",
                amount: -amountNGN, // Explicitly negative to show debit in ledger.
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: orderId,
                description: "Marketplace purchase — Order"
            });

            return updatedBalance;
        });

        return { error: null, success: true as const, newBalance };
    } catch (err: any) {
        logger.error("walletCheckoutAction error:", err);
        return { success: false as const, error: err.message || "Wallet checkout failed" };
    }
}

// ---------------------------------------------------------------------------
// WITHDRAW: Submit a withdrawal request (admin-processed)
// ---------------------------------------------------------------------------

export async function withdrawFromWalletAction(
    amountNGN: number,
    bankDetails: { accountNumber: string; bankCode: string; accountName: string; bankName: string }
): Promise<{ error: string | null, success: true | false; withdrawalId?: string;  }> {
    try {
        if (typeof amountNGN !== 'number' || !Number.isFinite(amountNGN)) {
            return { success: false as const, error: "Invalid withdrawal amount" };
        }

        if (amountNGN < MIN_WITHDRAWAL) {
            return {
                success: false as const,
                error: `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL.toLocaleString()}`,
            };
        }

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        const walletRef = db.collection(WALLET_COLLECTION).doc(userId);

        // ATOMICITY FIX: Use transaction to prevent double-spending race conditions
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(walletRef);
            const currentBalance = snap.exists ? (snap.data()?.balance || 0) : 0;

            if (currentBalance < amountNGN) {
                throw new Error("Insufficient balance for withdrawal");
            }

            // Reserve the amount immediately (debit wallet, pending admin approval)
            const newBalance = currentBalance - amountNGN;

            t.update(walletRef, { 
                balance: newBalance, 
                updatedAt: FieldValue.serverTimestamp() 
            });

            const txnRef = db.collection(TXN_COLLECTION).doc();
            t.set(txnRef, {
                walletId: userId,
                userId,
                type: "withdrawal",
                amount: -amountNGN,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                description: `Withdrawal request — ₦${amountNGN.toLocaleString()} to ${bankDetails.bankName}`,
                status: "pending",          // Pending admin processing
                bankDetails,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return { withdrawalId: txnRef.id };
        });

        // Notify admins of the pending withdrawal (Non-blocking post-commit)
        try {
            const adminSnap = await db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "admin")
                .select()
                .get();
            const adminIds = adminSnap.docs.map((d) => d.id);

            const notifBatch = db.batch();
            adminIds.forEach((adminId) => {
                const nRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
                notifBatch.set(nRef, {
                    userId: adminId,
                    type: "payment",
                    title: "Wallet Withdrawal Request",
                    message: `A wallet withdrawal of ₦${amountNGN.toLocaleString()} has been requested.`,
                    link: `/admin/wallets/withdrawals`,
                    linkText: "Process Withdrawal",
                    read: false,
                    createdAt: FieldValue.serverTimestamp(),
                });
            });
            if (adminIds.length > 0) await notifBatch.commit();
        } catch (notifErr) {
            logger.error("Withdrawal admin notification failed:", notifErr);
        }

        return { error: null, success: true as const, withdrawalId: result.withdrawalId };
    } catch (err: any) {
        logger.error("withdrawFromWalletAction error:", err);
        return { success: false as const, error: err.message || "Withdrawal request failed" };
    }
}

// ---------------------------------------------------------------------------
// GET HISTORY: Paginated wallet transaction history for current user
// ---------------------------------------------------------------------------

export async function getWalletTransactionsAction(options?: {
    limit?: number;
    startAfter?: string; // Last transaction doc ID for cursor pagination
}): Promise<{
    error: null, success: true | false;
    transactions?: WalletTransaction[];
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        const pageSize = options?.limit || 20;
        let query = db.collection(TXN_COLLECTION)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(pageSize + 1); // +1 to detect hasMore

        if (options?.startAfter) {
            const cursorDoc = await db.collection(TXN_COLLECTION).doc(options.startAfter).get();
            if (cursorDoc.exists) {
                query = query.startAfter(cursorDoc);
            }
        }

        const snap = await query.get();
        const hasMore = snap.docs.length > pageSize;
        const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

        const transactions = serializeDocs<WalletTransaction>(docs);
        return { error: null, success: true as const, transactions, hasMore };
    } catch (err: any) {
        logger.error("getWalletTransactionsAction error:", err);
        return { success: false as const, error: err.message || "Failed to fetch transactions" };
    }
}

// ---------------------------------------------------------------------------
// ADMIN: Process a pending withdrawal (approve / reject)
// ---------------------------------------------------------------------------

export async function processWalletWithdrawalAction(
    transactionId: string,
    action: "approve" | "reject",
    note?: string
): Promise<{ error: string | null, success: true | false;  }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const adminId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const txnRef = db.collection(TXN_COLLECTION).doc(transactionId);
        const txnSnap = await txnRef.get();
        if (!txnSnap.exists) return { success: false as const, error: "Transaction not found" };

        const txnData = txnSnap.data()!;
        if (txnData.status !== "pending") {
            return { success: false as const, error: "Transaction is no longer pending" };
        }

        if (action === "reject") {
            // Reverse the debit atomically
            await db.runTransaction(async (t) => {
                const freshTxn = await t.get(txnRef);
                if (!freshTxn.exists) throw new Error("Transaction not found");
                if (freshTxn.data()?.status !== "pending") throw new Error("Withdrawal is no longer pending");

                const walletRef = db.collection(WALLET_COLLECTION).doc(txnData.userId);
                const walletSnap = await t.get(walletRef);
                const currentBalance = walletSnap.data()?.balance || 0;
                const refundAmount = Math.abs(txnData.amount);

                t.update(walletRef, {
                    balance: currentBalance + refundAmount,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                t.update(txnRef, {
                    status: "failed",
                    adminNote: note || "Withdrawal rejected by admin",
                    processedBy: adminId,
                    updatedAt: FieldValue.serverTimestamp(),
                });
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
            // Approval Flow — 1. State Lock
            await db.runTransaction(async (t) => {
                const freshTxn = await t.get(txnRef);
                if (!freshTxn.exists) throw new Error("Transaction not found");
                if (freshTxn.data()?.status !== "pending") throw new Error("Withdrawal is no longer pending");

                t.update(txnRef, {
                    status: "payout_initiated",
                    processedBy: adminId,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });

            // 2. Mark as completed (Final status update + Ledger)
            await db.runTransaction(async (t) => {
                t.update(txnRef, {
                    status: "completed",
                    adminNote: note || null,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                // Global Ledger Record (Unified Tracking)
                const reference = `WALLET-WITHDRAW-${transactionId}`;
                const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
                t.set(globalTxRef, {
                    id: reference,
                    userId: txnData.userId,
                    type: "withdrawal",
                    module: "wallet",
                    amount: Math.abs(txnData.amount), // Withdrawal is stored as negative in wallet_txns, absolute in ledger
                    currency: "NGN",
                    status: "completed",
                    date: FieldValue.serverTimestamp(),
                    reference,
                    description: `Wallet withdrawal processed - ${transactionId}`
                });
            });

            // Post-commit side effects: Notifications
            try {
                await db.collection(COLLECTIONS.NOTIFICATIONS).add({
                    userId: txnData.userId,
                    type: "payment",
                    title: "Withdrawal Processed ✅",
                    message: `Your withdrawal of ₦${Math.abs(txnData.amount).toLocaleString()} has been processed and transferred to your bank account.`,
                    link: "/dashboard/wallet",
                    linkText: "View Wallet",
                    read: false,
                    createdAt: FieldValue.serverTimestamp(),
                });

                const userDocApprove = await db.collection(COLLECTIONS.USERS).doc(txnData.userId).get();
                const phoneApprove: string | undefined = userDocApprove.data()?.phone ?? userDocApprove.data()?.phoneNumber;
                await Promise.allSettled([
                    phoneApprove ? smsWithdrawalApproved(phoneApprove, Math.abs(txnData.amount)) : Promise.resolve(),
                    pushWithdrawalDecision(txnData.userId, true, Math.abs(txnData.amount)),
                ]);
            } catch (notifyErr) {
                logger.error("Approval notification error:", notifyErr);
            }
        }

        return { error: null, success: true };
    } catch (err: any) {
        logger.error("processWalletWithdrawalAction error:", err);
        return { success: false as const, error: err.message || "Failed to process withdrawal" };
    }
}

// ---------------------------------------------------------------------------
// ADMIN: Get Paginated Wallet Withdrawals
// ---------------------------------------------------------------------------

export async function getAdminWalletWithdrawalsAction(options: {
    status?: string;
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<{
    error: null, success: true | false;
    data?: any[];
    lastDocId?: string;
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        // Verify admin
        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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

        const withdrawals = serializeDocs(docs);

        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            error: null, success: true as const, 
            data: withdrawals,
            lastDocId: nextCursor,
            hasMore
        };
    } catch (err: any) {
        logger.error("getAdminWalletWithdrawalsAction error:", err);
        return { success: false as const, error: err.message || "Failed to fetch withdrawals" };
    }
}
