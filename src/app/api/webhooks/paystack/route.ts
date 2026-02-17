
import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackWebhook } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

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
            const type = metadata.type;

            logger.info(`[Paystack Webhook] Processing success for ${reference}`, { type, amount: amountPaidv });

            // Check if already processed
            const processedRef = db.collection("processedPayments").doc(reference);
            const processedDoc = await processedRef.get();

            if (processedDoc.exists) {
                logger.info(`[Paystack Webhook] Payment ${reference} already processed.`);
                return NextResponse.json({ message: "Already processed" }, { status: 200 });
            }

            // Route based on Payment Type
            if (type === "marketplace_order") {
                processMarketplaceOrder(reference, amountPaidv, userId);
            } else if (type === "export_investment") {
                const exportId = metadata.exportId;
                processExportInvestment(reference, amountPaidv, userId, exportId);
            } else if (type === "cooperative_contribution") {
                // Placeholder for cooperative logic
            }

            return NextResponse.json({ message: "Event processed" }, { status: 200 });
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
async function processMarketplaceOrder(reference: string, amount: number, userId: string) {
    // Find order
    const orderQuery = await db.collection("marketplaceOrders")
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
        const orderRef = db.collection("marketplaceOrders").doc(orderDoc.id);
        const processedRef = db.collection("processedPayments").doc(reference);

        // 1. Update Order
        transaction.update(orderRef, {
            paymentStatus: "escrow_held",
            orderStatus: "processing",
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            paidAmount: amount,
            updatedAt: FieldValue.serverTimestamp(),
            paymentMethod: "paystack_webhook"
        });

        // 2. Mark Processed
        transaction.set(processedRef, {
            processedAt: FieldValue.serverTimestamp(),
            userId: userId || orderData.buyerId,
            amount: amount,
            type: "marketplace_order",
            reference,
            source: "webhook"
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
            const escrowRef = db.collection("escrow_transactions").doc(escrowId);

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
async function processExportInvestment(reference: string, amount: number, userId: string, exportId: string) {
    if (!exportId) throw new Error("Missing exportId in metadata");

    await db.runTransaction(async (t) => {
        // 1. Create Investment Record (Slot)
        const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();
        // Check if already exists (idempotency check done at controller level, but double check?)
        // Since we generate a new ID, we can't check by ID. But controller checked processedPayments.

        t.set(slotRef, {
            userId,
            exportId,
            amount,
            status: "active",
            paymentReference: reference,
            purchaseDate: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            roi: "15-20%", // Should fetch from window
            expectedReturn: amount * 1.20, // Simplified logic
            source: "webhook"
        });

        // 2. Update Export Window Stats
        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        t.update(exportRef, {
            spotsFilled: FieldValue.increment(1),
            fundedAmount: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp()
        });

        // 3. Mark Payment Processed
        const processedRef = db.collection("processedPayments").doc(reference);
        t.set(processedRef, {
            reference,
            type: "export_investment",
            userId,
            exportId,
            amount,
            processedAt: FieldValue.serverTimestamp(),
            source: "webhook"
        });
    });

    logger.info(`[Paystack Webhook] Successfully processed Export Investment for ${exportId} by ${userId}`);
}
