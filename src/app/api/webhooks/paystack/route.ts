
import { NextRequest, NextResponse } from "next/server";
import { verifyPaystackWebhook } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { generateAndSendWhatsAppInvite } from "@/lib/whatsapp-invites";

import { processMarketplaceOrder, processExportInvestment, processCooperativeRegistration, processAcademyRegistration, processCooperativeContribution } from "@/infrastructure/payments/service";
import { claimPaymentOnce } from "@/lib/wallet-ledger";

/**
 * Types this route dispatches. Anything else is recorded as unhandled rather
 * than dropped — kept next to the dispatch below so the two cannot drift.
 */
const HANDLED_TYPES = new Set([
    "marketplace_order",
    "export_investment",
    "cooperative_membership_registration",
    "academy_registration",
    "contribution",
    "wallet_funding",
]);

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

            // THE CLAIM BELONGS TO THE HANDLER, NOT TO THIS ROUTE.
            //
            // This used to pre-claim the reference here:
            //
            //     await processedRef.create({ status: "processing", ... });
            //
            // and every handler it then calls claims the SAME reference with
            // claimPaymentOnce, which is INSERT ... ON CONFLICT DO NOTHING on
            // processed_payments.id. The row already existed, so every handler
            // got claimed: false, logged "already processed", and returned
            // WITHOUT FULFILLING. The route then marked the row completed and
            // returned 200 to Paystack.
            //
            // Net effect: every webhook-delivered payment recorded as completed
            // and nothing granted. It was invisible only because the webhook
            // URL pointed at a host that rejects POST with 405, so no delivery
            // ever arrived. Correcting the URL would have activated it.
            //
            // There is no pre-claim now. Each handler claims the reference
            // itself, exactly once, and that claim is the idempotency gate —
            // a duplicate delivery makes the handler return early, and this
            // route still answers 200.

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

                // No status write here either. The handlers own the row they
                // claimed, and overwriting it is not harmless: processExportInvestment
                // deliberately records "overfunded_review" to keep an overfunded
                // payment OUT of the revenue total, and a blanket "completed"
                // would put it back in.
                //
                // A type this route does not handle still needs a record, or an
                // unknown payment vanishes silently. It is claimed explicitly,
                // with a status that is NOT "completed" so it is not summed as
                // revenue, and logged loudly enough to be found.
                if (!type || !HANDLED_TYPES.has(type)) {
                    logger.error(`[Paystack Webhook] Unhandled payment type for ${reference}`, { type });
                    await claimPaymentOnce({
                        reference,
                        userId,
                        amount: amountPaidv,
                        type: type || "unknown",
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

