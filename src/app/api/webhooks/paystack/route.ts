
import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackWebhook } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";

import { processMarketplaceOrder, processExportInvestment, processCooperativeRegistration, processAcademyRegistration } from "@/infrastructure/payments/service";

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
                    const tier = metadata.membershipTier || metadata.plan || "Member";
                    // Legacy payments from old portal may not have membershipId — fall back to userId
                    const membershipId = metadata.membershipId || userId;
                    await processCooperativeRegistration(reference, amountPaidv, userId, tier, membershipId);
                } else if (type === "academy_registration") {
                    const plan = metadata.plan;
                    await processAcademyRegistration(reference, amountPaidv, userId, plan);
                } else if (type === "wallet_funding") {
                    const { confirmWalletFundingAction } = await import("@/app/actions/wallet");
                    const res = await confirmWalletFundingAction(reference);
                    if (!res.success && res.error !== "Already processed") {
                        throw new Error(res.error || "Wallet funding verification failed");
                    }
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

            // Invalidate Redis caches to ensure Total Revenue and other dashboard stats update immediately
            try {
                const { deleteCache, deleteCachePattern } = await import("@/lib/redis");
                await deleteCache("admin:finance-overview:global");
                await deleteCache("admin:dashboard-stats:global");
                await deleteCachePattern("admin:dashboard-stats:*");
                logger.info("[Paystack Webhook] Invalidated finance and dashboard analytics Redis caches.");
            } catch (cacheErr: any) {
                logger.error("[Paystack Webhook] Cache invalidation error:", cacheErr);
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

