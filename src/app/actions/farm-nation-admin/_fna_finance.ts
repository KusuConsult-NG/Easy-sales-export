"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransition } from "@/lib/status-transition";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

/**
 * Get global stats for Farm Nation admin dashboard
 */
async function _getFarmNationStatsAction(): Promise<ActionResponse<{ stats: { totalApplications: number } }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:farm-nation-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // Redis error should not block the action
        }

        const countSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
            .count()
            .get();
        const totalApplications = countSnap.data().count;

        const response: ActionResponse<{ stats: { totalApplications: number } }> = {
            success: true,
            error: null,
            data: { stats: { totalApplications } }
        };

        try {
            await setCache(cacheKey, response, 120);
        } catch (e) {
            // Redis error should not block the action
        }

        return response;
    } catch (error: any) {
        logger.error("Get farm nation stats error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch farm nation stats", data: null };
    }
}

export const getFarmNationStatsAction = withFlexibleSafeAction("getFarmNationStatsAction", _getFarmNationStatsAction);


/**
 * Get farm nation transactions
 */
async function _getFarmNationTransactionsAction(options: { 
    limit?: number;
    status?: string;
    lastDocId?: string; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const fetchLimit = options.limit || 50;
        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).orderBy("createdAt", "desc");

        if (options.status && options.status !== "all") {
            queryRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await queryRef.limit(fetchLimit).get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.toLowerCase()?.includes("index")) {
                logger.warn("getFarmNationTransactionsAction query failed (missing index). Falling back to memory sorting.");
                indexError = true;
                
                let fallbackQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS);
                if (options.status && options.status !== "all") {
                    fallbackQuery = fallbackQuery.where("status", "==", options.status);
                }
                
                if (options.lastDocId) {
                    const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(options.lastDocId).get();
                    if (lastDoc.exists) {
                        fallbackQuery = fallbackQuery.startAfter(lastDoc);
                    }
                }
                
                snapshot = await fallbackQuery.limit(fetchLimit).get();
            } else {
                throw e;
            }
        }

        const transactions = serializeDocs(snapshot.docs).map((doc: any) => ({
            ...doc,
            createdAt: doc.createdAt || new Date().toISOString(),
            updatedAt: doc.updatedAt || new Date().toISOString(),
            paymentVerifiedAt: doc.paymentVerifiedAt || undefined
        })) as any[];

        if (indexError) {
            transactions.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
        }

        // HYDRATION: Batch-resolve user bank details (Sellers/Participants)
        const participantIds = [...new Set(transactions.map((t: any) => t.sellerId).filter(Boolean))];
        const participantMap: Record<string, any> = {};

        if (participantIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < participantIds.length; i += 30) {
                chunks.push(participantIds.slice(i, i + 30));
            }

            const participantSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where("__name__", "in", chunk)
                        .get()
                )
            );

            participantSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    participantMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: data.bankDetails || {
                            bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "N/A"),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                        }
                    };
                });
            });
        }

        const enrichedTransactions = transactions.map((t: any) => ({
            ...t,
            participant: participantMap[t.sellerId] || null,
            // Fallback for UI components expecting root bankDetails
            bankDetails: participantMap[t.sellerId]?.bankDetails || {
                bankName: "N/A",
                accountNumber: "N/A",
                accountName: "N/A",
                bankCode: "N/A"
            }
        }));

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            error: null, 
            data: enrichedTransactions, 
            meta: {
                lastDocId: nextCursor, 
                hasMore: !!nextCursor,
                totalFetched: enrichedTransactions.length
            }
        };
    } catch (error: any) {
        logger.error("Get admin farm nation transactions error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch transactions", data: null };
    }
}

export const getFarmNationTransactionsAction = withFlexibleSafeAction("getFarmNationTransactionsAction", _getFarmNationTransactionsAction);


/**
 * Release escrow and transfer property ownership
 */
async function _releaseFarmNationEscrowAction(transactionId: string): Promise<ActionResponse<{ message: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const txRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(transactionId);
        
        // Escrow release transfers a property and queues a payout, off a
        // check-then-write that took no lock. Two admins releasing the same
        // escrow both read "held"/"payment_confirmed" and both proceeded.
        //
        // The payout row is keyed on the transaction id, so it could not
        // duplicate — but the ownership transfer and the escrow release both
        // ran twice, and nothing recorded that they had.
        // Everything knowable is checked BEFORE the claim.
        //
        // Claiming first is right — it is what stops two admins both releasing —
        // but it also means anything that throws afterwards leaves the
        // transaction reading "completed" and "released" with the property never
        // transferred and no payout row written. The claim cannot be retried,
        // because a second attempt no longer sees "payment_confirmed": the
        // seller is simply never paid, and the record says the release
        // succeeded.
        //
        // The property going missing and the escrow amount being absent are both
        // knowable now, while backing out still costs nothing. What remains
        // after the claim is a write failure, which is a reconciliation problem
        // rather than a silent one.
        const preTx = await txRef.get();
        if (!preTx.exists) {
            return { success: false, error: "Transaction not found", data: null };
        }

        const preTxData = preTx.data()!;
        const preAmount = Number(preTxData.escrowAmount ?? 0);
        if (!Number.isFinite(preAmount) || preAmount <= 0) {
            return { success: false, error: "Transaction has no escrow amount to release", data: null };
        }

        if (!preTxData.propertyId) {
            return { success: false, error: "Transaction is not linked to a property", data: null };
        }

        const preProperty = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(preTxData.propertyId).get();
        if (!preProperty.exists) {
            return { success: false, error: "Property not found", data: null };
        }

        const releaseClaim = await claimStatusTransition({
            collection: COLLECTIONS.FARM_NATION_TRANSACTIONS,
            id: transactionId,
            from: "payment_confirmed",
            to: "completed",
            patch: {
                escrowStatus: "released",
                escrowReleasedAt: new Date().toISOString(),
                escrowReleasedBy: session.user.id,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!releaseClaim.claimed) {
            return {
                success: false,
                error: releaseClaim.status === null
                    ? "Transaction not found"
                    : "Transaction is not in a valid state for escrow release",
                data: null,
            };
        }

        await (async () => {
            const txDoc = await txRef.get();
            if (!txDoc.exists) throw new Error("Transaction not found");
            const txData = txDoc.data()!;

            const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(txData.propertyId);
            const propertyDoc = await propertyRef.get();
            if (!propertyDoc.exists) throw new Error("Property not found");

            const isLease = propertyDoc.data()?.type === "lease";
            await propertyRef.update({
                status: isLease ? "leased" : "sold",
                ownerId: txData.buyerId,
                ownerEmail: txData.buyerEmail,
                previousOwnerId: txData.sellerId,
                ...(isLease 
                    ? { leasedAt: FieldValue.serverTimestamp() }
                    : { soldAt: FieldValue.serverTimestamp() }),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            // Status and escrowStatus are written by the claim above; only the
            // version bump the CAS patch cannot carry remains.
            await txRef.update({
                _version: FieldValue.increment(1)
            });

            const payoutRef = db.collection("farm_nation_payouts").doc(transactionId);
            await payoutRef.set({
                transactionId,
                propertyId: txData.propertyId,
                sellerId: txData.sellerId,
                amount: txData.escrowAmount,
                status: "pending_transfer",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });
        })();

        return { 
            success: true, 
            error: null, 
            data: { message: "Escrow released and property ownership transferred successfully." }
        };
    } catch (error: any) {
        logger.error("Release Farm Nation Escrow error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: error.message || "Failed to release escrow", data: null };
    }
}

export const releaseFarmNationEscrowAction = withFlexibleSafeAction("releaseFarmNationEscrowAction", _releaseFarmNationEscrowAction);
