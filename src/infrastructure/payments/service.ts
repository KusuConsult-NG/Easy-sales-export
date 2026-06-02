import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { ACADEMY_CONFIG } from "@/lib/constants";
import { normalizeUserDoc } from "@/lib/schema-normalizer";

/**
 * Handle Marketplace Order Fulfillment
 */
export async function processMarketplaceOrder(reference: string, amount: number, userId: string) {
    // 1. Check outbox entry first before transaction
    const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
    const processedSnap = await processedRef.get();

    if (processedSnap.exists) {
        const data = processedSnap.data();
        if (data?.status === "completed") {
            logger.info(`[Paystack Fulfillment] Marketplace Order ${reference} already processed and completed.`);
            return;
        }
        // If it's pending_fulfillment, we continue to fulfill it.
    } else {
        // Create the pending outbox entry first!
        await processedRef.set({
            processedAt: FieldValue.serverTimestamp(),
            userId: userId,
            amount: amount,
            type: "marketplace_order",
            reference,
            status: "pending_fulfillment",
            source: "webhook"
        });
    }

    // Find order
    const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
        .where("paymentReference", "==", reference)
        .limit(1)
        .get();

    if (orderQuery.empty) {
        logger.error(`[Paystack Webhook] Order not found for ref ${reference}`);
        throw new Error("Order not found");
    }

    const orderDoc = orderQuery.docs[0];
    const orderData = orderDoc.data();

    // Verify Amount (Security Check)
    if (Math.abs(amount - orderData.totalAmount) > 1) {
        logger.warn(`[Paystack Webhook] Amount mismatch for ${reference}. Paid: ${amount}, Expected: ${orderData.totalAmount}`);
        if (amount < orderData.totalAmount) {
            throw new Error("Payment amount insufficient");
        }
    }

    const result = await db.runTransaction(async (transaction) => {
        const processedSnapTrans = await transaction.get(processedRef);

        if (processedSnapTrans.exists) {
            const data = processedSnapTrans.data();
            if (data?.status === "completed") {
                logger.info(`[Paystack Fulfillment] Marketplace Order ${reference} already processed.`);
                return { alreadyProcessed: true };
            }
        }

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);

        // 1. Update Order
        transaction.update(orderRef, {
            paymentStatus: "escrow_held",
            status: "processing",
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            paidAmount: amount,
            updatedAt: FieldValue.serverTimestamp(),
            paymentMethod: "paystack_webhook"
        });

        // 2. Transition Outbox Document Status to completed
        transaction.update(processedRef, {
            status: "completed",
            updatedAt: FieldValue.serverTimestamp()
        });

        // 2b. Write to Unified Ledger
        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId: userId || orderData.buyerId,
            type: "marketplace_order",
            module: "marketplace",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Marketplace order payment"
        });

        // 3. Create Escrow Transactions
        const items = orderData.items || [];
        const sellerTotals: Record<string, number> = {};

        items.forEach((item: any) => {
            const sellerId = item.sellerId;
            const itemTotal = item.pricePerUnit * item.quantity;
            if (!sellerTotals[sellerId]) {
                sellerTotals[sellerId] = 0;
            }
            sellerTotals[sellerId] += itemTotal;
        });

        Object.entries(sellerTotals).forEach(([sellerId, totalAmount]) => {
            const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

            transaction.set(escrowRef, {
                id: escrowId,
                orderId: orderData.orderId,
                buyerId: orderData.buyerId,
                sellerId: sellerId,
                participants: [orderData.buyerId, sellerId],
                amount: totalAmount,
                status: "funded",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    logger.info(`[Paystack Webhook] Successfully processed Marketplace Order ${orderData.orderId}`);
}

/**
 * Reconciliation function that scans for stuck pending_fulfillment payments and triggers recovery
 */
export async function reconcilePendingFulfillments() {
    logger.info("[Reconciliation] Scanning for stuck pending_fulfillment payments...");
    
    // Find processed_payments that are stuck in "pending_fulfillment"
    const stuckQuery = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
        .where("status", "==", "pending_fulfillment")
        .get();

    if (stuckQuery.empty) {
        logger.info("[Reconciliation] No stuck pending_fulfillment payments found.");
        return { reconciled: 0 };
    }

    let reconciledCount = 0;
    for (const doc of stuckQuery.docs) {
        const payment = doc.data();
        const reference = doc.id;
        
        try {
            logger.info(`[Reconciliation] Recovering stuck payment ${reference} for type ${payment.type}...`);
            if (payment.type === "marketplace_order") {
                await processMarketplaceOrder(reference, payment.amount, payment.userId);
                reconciledCount++;
            } else {
                logger.warn(`[Reconciliation] Payment reference ${reference} has unsupported type ${payment.type}`);
            }
        } catch (err) {
            logger.error(`[Reconciliation] Failed to recover payment reference ${reference}:`, err);
        }
    }

    logger.info(`[Reconciliation] Recovered ${reconciledCount} payments.`);
    return { reconciled: reconciledCount };
}

/**
 * Handle Export Investment Fulfillment
 */
export async function processExportInvestment(reference: string, amount: number, userId: string, exportId: string) {
    if (!exportId) throw new Error("Missing exportId in metadata");

    const exportSnap = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId).get();
    const exportData = exportSnap.data();

    if (!exportSnap.exists || !exportData) {
        throw new Error(`Export window ${exportId} not found — cannot process investment`);
    }

    const roiLabel: string = exportData.roiPercentage || exportData.roi || "15-20%";
    const returnMultiplier: number = exportData.returnMultiplier ?? exportData.expectedReturnMultiplier ?? 1.20;

    if (!exportData.roiPercentage && !exportData.roi) {
        logger.warn(`[Paystack Webhook] Export window ${exportId} has no ROI field — using default '15-20%'. Add 'roiPercentage' to the window doc.`);
    }

    const expectedReturn = parseFloat((amount * returnMultiplier).toFixed(2));

    const result = await db.runTransaction(async (t) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await t.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Export Investment ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();

        t.set(slotRef, {
            userId,
            exportId,
            amount,
            status: "active",
            paymentReference: reference,
            purchaseDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            roi: roiLabel,
            returnMultiplier,
            expectedReturn,
            source: "webhook"
        });

        // 2. Update Export Window Stats
        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        t.update(exportRef, {
            spotsFilled: FieldValue.increment(1),
            fundedAmount: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp()
        });

        // 3. Mark Payment Processed (Legacy)
        t.set(processedRef, {
            reference,
            type: "export_investment",
            userId,
            exportId,
            amount,
            processedAt: FieldValue.serverTimestamp(),
            status: "completed",
            source: "webhook"
        });

        // 3b. Write to Unified Ledger
        t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "export_investment",
            module: "export",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Export window investment"
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    logger.info(`[Paystack Webhook] Successfully processed Export Investment for ${exportId} by ${userId}`);
}

/**
 * Handle Cooperative Membership Registration Fulfillment
 */
export async function processCooperativeRegistration(reference: string, amount: number, userId: string, tier: string, membershipId?: string) {
    const normalisedTier = "Member";

    const expectedAmount = 10000; // Registration fee is 10,000 NGN

    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Cooperative Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    let memberRef: FirebaseFirestore.DocumentReference;
    if (membershipId) {
        memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(membershipId);
    } else {
        const querySnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();
        if (!querySnap.empty) {
            memberRef = querySnap.docs[0].ref;
        } else {
            memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            logger.info(`[Cooperative] Creating new member doc for legacy payment userId=${userId} ref=${reference}`);
        }
    }

    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Cooperative Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const transactionRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        transaction.set(memberRef, {
            userId,
            paymentStatus: "completed",
            paymentReference: reference,
            membershipTier: normalisedTier,
            membershipStatus: "pending", // awaiting admin approval
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // FIX: Use set(merge:true) instead of update() so this never throws for
        // new users whose USERS doc doesn't yet have a serviceRegistrations field.
        // update() throws NOT_FOUND if the nested path doesn't exist, causing the
        // entire webhook transaction to fail and leaving the user in payment limbo.
        // DISEASE 2 FIX: normalizeUserDoc mirrors cooperatives→cooperative so both keys
        // are always in sync regardless of which code path reads the user doc.
        transaction.set(userRef, normalizeUserDoc({
            serviceRegistrations: {
                cooperatives: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    membershipTier: normalisedTier,
                    status: "legacy_pending_onboarding",
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        // Create transaction fee record
        transaction.set(transactionRef, {
            userId,
            cooperativeId: "default",
            type: "registration_fee",
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: "Cooperative Registration Fee",
            reference
        });

        transaction.set(processedRef, {
            reference,
            type: "cooperative_membership_registration",
            userId,
            amount,
            tier,
            processedAt: FieldValue.serverTimestamp(),
            status: "completed",
            source: "webhook"
        });

        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "cooperative_registration",
            module: "cooperative",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Cooperative membership payment"
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    try {
        await invalidateUserCache(userId);
    } catch (err) {
        logger.error(`[Paystack Webhook] Cache clear error for ${userId}:`, err);
    }

    logger.info(`[Paystack Webhook] Processed Cooperative Registration for ${userId}`);

    // Send WhatsApp invite
    try {
        const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userSnap.data();
        const userEmail = userData?.email;
        const userName = userData?.fullName || userData?.name || userEmail?.split("@")[0] || "Member";

        if (userEmail) {
            await generateAndSendWhatsAppInvite("cooperative", {
                email: userEmail,
                name: userName,
                userId,
            });
        }
    } catch (inviteError) {
        logger.error(`[Paystack Webhook] WhatsApp invite failed for cooperative user ${userId}:`, inviteError);
    }
}

/**
 * Handle Academy Registration Fulfillment
 */
export async function processAcademyRegistration(reference: string, amount: number, userId: string, plan: string) {
    const normalisedPlan = (plan || "foundation").toLowerCase();

    let expectedAmount = ACADEMY_CONFIG.plans.foundation.fee;
    if (normalisedPlan === "standard" || normalisedPlan === "advanced") expectedAmount = ACADEMY_CONFIG.plans.standard.fee;
    if (normalisedPlan === "elite") expectedAmount = ACADEMY_CONFIG.plans.elite.fee;

    const planToStore = (normalisedPlan === "advanced") ? "standard" : normalisedPlan;

    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Academy Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Academy Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        // DISEASE 2 FIX: normalizeUserDoc ensures academy key is canonical.
        transaction.set(userRef, normalizeUserDoc({
            serviceRegistrations: {
                academy: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    plan: planToStore,
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        transaction.set(processedRef, {
            reference,
            type: "academy_registration",
            userId,
            amount,
            plan: planToStore,
            processedAt: FieldValue.serverTimestamp(),
            status: "completed",
            source: "webhook"
        });

        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "academy_registration",
            module: "academy",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Academy registration payment"
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    // FIX: Do NOT auto-create an ACADEMY_APPLICATIONS doc here.
    // Previously this created a skeleton doc with status="pending", which caused
    // checkAcademyStatusAction() to return "pending" for users who had paid but
    // not yet submitted their form. The UI then redirected them to the
    // "application under review" page, making it impossible to fill the form.
    // The real application doc is created when the user submits the form themselves.
    logger.info(`[Paystack Webhook] Academy payment confirmed for ${userId} — application form not yet submitted.`);

    try {
        await invalidateUserCache(userId);
    } catch (err) {
        logger.error(`[Paystack Webhook] Cache clear error for ${userId}:`, err);
    }

    logger.info(`[Paystack Webhook] Processed Academy Registration for ${userId}`);
}

/**
 * Handle Farm Nation Fulfillment
 */
export async function processFarmNationRegistration(reference: string, amount: number, userId: string) {
    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Farm Nation Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        // DISEASE 2 FIX: normalizeUserDoc mirrors farm_nation→farmNation so both keys
        // are always in sync.
        transaction.set(userRef, normalizeUserDoc({
            serviceRegistrations: {
                farm_nation: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    status: "pending",
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        transaction.set(processedRef, {
            reference,
            type: "farm_nation_registration",
            userId,
            amount,
            processedAt: FieldValue.serverTimestamp(),
            status: "completed",
            source: "webhook"
        });

        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "farm_nation_registration",
            module: "farm_nation",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Farm Nation onboarding payment"
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    await invalidateUserCache(userId);
    logger.info(`[Paystack Webhook] Processed Farm Nation Registration for ${userId}`);
}

/**
 * Handle WAVE Fulfillment
 */
export async function processWaveRegistration(reference: string, amount: number, userId: string) {
    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] WAVE Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        // DISEASE 2 FIX: normalizeUserDoc mirrors wave key and ensures canonical form.
        transaction.set(userRef, normalizeUserDoc({
            serviceRegistrations: {
                wave: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    status: "pending",
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        transaction.set(processedRef, {
            reference,
            type: "wave_registration",
            userId,
            amount,
            processedAt: FieldValue.serverTimestamp(),
            status: "completed",
            source: "webhook"
        });

        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "wave_registration",
            module: "wave",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "WAVE onboarding payment"
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    await invalidateUserCache(userId);
    logger.info(`[Paystack Webhook] Processed WAVE Registration for ${userId}`);
}
