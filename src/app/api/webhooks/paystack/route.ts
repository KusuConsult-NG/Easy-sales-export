
import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackWebhook } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";

// Force dynamic since we read headers
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.text();
        const signature = req.headers.get("x-paystack-signature");

        if (!signature) {
            return NextResponse.json({ message: "No signature provided" }, { status: 400 });
        }

        // 1. Verify Signature
        if (!verifyPaystackWebhook(body, signature)) {
            logger.warn("[Paystack Webhook] Invalid signature");
            return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
        }

        const event = JSON.parse(body);

        // 2. Handle 'charge.success'
        if (event.event === "charge.success") {
            const data = event.data;
            const reference = data.reference;
            const amountPaidv = data.amount / 100; // Paystack sends kobo
            const metadata = data.metadata || {};
            const userId = metadata.userId; // user who initiated payment
            // COMPATIBILITY: Old cooperative portal used `purpose` instead of `type`.
            // Always prefer `type`, fall back to `purpose` so legacy payments are handled correctly.
            const type = metadata.type || metadata.purpose || null;

            logger.info(`[Paystack Webhook] Processing success for ${reference}`, { type, amount: amountPaidv });

            // Check if already processed
            const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
            const processedDoc = await processedRef.get();

            if (processedDoc.exists) {
                logger.info(`[Paystack Webhook] Payment ${reference} already processed.`);
                return NextResponse.json({ message: "Already processed" }, { status: 200 });
            }

            // Route based on Payment Type
            // NOTE: Must await each handler — Paystack expects 200 only after full commit.
            // Without await, the function returns before the Firestore transaction completes.
            try {
                if (type === "marketplace_order") {
                    await processMarketplaceOrder(reference, amountPaidv, userId);
                } else if (type === "export_investment") {
                    const exportId = metadata.exportId;
                    await processExportInvestment(reference, amountPaidv, userId, exportId);
                } else if (type === "cooperative_membership_registration") {
                    const tier = metadata.membershipTier || metadata.plan || "basic";
                    // Legacy payments from old portal may not have membershipId — fall back to userId
                    const membershipId = metadata.membershipId || userId;
                    await processCooperativeRegistration(reference, amountPaidv, userId, tier, membershipId);
                } else if (type === "academy_registration") {
                    const plan = metadata.plan;
                    await processAcademyRegistration(reference, amountPaidv, userId, plan);
                } else if (type === "farm_nation_registration" || type === "farm_nation_subscription") {
                    await processFarmNationRegistration(reference, amountPaidv, userId);
                } else if (type === "wave_registration" || type === "wave_application") {
                    await processWaveRegistration(reference, amountPaidv, userId);
                } else {
                    // Log unhandled types so they appear in Vercel logs — never silently drop money.
                    logger.warn(`[Paystack Webhook] UNHANDLED payment type: "${type}" for reference ${reference}. Amount: ${amountPaidv}. Metadata: ${JSON.stringify(metadata)}`);
                    // Still mark as processed to avoid infinite retries.
                    await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference).set({
                        reference, type, userId, amount: amountPaidv,
                        processedAt: FieldValue.serverTimestamp(),
                        source: "webhook",
                        status: "unhandled_type",
                    });
                }
            } catch (processingError: any) {
                logger.error(`[Paystack Webhook] Processing failed for ${reference}:`, processingError);
                // Return 500 so Paystack retries the webhook delivery.
                // Do NOT return 200 here — that would tell Paystack the payment was handled.
                return NextResponse.json(
                    { message: "Processing failed, will retry", error: processingError.message },
                    { status: 500 }
                );
            }

            return NextResponse.json({ message: "Event processed" }, { status: 200 });
        }

        // 3. Handle 'charge.failed' — payment attempt that errored (card declined, network error, etc.)
        if (event.event === "charge.failed") {
            const data = event.data;
            const reference = data.reference;
            const amount = (data.amount ?? 0) / 100;
            const metadata = data.metadata || {};
            const userId = metadata.userId;
            const type = metadata.type;

            logger.warn(`[Paystack Webhook] charge.failed for ${reference} — amount: ${amount}, reason: ${data.gateway_response}`);

            // Upsert into failedPayments — use reference as doc ID for deduplication
            await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).set({
                reference,
                type: type ?? "unknown",
                userId: userId ?? null,
                amount,
                status: "failed",
                gatewayResponse: data.gateway_response ?? null,
                channel: data.channel ?? null,
                currency: data.currency ?? "NGN",
                customerEmail: data.customer?.email ?? null,
                customerName: data.customer?.first_name
                    ? `${data.customer.first_name} ${data.customer.last_name ?? ""}`.trim()
                    : null,
                failedAt: FieldValue.serverTimestamp(),
                paystackEvent: "charge.failed",
                metadata: metadata,
            }, { merge: true });

            return NextResponse.json({ message: "Failure recorded" }, { status: 200 });
        }

        // 4. Handle abandoned transactions — Paystack sends these via the Transactions API
        //    but they can also arrive as charge events with status "abandoned"
        if (event.event === "charge.abandoned" || (event.event === "charge.success" && event.data?.status === "abandoned")) {
            const data = event.data;
            const reference = data.reference;
            const amount = (data.amount ?? 0) / 100;
            const metadata = data.metadata || {};
            const userId = metadata.userId;
            const type = metadata.type;

            logger.info(`[Paystack Webhook] Abandoned transaction: ${reference} — amount: ${amount}`);

            await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).set({
                reference,
                type: type ?? "unknown",
                userId: userId ?? null,
                amount,
                status: "abandoned",
                gatewayResponse: "Customer did not complete payment",
                channel: data.channel ?? null,
                currency: data.currency ?? "NGN",
                customerEmail: data.customer?.email ?? null,
                customerName: data.customer?.first_name
                    ? `${data.customer.first_name} ${data.customer.last_name ?? ""}`.trim()
                    : null,
                abandonedAt: FieldValue.serverTimestamp(),
                failedAt: FieldValue.serverTimestamp(),
                paystackEvent: event.event,
                metadata: metadata,
            }, { merge: true });

            return NextResponse.json({ message: "Abandoned transaction recorded" }, { status: 200 });
        }

        return NextResponse.json({ message: "Event ignored" }, { status: 200 });

    } catch (error: any) {
        logger.error("[Paystack Webhook] Error:", error);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

/**
 * Handle Marketplace Order Fulfillment
 * (Mirrors logic in marketplace-payment.ts)
 */
export async function processMarketplaceOrder(reference: string, amount: number, userId: string) {
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
    // In webhook, we trust Paystack's amount, but we should check if it matches Order expectation
    // Allow 1 naira variance
    if (Math.abs(amount - orderData.totalAmount) > 1) {
        logger.warn(`[Paystack Webhook] Amount mismatch for ${reference}. Paid: ${amount}, Expected: ${orderData.totalAmount}`);
        // We still record the payment but might flag it via status? 
        // For now, proceed but log warning. Or maybe don't release to Escrow "funded" if underpaid?
        // Let's assume strictness:
        if (amount < orderData.totalAmount) {
            throw new Error("Payment amount insufficient");
        }
    }

    await db.runTransaction(async (transaction) => {
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        // 1. Update Order
        transaction.update(orderRef, {
            paymentStatus: "escrow_held",
            status: "processing",
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            paidAmount: amount,
            updatedAt: FieldValue.serverTimestamp(),
            paymentMethod: "paystack_webhook"
        });

        // 2. Mark Processed (Legacy)
        transaction.set(processedRef, {
            processedAt: FieldValue.serverTimestamp(),
            userId: userId || orderData.buyerId,
            amount: amount,
            type: "marketplace_order",
            reference,
            source: "webhook"
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
                amount: totalAmount,
                status: "funded",
                createdAt: FieldValue.serverTimestamp(),
            });
        });
    });

    logger.info(`[Paystack Webhook] Successfully processed Marketplace Order ${orderData.orderId}`);
}

/**
 * Handle Export Investment Fulfillment
 */
export async function processExportInvestment(reference: string, amount: number, userId: string, exportId: string) {
    if (!exportId) throw new Error("Missing exportId in metadata");

    // Read the export window to get real ROI — do this BEFORE the transaction
    // (Firestore reads inside transactions must be done on transaction.get() but
    //  reading reference data outside is fine and avoids holding a long lock).
    const exportSnap = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId).get();
    const exportData = exportSnap.data();

    if (!exportSnap.exists || !exportData) {
        throw new Error(`Export window ${exportId} not found — cannot process investment`);
    }

    // Use values from the window doc; fall back to conservative defaults with a warning.
    const roiLabel: string = exportData.roiPercentage || exportData.roi || "15-20%";
    const returnMultiplier: number = exportData.returnMultiplier ?? exportData.expectedReturnMultiplier ?? 1.20;

    if (!exportData.roiPercentage && !exportData.roi) {
        logger.warn(`[Paystack Webhook] Export window ${exportId} has no ROI field — using default '15-20%'. Add 'roiPercentage' to the window doc.`);
    }

    const expectedReturn = parseFloat((amount * returnMultiplier).toFixed(2));

    await db.runTransaction(async (t) => {
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
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        t.set(processedRef, {
            reference,
            type: "export_investment",
            userId,
            exportId,
            amount,
            processedAt: FieldValue.serverTimestamp(),
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
    });

    logger.info(`[Paystack Webhook] Successfully processed Export Investment for ${exportId} by ${userId}`);
}

/**
 * Handle Cooperative Membership Registration Fulfillment
 */
export async function processCooperativeRegistration(reference: string, amount: number, userId: string, tier: string, membershipId?: string) {
    // Normalise tier to lowercase for consistent comparison
    const normalisedTier = (tier || "basic").toLowerCase();

    // Validate Amount based on Tier
    let expectedAmount = 10000; // basic
    if (normalisedTier === "premium") expectedAmount = 20000;

    // Strict check (allow 1 naira variance)
    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Cooperative Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    // Resolve the membership document reference.
    // The doc ID is membershipId (not userId). Prefer direct lookup via membershipId from metadata.
    let memberRef: FirebaseFirestore.DocumentReference;
    if (membershipId) {
        memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(membershipId);
    } else {
        // Fallback: query by userId field
        const querySnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();
        if (querySnap.empty) {
            throw new Error(`[Paystack Webhook] No cooperative_members doc found for userId ${userId}`);
        }
        memberRef = querySnap.docs[0].ref;
    }

    await db.runTransaction(async (t) => {
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const transactionRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        t.set(memberRef, {
            paymentStatus: "completed",
            paymentReference: reference,
            membershipTier: normalisedTier,
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Update the central USERS document
        t.set(userRef, {
            serviceRegistrations: {
                cooperatives: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    membershipTier: normalisedTier,
                    status: "legacy_pending_onboarding", // Sentinel to show the form but hide payment
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Create the registration fee transaction so it shows in their history
        t.set(transactionRef, {
            userId,
            cooperativeId: "default",
            type: "registration_fee",
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: "Cooperative Registration Fee",
            reference
        });

        t.set(processedRef, {
            reference,
            type: "cooperative_membership_registration",
            userId,
            amount,
            tier,
            processedAt: FieldValue.serverTimestamp(),
            source: "webhook"
        });

        t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
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
    });

    logger.info(`[Paystack Webhook] Processed Cooperative Registration for ${userId}`);

    // Send one-time WhatsApp group invite via email — non-blocking
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
        } else {
            logger.warn(`[Paystack Webhook] No email found for user ${userId} — WhatsApp invite skipped`);
        }
    } catch (inviteError: any) {
        logger.error(`[Paystack Webhook] WhatsApp invite failed for cooperative user ${userId}:`, inviteError);
        // Non-blocking: cooperative registration is already committed
    }
}

/**
 * Handle Academy Registration Fulfillment
 */
export async function processAcademyRegistration(reference: string, amount: number, userId: string, plan: string) {
    // Normalise plan to lowercase for consistent comparison
    const normalisedPlan = (plan || "foundation").toLowerCase();

    // Validate Amount
    let expectedAmount = 25000; // foundation
    if (normalisedPlan === "advanced") expectedAmount = 50000;
    if (normalisedPlan === "elite") expectedAmount = 100000;

    if (amount < expectedAmount - 1) {
        logger.error(`[Paystack Webhook] Academy Payment Underpaid. Expected ${expectedAmount}, Paid ${amount}`);
        throw new Error("Insufficient payment amount");
    }

    await db.runTransaction(async (t) => {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        // 1. Update User Service Registration
        t.set(userRef, {
            serviceRegistrations: {
                academy: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    plan: normalisedPlan,
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 2. Mark Processed
        t.set(processedRef, {
            reference,
            type: "academy_registration",
            userId,
            amount,
            plan,
            processedAt: FieldValue.serverTimestamp(),
            source: "webhook"
        });

        t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
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
    });

    // Auto-create academy_applications record so admin can see paid users
    try {
        const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userSnap.data();
        const applicationId = `ACADEMY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).set({
            userId,
            applicationId,
            personalInfo: {
                fullName: userData?.fullName || userData?.name || "Unknown",
                email: userData?.email || "Unknown",
                phone: userData?.phone || userData?.phoneNumber || "",
            },
            education: {
                educationLevel: "Not provided (auto-created from payment)",
                fieldOfStudy: "Not provided",
            },
            status: "pending",
            paymentStatus: "completed",
            paymentReference: reference,
            paymentAmount: amount,
            plan: normalisedPlan,
            submittedAt: FieldValue.serverTimestamp(),
            source: "webhook",
        });

        // Link the application to the user
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.status": "pending",
        });
    } catch (appError: any) {
        logger.error(`[Paystack Webhook] Failed to create academy_applications doc for ${userId}:`, appError);
        // Non-blocking: payment registration is already committed
    }

    logger.info(`[Paystack Webhook] Processed Academy Registration for ${userId}`);
}

/**
 * Handle Farm Nation Registration Payment
 * NOTE: Farm Nation sends metadata.type = "farm_nation_registration"
 */
export async function processFarmNationRegistration(reference: string, amount: number, userId: string) {
    await db.runTransaction(async (t) => {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        t.set(userRef, {
            serviceRegistrations: {
                farmNation: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    status: "pending_review",
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        t.set(processedRef, {
            reference, type: "farm_nation_registration",
            userId, amount,
            processedAt: FieldValue.serverTimestamp(),
            source: "webhook",
        });

        t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "farm_nation_registration",
            module: "farm_nation",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Farm Nation payment"
        });
    });

    logger.info(`[Paystack Webhook] Processed Farm Nation Registration for ${userId}`);
}

/**
 * Handle WAVE Registration Payment
 * NOTE: WAVE sends metadata.type = "wave_registration" or "wave_application"
 */
export async function processWaveRegistration(reference: string, amount: number, userId: string) {
    await db.runTransaction(async (t) => {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        t.set(userRef, {
            serviceRegistrations: {
                wave: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    status: "pending_review",
                    paidAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        t.set(processedRef, {
            reference, type: "wave_registration",
            userId, amount,
            processedAt: FieldValue.serverTimestamp(),
            source: "webhook",
        });

        t.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
            id: reference,
            userId,
            type: "wave_registration",
            module: "wave",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: "Wave application payment"
        });
    });

    logger.info(`[Paystack Webhook] Processed WAVE Registration for ${userId}`);
}
