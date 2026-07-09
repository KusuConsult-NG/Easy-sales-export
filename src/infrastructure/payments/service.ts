import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { ACADEMY_CONFIG } from "@/lib/constants";
import { normalizeUserDoc } from "@/lib/schema-normalizer";

/**
 * Handle Marketplace Order Fulfillment
 */
export async function processMarketplaceOrder(reference: string, amount: number, userId: string, paidAt?: Date) {
    const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

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

    const result = await db.runTransaction(async (transaction) => {
        const processedSnapTrans = await transaction.get(processedRef);

        if (processedSnapTrans.exists) {
            const data = processedSnapTrans.data();
            if (data?.status === "completed") {
                logger.info(`[Paystack Fulfillment] Marketplace Order ${reference} already processed.`);
                return { alreadyProcessed: true };
            }
        }

        const buyerId = userId || orderData.buyerId;
        const walletRef = db.collection(COLLECTIONS.WALLETS).doc(buyerId);
        const walletSnap = await transaction.get(walletRef);
        let currentBalance = 0;
        if (walletSnap.exists) {
            currentBalance = walletSnap.data()?.balance || 0;
        }

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // 1. Update Order
        transaction.update(orderRef, {
            paymentStatus: "escrow_held",
            status: "processing",
            paymentVerifiedAt: paymentTimestamp,
            paidAmount: amount,
            updatedAt: FieldValue.serverTimestamp(),
            paymentMethod: "paystack_webhook"
        });

        // 2. Set Outbox Document Status to completed
        transaction.set(processedRef, {
            processedAt: paymentTimestamp,
            userId: buyerId,
            amount: amount,
            type: "marketplace_order",
            reference,
            status: "completed",
            source: "webhook",
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        // 2b. Write to Unified Ledger
        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
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

        Object.entries(sellerTotals).forEach(([sellerId, totalAmount]) => {
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

            transaction.set(escrowRef, {
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
        });

        // 4. Log the direct Paystack payment in the payments collection
        const paymentId = `PAY-${orderData.orderId || orderDoc.id}`;
        const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
        transaction.set(paymentRef, {
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
            transaction.set(walletRef, {
                userId: buyerId,
                balance: 0,
                currency: "NGN",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        } else {
            transaction.update(walletRef, {
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        const fundingTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
        const purchaseTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();

        // Funding txn (credit)
        transaction.set(fundingTxnRef, {
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
        transaction.set(purchaseTxnRef, {
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

    const result = await db.runTransaction(async (t) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await t.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Export Investment ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const freshExport = await t.get(exportRef);
        const freshExportData = freshExport.data();

        if (!freshExport.exists || !freshExportData) {
            throw new Error(`Export window ${exportId} not found`);
        }

        const fundingGoal = freshExportData.fundingGoal || freshExportData.goal || 0;
        const currentFunded = freshExportData.fundedAmount || 0;

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        if (currentFunded + amount > fundingGoal) {
            // Overfunded! Route to manual review/audit queue
            t.set(db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference), {
                reference,
                type: "export_investment",
                userId,
                exportId,
                amount,
                status: "overfunded_review",
                gatewayResponse: "Investment exceeds export window funding goal",
                failedAt: paymentTimestamp,
            }, { merge: true });

            t.set(processedRef, {
                reference,
                type: "export_investment",
                userId,
                exportId,
                amount,
                processedAt: paymentTimestamp,
                status: "overfunded_review",
                source: "webhook"
            });

            return { success: true, overfunded: true };
        }

        const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();

        t.set(slotRef, {
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

        // 2. Update Export Window Stats
        t.update(exportRef, {
            spotsFilled: FieldValue.increment(1),
            fundedAmount: FieldValue.increment(amount),
            investorCount: FieldValue.increment(1),
            currentFunding: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp()
        });

        // 3. Mark Payment Processed (Legacy)
        t.set(processedRef, {
            reference,
            type: "export_investment",
            userId,
            exportId,
            amount,
            processedAt: paymentTimestamp,
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
            date: paymentTimestamp,
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

    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Cooperative Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const transactionRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // Check if onboarding was already submitted
        const memberDoc = await transaction.get(memberRef);
        const onboardingCompleted = memberDoc.exists && memberDoc.data()?.onboardingCompleted === true;

        transaction.set(memberRef, {
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
        transaction.set(userRef, normalizeUserDoc(userUpdatePayload), { merge: true });

        // Create transaction fee record
        transaction.set(transactionRef, {
            userId,
            cooperativeId: "default",
            type: "registration_fee",
            amount,
            date: paymentTimestamp,
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
            processedAt: paymentTimestamp,
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
            date: paymentTimestamp,
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

    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Academy Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        if (appDoc) {
            transaction.update(appDoc.ref, {
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
        transaction.set(userRef, normalizeUserDoc(userUpdatePayload), { merge: true });

        transaction.set(processedRef, {
            reference,
            type: "academy_registration",
            userId,
            amount,
            plan: planToStore,
            processedAt: paymentTimestamp,
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
            date: paymentTimestamp,
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
    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Farm Nation Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // DISEASE 2 FIX: normalizeUserDoc mirrors farm_nation→farmNation so both keys
        // are always in sync.
        transaction.set(userRef, normalizeUserDoc({
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

        transaction.set(processedRef, {
            reference,
            type: "farm_nation_registration",
            userId,
            amount,
            processedAt: paymentTimestamp,
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
            date: paymentTimestamp,
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
export async function processWaveRegistration(reference: string, amount: number, userId: string, paidAt?: Date) {
    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] WAVE Registration ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // DISEASE 2 FIX: normalizeUserDoc mirrors wave key and ensures canonical form.
        transaction.set(userRef, normalizeUserDoc({
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

        transaction.set(processedRef, {
            reference,
            type: "wave_registration",
            userId,
            amount,
            processedAt: paymentTimestamp,
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
            date: paymentTimestamp,
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

/**
 * Handle Cooperative Savings / Contribution Fulfillment
 */
export async function processCooperativeContribution(reference: string, amount: number, userId: string, paidAt?: Date) {
    const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

    const result = await db.runTransaction(async (transaction) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const processedSnap = await transaction.get(processedRef);

        if (processedSnap.exists) {
            logger.info(`[Paystack Fulfillment] Cooperative Contribution ${reference} already processed.`);
            return { alreadyProcessed: true };
        }

        const memberDoc = await transaction.get(memberRef);
        if (!memberDoc.exists) {
            throw new Error(`Cooperative member record not found for user: ${userId}`);
        }

        const memberData = memberDoc.data() || {};
        const currentTotal = memberData.totalContributions || 0;
        const newTotal = currentTotal + amount;
        const newTier = "Member";
        const cooperativeId = memberData.cooperativeId || "default";

        const paymentTimestamp = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp();

        // 1. Update membership atomically
        transaction.update(memberRef, {
            totalContributions: newTotal,
            tier: newTier,
            lastContributionAt: paymentTimestamp,
            updatedAt: FieldValue.serverTimestamp()
        });

        // 2. Mark payment as processed
        transaction.set(processedRef, {
            reference,
            type: "contribution",
            userId,
            amount,
            processedAt: paymentTimestamp,
            status: "completed",
            source: "webhook"
        });

        // 3. Write to Unified Ledger
        transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
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
        transaction.set(coopTxRef, {
            userId,
            cooperativeId,
            type: "contribution",
            amount,
            date: paymentTimestamp,
            status: "completed",
            description: "Cooperative Contribution",
            reference
        });

        return { success: true };
    });

    if (result && result.alreadyProcessed) {
        return;
    }

    try {
        await invalidateUserCache(userId);
    } catch (err) {
        logger.error(`[Paystack Webhook] Cache clear error for cooperative contribution user ${userId}:`, err);
    }

    logger.info(`[Paystack Webhook] Processed Cooperative Contribution of ${amount} for ${userId}`);
}

