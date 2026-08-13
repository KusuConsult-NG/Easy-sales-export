import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { ACADEMY_CONFIG } from "@/lib/constants";
import { normalizeUserDoc } from "@/lib/schema-normalizer";
import { claimPaymentOnce, incrementWithinCeiling } from "@/lib/wallet-ledger";

/**
 * Handle Marketplace Order Fulfillment
 */
export async function processMarketplaceOrder(reference: string, amount: number, userId: string, paidAt?: Date) {

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

    // Fetch buyer and seller emails first (outside transaction, to satisfy read-before-write)
    const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(orderData.buyerId).get();
    const buyerEmail = buyerDoc.exists ? buyerDoc.data()?.email || "" : (orderData.buyerEmail || "");

    const items = orderData.items || [];
    const uniqueSellers = Array.from(new Set(items.map((i: any) => i.sellerId))) as string[];
    const sellerEmails: Record<string, string> = {};
    await Promise.all(
        uniqueSellers.map(async (sellerId) => {
            const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
            sellerEmails[sellerId] = sellerDoc.exists ? sellerDoc.data()?.email || "" : "";
        })
    );

    // Fetch product details
    const productIds = Array.from(new Set(items.map((item: any) => item.productId))) as string[];
    const productDocs = await Promise.all(
        productIds.map(id => db.collection(COLLECTIONS.PRODUCTS).doc(id).get())
    );
    const productDetails: Record<string, { title: string; description: string }> = {};
    productDocs.forEach((doc, idx) => {
        if (doc.exists) {
            productDetails[productIds[idx]] = {
                title: doc.data()?.title || "Unnamed Item",
                description: doc.data()?.description || ""
            };
        }
    });

    const { getPlatformFees } = await import("@/lib/system-settings");
    const fees = await getPlatformFees();

    const buyerIdForClaim = userId || orderData.buyerId;

    // Claim the payment before fulfilling any of it.
    //
    // This was a check-then-write inside runTransaction, which takes no lock:
    // two deliveries of the same Paystack webhook both read "not completed",
    // both fulfilled, and both wrote the marker — duplicate escrow rows,
    // duplicate ledger entries, duplicate seller credits. Paystack retries
    // webhooks by design, so this was not a rare race.
    //
    // If fulfilment below fails, the reference stays claimed and the payment
    // will not retry. Deliberate: a stuck payment somebody investigates beats
    // one that silently fulfils twice. The catch logs loudly for that reason.
    const claim = await claimPaymentOnce({
        reference,
        userId: buyerIdForClaim,
        amount,
        type: "marketplace_order",
        source: "webhook",
        metadata: { orderId: orderData.orderId || orderDoc.id },
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Marketplace Order ${reference} already processed.`);
        return;
    }

    const result = await (async () => {
        const buyerId = buyerIdForClaim;
        const walletRef = db.collection(COLLECTIONS.WALLETS).doc(buyerId);
        const walletSnap = await walletRef.get();
        // Display only: the balanced pair of wallet_transactions rows below is
        // net zero, and no wallet balance is changed by this function.
        let currentBalance = 0;
        if (walletSnap.exists) {
            currentBalance = walletSnap.data()?.balance || 0;
        }

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // 1. Update Order
        await orderRef.update({
            paymentStatus: "escrow_held",
            status: "processing",
            paymentVerifiedAt: paymentTimestamp,
            paidAmount: amount,
            updatedAt: FieldValue.serverTimestamp(),
            paymentMethod: "paystack_webhook"
        });

        // 2. (The processed_payments row is written by claimPaymentOnce above.
        //    Writing it here as well was what made the marker land AFTER the
        //    fulfilment rather than before it.)

        // 2b. Write to Unified Ledger
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId: buyerId,
            type: "marketplace_order",
            module: "marketplace",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Marketplace order payment"
        });

        // 3. Create Escrow Transactions
        const sellerTotals: Record<string, number> = {};
        const deliveryFeePerSeller = (orderData.deliveryFee || 0) / uniqueSellers.length;

        items.forEach((item: any) => {
            const sellerId = item.sellerId;
            const itemTotal = item.pricePerUnit * item.quantity;
            if (!sellerTotals[sellerId]) {
                sellerTotals[sellerId] = 0;
            }
            sellerTotals[sellerId] += itemTotal;
        });

        uniqueSellers.forEach(sellerId => {
            sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller;
        });

        // for...of, not forEach: these writes are awaited now, and an async
        // forEach callback would fire them without waiting — the escrow rows
        // would race the rest of fulfilment and their failures would be
        // unobservable.
        for (const [sellerId, totalAmount] of Object.entries(sellerTotals)) {
            const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

            const platformFee = Math.round(totalAmount * fees.platformFeePercentage);
            const netAmount = totalAmount - platformFee;

            const pNames = items
                .filter((item: any) => item.sellerId === sellerId)
                .map((item: any) => productDetails[item.productId]?.title || item.productTitle || "Unnamed Item");
            const pDescriptions = items
                .filter((item: any) => item.sellerId === sellerId)
                .map((item: any) => productDetails[item.productId]?.description || "")
                .filter(Boolean);

            await escrowRef.set({
                id: escrowId,
                orderId: orderData.orderId,
                buyerId: orderData.buyerId,
                buyerEmail: buyerEmail,
                sellerId: sellerId,
                sellerEmail: sellerEmails[sellerId] || "",
                participants: [orderData.buyerId, sellerId],
                amount: totalAmount,
                grossAmount: totalAmount,
                platformFee: platformFee,
                netAmount: netAmount,
                productName: pNames.join(", ") || "Unnamed Item",
                productDescription: pDescriptions.join("; ") || "",
                status: "funded",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                paidAt: FieldValue.serverTimestamp(),
            });
        }

        // 4. Log the direct Paystack payment in the payments collection
        const paymentId = `PAY-${orderData.orderId || orderDoc.id}`;
        const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
        await paymentRef.set({
            id: paymentId,
            userId: buyerId,
            userEmail: buyerEmail,
            amount: amount,
            currency: "NGN",
            paymentReference: reference,
            status: "success",
            paymentMethod: "paystack",
            purpose: "escrow_payment",
            relatedId: orderData.orderId || orderDoc.id,
            initiatedAt: orderData.createdAt || FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
            sellerId: orderData.sellerId || (uniqueSellers && uniqueSellers[0]) || "",
            sellerIds: orderData.sellerIds || uniqueSellers || [],
            participants: [buyerId, ...(orderData.sellerIds || uniqueSellers || [orderData.sellerId]).filter(Boolean)]
        });

        // 5. Log a balanced pair of transactions in wallet_transactions
        if (!walletSnap.exists) {
            await walletRef.set({
                userId: buyerId,
                balance: 0,
                currency: "NGN",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        } else {
            await walletRef.update({
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        const fundingTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
        const purchaseTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();

        // Funding txn (credit)
        await fundingTxnRef.set({
            id: fundingTxnRef.id,
            walletId: buyerId,
            userId: buyerId,
            type: "funding",
            amount: amount,
            balanceBefore: currentBalance,
            balanceAfter: currentBalance + amount,
            reference: reference,
            description: `Wallet funded via Paystack (Direct Order Payment)`,
            status: "completed",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        // Purchase txn (debit)
        await purchaseTxnRef.set({
            id: purchaseTxnRef.id,
            walletId: buyerId,
            userId: buyerId,
            type: "purchase",
            amount: -amount,
            balanceBefore: currentBalance + amount,
            balanceAfter: currentBalance,
            orderId: orderData.orderId || orderDoc.id,
            description: `Marketplace purchase — Order`,
            status: "completed",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] Order ${orderData.orderId} claimed reference ${reference} ` +
            `but fulfilment did not complete. Needs manual reconciliation.`
        );
        return;
    }

    logger.info(`[Paystack Webhook] Successfully processed Marketplace Order ${orderData.orderId}`);
}

/**
 * Reconciliation function that scans for stuck pending_fulfillment payments and triggers recovery
 */
export async function reconcilePendingFulfillments() {
    logger.info("[Reconciliation] Scanning for stuck pending_fulfillment payments...");
    
    // One L, not two.
    //
    // This queried "pending_fulfillment" while the claim eighty lines below
    // writes "pending_fulfilment" — the British spelling — so the recovery
    // routine for stranded payments could never find a stranded payment. The
    // string with two Ls appears exactly once in the codebase: in this query.
    //
    // cron/reconcile-fulfilment/route.ts filters on the correct spelling, which
    // is why one reconciler works and this one silently did not.
    //
    // Latent rather than live: reconcilePendingFulfillments has no callers
    // today. It matters because it is the thing somebody would wire to a cron
    // the first time money goes missing, and it would report "no stuck payments
    // found" while they existed.
    const stuckQuery = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
        .where("status", "==", "pending_fulfilment")
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
export async function processExportInvestment(reference: string, amount: number, userId: string, exportId: string, paidAt?: Date) {
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

    // Claim the reference before fulfilling, with a NEUTRAL status.
    //
    // This path was the one conversion the atomic-money migration deliberately
    // left alone, because it is not mechanical: it writes the marker with two
    // different statuses — "completed" normally, "overfunded_review" when the
    // investment would exceed the funding goal — and platform_revenue_totals()
    // sums exactly the "completed" rows as revenue. Claiming first means
    // choosing a status before the overfunding branch has run.
    //
    // Resolved as a two-step write: claim as "pending_fulfilment", which is NOT
    // revenue, then promote to the real status once the branch resolves. The
    // alternative — claiming as "completed" — would have started counting
    // overfunded payments as revenue, a behaviour change smuggled inside an
    // idempotency fix.
    //
    // A crash between the claim and the promotion leaves the row at
    // "pending_fulfilment": under-counted rather than over-counted, which is the
    // safe direction, and visible. reconcile-fulfilment reports those rows
    // explicitly — a claimed payment that never fulfilled is exactly what that
    // job exists to surface.
    const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

    const claim = await claimPaymentOnce({
        reference,
        userId,
        amount,
        type: "export_investment",
        source: "webhook",
        status: "pending_fulfilment",
        metadata: { exportId },
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Export Investment ${reference} already processed.`);
        return;
    }

    const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();
    const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);

    // Raise fundedAmount only while it stays within the goal, in one statement.
    //
    // The guard this replaces read fundedAmount, compared
    // `currentFunded + amount > fundingGoal`, and wrote — with no lock. Two
    // investments that each fit under the goal but together exceed it both
    // passed. FieldValue.increment made the total correct (migration 010) but
    // could not enforce the ceiling.
    //
    // The ceiling field name is chosen from the record: windows store the goal
    // under `fundingGoal` OR `goal` depending on when they were written, and
    // hardcoding either would silently uncap half of them, since
    // increment_within_ceiling treats a missing ceiling as unbounded.
    const ceilingField = exportData.fundingGoal !== undefined ? "fundingGoal" : "goal";

    const funded = await incrementWithinCeiling({
        collection: COLLECTIONS.EXPORT_WINDOWS,
        id: exportId,
        field: "fundedAmount",
        amount,
        ceilingField,
    });

    if (!funded.ok) {
        // Overfunded, or the window vanished. Route to manual review and promote
        // the claimed row to the status that keeps it OUT of revenue.
        await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).set({
            reference,
            type: "export_investment",
            userId,
            exportId,
            amount,
            status: "overfunded_review",
            gatewayResponse: funded.reason === "not_found"
                ? "Export window not found when applying investment"
                : "Investment exceeds export window funding goal",
            failedAt: paymentTimestamp,
        }, { merge: true });

        await processedRef.update({
            status: "overfunded_review",
            exportId,
            processedAt: paymentTimestamp,
        });

        logger.warn(`[Paystack Fulfillment] Export Investment ${reference} not applied: ${funded.reason}`);
        return;
    }

    // Fulfilment. The reference is claimed and the funding is applied, so this
    // runs exactly once. The runTransaction wrapper that used to be here bought
    // nothing — the adapter queues the writes and flushes them one at a time
    // after the callback returns, with no isolation and no rollback.
    const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();

    await slotRef.set({
        userId,
        exportId,
        amount,
        status: "active",
        paymentReference: reference,
        purchaseDate: paymentTimestamp,
        createdAt: paymentTimestamp,
        roi: roiLabel,
        returnMultiplier,
        expectedReturn,
        source: "webhook"
    });

    // Export window stats. fundedAmount is deliberately absent: it was already
    // raised by incrementWithinCeiling above, and incrementing it again here
    // would double-count the investment.
    await exportRef.update({
        spotsFilled: FieldValue.increment(1),
        investorCount: FieldValue.increment(1),
        currentFunding: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp()
    });

    // Promote the claimed row to its real status. This is the second half of
    // the two-step write described above, and the point at which the payment
    // starts counting as revenue.
    await processedRef.update({
        status: "completed",
        exportId,
        processedAt: paymentTimestamp,
    });

    // Unified ledger, written last: a crash part-way leaves an investor with a
    // slot and no ledger row rather than a ledger row and no slot.
    await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
        id: reference,
        userId,
        type: "export_investment",
        module: "export",
        amount: amount,
        currency: "NGN",
        status: "completed",
        date: paymentTimestamp,
        reference,
        description: "Export window investment"
    });

    logger.info(`[Paystack Webhook] Successfully processed Export Investment for ${exportId} by ${userId}`);
}

/**
 * Handle Cooperative Membership Registration Fulfillment
 */
export async function processCooperativeRegistration(reference: string, amount: number, userId: string, tier: string, membershipId?: string, paidAt?: Date) {
    const normalisedTier = "Member";

    const expectedAmount = 10000; // Registration fee is 10,000 NGN

    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Cooperative Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    let memberRef: import("@/lib/supabase-db").SupabaseDocumentReference;
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

    // Claim the payment before fulfilling any of it.
    //
    // This checked the marker, fulfilled, then wrote the marker — inside
    // runTransaction, which takes no lock. Two deliveries of the same Paystack
    // webhook both read "not processed" and both fulfilled. Paystack retries
    // webhooks by design.
    const claim = await claimPaymentOnce({
        reference,
        userId,
        amount,
        type: "cooperative_membership_registration",
        source: "webhook",
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Cooperative Registration ${reference} already processed.`);
        return;
    }

    // Fulfilment, in dependency order.
    //
    // This was wrapped in runTransaction, which gave it nothing: the adapter
    // queues the writes and flushes them one by one after the callback returns.
    // There is no isolation and no rollback — a failure part-way through leaves
    // the earlier writes applied either way. The wrapper only made that harder
    // to see, and made the reads inside it look protected when they are not.
    //
    // The payment is already claimed above, so this runs exactly once. What the
    // ordering below buys is the safest partial state if fulfilment dies
    // half-way: the ledger rows are written LAST, so a crash leaves a member
    // recorded without a duplicate ledger entry rather than the reverse.
    const result = await (async () => {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const transactionRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // Check if onboarding was already submitted
        const memberDoc = await memberRef.get();
        const onboardingCompleted = memberDoc.exists && memberDoc.data()?.onboardingCompleted === true;

        await memberRef.set({
            userId,
            paymentStatus: "completed",
            paymentReference: reference,
            membershipTier: normalisedTier,
            membershipStatus: onboardingCompleted ? "active" : "pending",
            paymentVerifiedAt: paymentTimestamp,
            createdAt: paymentTimestamp,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const userUpdatePayload: any = {
            serviceRegistrations: {
                cooperatives: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    membershipTier: normalisedTier,
                    status: onboardingCompleted ? "active" : "legacy_pending_onboarding",
                    paidAt: paymentTimestamp,
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (onboardingCompleted) {
            userUpdatePayload.roles = FieldValue.arrayUnion("cooperative_member");
            userUpdatePayload.isVerified = true;
            userUpdatePayload.serviceRegistrations.cooperatives.activatedAt = paymentTimestamp;
        }

        // FIX: Use set(merge:true) instead of update() so this never throws for
        // new users whose USERS doc doesn't yet have a serviceRegistrations field.
        // set(merge) deep-merges nested maps, so writing the cooperatives
        // segment no longer replaces the user's wave and academy registrations.
        await userRef.set(normalizeUserDoc(userUpdatePayload), { merge: true });

        // Ledger rows last — see the ordering note above.
        await transactionRef.set({
            userId,
            cooperativeId: "default",
            type: "registration_fee",
            amount,
            date: paymentTimestamp,
            status: "completed",
            description: "Cooperative Registration Fee",
            reference
        });

        // (The processed_payments row is written by claimPaymentOnce above.
        //  Writing it here as well is what put the marker AFTER the work.)

        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId,
            type: "cooperative_registration",
            module: "cooperative",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Cooperative membership payment"
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] ${reference} was claimed but fulfilment did not complete. ` +
            `Needs manual reconciliation.`
        );
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
export async function processAcademyRegistration(reference: string, amount: number, userId: string, plan: string, paidAt?: Date) {
    const normalisedPlan = (plan || "foundation").toLowerCase();

    let expectedAmount = ACADEMY_CONFIG.plans.foundation.fee;
    if (normalisedPlan === "standard" || normalisedPlan === "advanced") expectedAmount = ACADEMY_CONFIG.plans.standard.fee;
    if (normalisedPlan === "elite") expectedAmount = ACADEMY_CONFIG.plans.elite.fee;

    const planToStore = (normalisedPlan === "advanced") ? "standard" : normalisedPlan;

    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Academy Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    const appQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
        .where("userId", "==", userId)
        .limit(1)
        .get();

    const hasApp = !appQuery.empty;
    const appDoc = hasApp ? appQuery.docs[0] : null;

    // Claim the payment before fulfilling any of it.
    //
    // This checked the marker, fulfilled, then wrote the marker — inside
    // runTransaction, which takes no lock. Two deliveries of the same Paystack
    // webhook both read "not processed" and both fulfilled. Paystack retries
    // webhooks by design.
    const claim = await claimPaymentOnce({
        reference,
        userId,
        amount,
        type: "academy_registration",
        source: "webhook",
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Academy Registration ${reference} already processed.`);
        return;
    }

    const result = await (async () => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        if (appDoc) {
            await appDoc.ref.update({
                status: "approved",
                paymentStatus: "completed",
                paymentAmount: amount,
                plan: planToStore,
                paymentVerifiedAt: paymentTimestamp,
                reviewedAt: paymentTimestamp,
                reviewedBy: "paystack_auto_approval",
                _version: FieldValue.increment(1)
            });
        }

        const userUpdatePayload: any = {
            serviceRegistrations: {
                academy: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    plan: planToStore,
                    paidAt: paymentTimestamp,
                    status: appDoc ? "approved" : "pending",
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (appDoc) {
            userUpdatePayload.serviceRegistrations.academy.approvedAt = paymentTimestamp;
            userUpdatePayload.serviceRegistrations.academy.applicationId = appDoc.id;
            userUpdatePayload.roles = FieldValue.arrayUnion("academy_participant");
            userUpdatePayload.isVerified = true;
        }

        // DISEASE 2 FIX: normalizeUserDoc ensures academy key is canonical.
        await userRef.set(normalizeUserDoc(userUpdatePayload), { merge: true });

        // (The processed_payments row is written by claimPaymentOnce above.
        //  Writing it here as well is what put the marker AFTER the work.)

        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId,
            type: "academy_registration",
            module: "academy",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Academy registration payment"
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] ${reference} was claimed but fulfilment did not complete. ` +
            `Needs manual reconciliation.`
        );
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
        if (hasApp) {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
        }
    } catch (err) {
        logger.error(`[Paystack Webhook] Cache clear error for ${userId}:`, err);
    }

    logger.info(`[Paystack Webhook] Processed Academy Registration for ${userId}`);
}

/**
 * Handle Farm Nation Fulfillment
 */
export async function processFarmNationRegistration(reference: string, amount: number, userId: string, paidAt?: Date) {
    // Claim the payment before fulfilling any of it.
    //
    // This checked the marker, fulfilled, then wrote the marker — inside
    // runTransaction, which takes no lock. Two deliveries of the same Paystack
    // webhook both read "not processed" and both fulfilled. Paystack retries
    // webhooks by design.
    const claim = await claimPaymentOnce({
        reference,
        userId,
        amount,
        type: "farmnation_registration",
        source: "webhook",
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Farm Nation Registration ${reference} already processed.`);
        return;
    }

    const result = await (async () => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // DISEASE 2 FIX: normalizeUserDoc mirrors farm_nation→farmNation so both keys
        // are always in sync.
        await userRef.set(normalizeUserDoc({
            serviceRegistrations: {
                farm_nation: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    status: "pending",
                    paidAt: paymentTimestamp,
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        // (The processed_payments row is written by claimPaymentOnce above.
        //  Writing it here as well is what put the marker AFTER the work.)

        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId,
            type: "farm_nation_registration",
            module: "farm_nation",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Farm Nation onboarding payment"
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] ${reference} was claimed but fulfilment did not complete. ` +
            `Needs manual reconciliation.`
        );
        return;
    }

    await invalidateUserCache(userId);
    logger.info(`[Paystack Webhook] Processed Farm Nation Registration for ${userId}`);
}

/**
 * Handle WAVE Fulfillment
 */
export async function processWaveRegistration(reference: string, amount: number, userId: string, paidAt?: Date) {
    // Claim the payment before fulfilling any of it.
    //
    // This checked the marker, fulfilled, then wrote the marker — inside
    // runTransaction, which takes no lock. Two deliveries of the same Paystack
    // webhook both read "not processed" and both fulfilled. Paystack retries
    // webhooks by design.
    const claim = await claimPaymentOnce({
        reference,
        userId,
        amount,
        type: "wave_registration",
        source: "webhook",
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] WAVE Registration ${reference} already processed.`);
        return;
    }

    const result = await (async () => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // DISEASE 2 FIX: normalizeUserDoc mirrors wave key and ensures canonical form.
        await userRef.set(normalizeUserDoc({
            serviceRegistrations: {
                wave: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    status: "pending",
                    paidAt: paymentTimestamp,
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });

        // (The processed_payments row is written by claimPaymentOnce above.
        //  Writing it here as well is what put the marker AFTER the work.)

        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId,
            type: "wave_registration",
            module: "wave",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "WAVE onboarding payment"
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] ${reference} was claimed but fulfilment did not complete. ` +
            `Needs manual reconciliation.`
        );
        return;
    }

    await invalidateUserCache(userId);
    logger.info(`[Paystack Webhook] Processed WAVE Registration for ${userId}`);
}

/**
 * Handle Cooperative Savings / Contribution Fulfillment
 */
export async function processCooperativeContribution(reference: string, amount: number, userId: string, paidAt?: Date) {
    // Resolve legacy Firebase UID to active Supabase ID if migrated
    let activeUserId = userId;
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData?._migratedTo) {
            activeUserId = userData._migratedTo;
        } else if (userData?.supabaseAuthId) {
            activeUserId = userData.supabaseAuthId;
        }
    }

    const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(activeUserId);

    // Claim the payment before crediting anything.
    //
    // This checked the marker, credited the member's savings, then wrote the
    // marker — inside runTransaction, which takes no lock. Two deliveries of
    // the same Paystack webhook both read "not processed" and both credited.
    // Paystack retries webhooks by design.
    const claim = await claimPaymentOnce({
        reference,
        userId: activeUserId,
        amount,
        type: "contribution",
        source: "webhook",
    });

    if (!claim.claimed) {
        logger.info(`[Paystack Fulfillment] Cooperative Contribution ${reference} already processed.`);
        return;
    }

    const result = await (async () => {
        const memberDoc = await memberRef.get();
        if (!memberDoc.exists) {
            throw new Error(`Cooperative member record not found for user: ${activeUserId}`);
        }

        const memberData = memberDoc.data() || {};
        const newTier = "Member";
        const cooperativeId = memberData.cooperativeId || "default";

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // 1. Credit the member.
        //
        // Increments rather than read-modify-write. This read totalContributions
        // and savingsBalance, added in JavaScript, and wrote the results back —
        // so a contribution landing at the same time as any other write to the
        // member record lost one of them. FieldValue.increment applies the
        // addition in SQL (migration 010).
        await memberRef.update({
            totalContributions: FieldValue.increment(amount),
            savingsBalance: FieldValue.increment(amount),
            tier: newTier,
            lastContributionAt: paymentTimestamp,
            updatedAt: FieldValue.serverTimestamp()
        });

        // 2. Mark payment as processed
        // (The processed_payments row is written by claimPaymentOnce above.
        //  Writing it here as well is what put the marker AFTER the work.)

        // 3. Write to Unified Ledger
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId: activeUserId,
            type: "contribution",
            module: "cooperative",
            amount,
            currency: "NGN",
            status: "completed",
            date: paymentTimestamp,
            reference,
            description: "Cooperative savings contribution"
        });

        // 4. Cooperative Ledger write
        const coopTxRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
        await coopTxRef.set({
            userId: activeUserId,
            cooperativeId,
            type: "contribution",
            amount,
            date: paymentTimestamp,
            status: "completed",
            description: "Cooperative Contribution",
            reference
        });

        return { success: true };
    })();

    if (!result?.success) {
        // The reference is already claimed, so this will not be retried
        // automatically. Surface it rather than letting it disappear.
        logger.error(
            `[Paystack Fulfillment] Cooperative Contribution ${reference} was claimed but ` +
            `crediting did not complete. Needs manual reconciliation.`
        );
        return;
    }

    try {
        await invalidateUserCache(userId);
    } catch (err) {
        logger.error(`[Paystack Webhook] Cache clear error for cooperative contribution user ${userId}:`, err);
    }

    logger.info(`[Paystack Webhook] Processed Cooperative Contribution of ${amount} for ${userId}`);
}

