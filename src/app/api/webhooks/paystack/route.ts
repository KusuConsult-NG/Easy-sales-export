
import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackWebhook } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";

import { processMarketplaceOrder, processExportInvestment, processCooperativeRegistration, processAcademyRegistration, processCooperativeContribution } from "@/infrastructure/payments/service";

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
            const rawUserId = metadata.userId; // user who initiated payment
            let userId = rawUserId;

            // Resolve legacy Firebase UID to active Supabase ID if migrated
            if (rawUserId) {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(rawUserId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    if (userData?._migratedTo) {
                        userId = userData._migratedTo;
                    } else if (userData?.supabaseAuthId) {
                        userId = userData.supabaseAuthId;
                    }
                }
            }

            // COMPATIBILITY: Old cooperative portal used `purpose` instead of `type`.
            // Always prefer `type`, fall back to `purpose` so legacy payments are handled correctly.
            const type = metadata.type || metadata.purpose || null;

            logger.info(`[Paystack Webhook] Processing success for ${reference}`, { type, amount: amountPaidv, userId });

            const paidAtDate = data.paid_at ? new Date(data.paid_at) : undefined;

            // Atomically claim payment reference in database to prevent concurrent double-processing
            const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
            try {
                await processedRef.create({
                    reference,
                    type,
                    userId,
                    amount: amountPaidv,
                    status: "processing",
                    claimedAt: FieldValue.serverTimestamp(),
                    source: "webhook",
                });
            } catch (claimErr: any) {
                if (claimErr?.code === "ALREADY_EXISTS" || claimErr?.message?.includes("already exists")) {
                    logger.info(`[Paystack Webhook] Payment ${reference} already claimed or processed.`);
                    return NextResponse.json({ message: "Already processed" }, { status: 200 });
                }
                throw claimErr;
            }

            // Route based on Payment Type
            // NOTE: Must await each handler — Paystack expects 200 only after full commit.
            // Without await, the function returns before the Firestore transaction completes.
            try {
                if (type === "marketplace_order") {
                    await processMarketplaceOrder(reference, amountPaidv, userId, paidAtDate);
                } else if (type === "export_investment") {
                    const exportId = metadata.exportId;
                    await processExportInvestment(reference, amountPaidv, userId, exportId, paidAtDate);
                } else if (type === "cooperative_membership_registration") {
                    const tier = metadata.membershipTier || metadata.plan || "Member";
                    // Legacy payments from old portal may not have membershipId — fall back to userId
                    const membershipId = metadata.membershipId || userId;
                    await processCooperativeRegistration(reference, amountPaidv, userId, tier, membershipId, paidAtDate);
                } else if (type === "academy_registration") {
                    const plan = metadata.plan;
                    await processAcademyRegistration(reference, amountPaidv, userId, plan, paidAtDate);
                } else if (type === "contribution") {
                    await processCooperativeContribution(reference, amountPaidv, userId, paidAtDate);
                } else if (type === "wallet_funding") {
                    const { confirmWalletFundingAction } = await import("@/app/actions/wallet");
                    const res = await confirmWalletFundingAction(reference, paidAtDate);
                    if (!res.success && res.error !== "Already processed") {
                        throw new Error(res.error || "Wallet funding verification failed");
                    }
                }

                // Update claim record to completed status
                await processedRef.update({
                    status: type ? "completed" : "unhandled_type",
                    processedAt: FieldValue.serverTimestamp(),
                });
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
                await deleteCache("admin:coop-reports:global");
                await deleteCachePattern("admin:coop-reports:*");
                logger.info("[Paystack Webhook] Invalidated finance, dashboard, and coop report Redis caches.");
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

