export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby max; upgrade to 300 on Pro if needed

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { withRateLimit } from "@/lib/rate-limit";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
// #531 The dispatch table, shared with the webhook and cron/reconcile-paystack.
// This route's own chain routed eight of the nine processors — it could not
// fulfil a cooperative contribution — and wrote everything it could not route
// as `status: "completed"`.
import {
    dispatchPaystackPayment,
    UNHANDLED_PAYMENT_STATUS,
} from "@/infrastructure/payments/payment-router";
import { resolveActiveUserId } from "@/lib/user-identity";
import { recordAdminAction } from "@/lib/audit-log";
import { eachPaystackTransaction } from "@/lib/paystack-sweep";

interface PaystackTx {
    reference: string;
    status: "success" | "failed" | "abandoned";
    amount: number; // kobo
    paid_at: string | null;
    created_at: string;
    metadata: Record<string, any>;
    gateway_response: string;
    channel: string | null;
    currency: string;
    customer: { email: string; first_name?: string; last_name?: string } | null;
}

/**
 * Fetch ALL pages for a given Paystack status bucket.
 * status param: 'success' | 'failed' | 'abandoned'
 * perPage is capped at 100 by Paystack.
 */
/**
 *   #519 THE FIFTH COPY, AND THE ONE THAT WRITES.
 *
 *   This ended on `json.meta?.pageCount ?? 1` — the expression
 *   analytics.service.ts records removing from three sites because "it cannot
 *   tell 'the API sent no page count' apart from 'there is one page'".
 *
 *   The other copies produce an understated FIGURE. This route PROCESSES what
 *   it reads: it hands each transaction to processMarketplaceOrder,
 *   processWalletFunding, processCooperativeRegistration and the rest. Stopping
 *   after page one means the sync silently only ever repairs the hundred most
 *   recent payments, and every unprocessed payment older than that stays
 *   unprocessed however many times an admin runs it — which is exactly the
 *   failure a manual sync button exists to fix.
 */
async function fetchAllPaystackByStatus(
    status: "success" | "failed" | "abandoned",
    PAYSTACK_SECRET_KEY: string,
): Promise<{ transactions: PaystackTx[]; truncated: boolean }> {
    const transactions: PaystackTx[] = [];
    const sweep = await eachPaystackTransaction(
        PAYSTACK_SECRET_KEY,
        { label: `PaystackSync:${status}`, status, timeoutMs: 10_000 },
        (tx) => { transactions.push(tx as PaystackTx); },
    );
    if (sweep.truncated) {
        logger.error(
            `[PaystackSync] the ${status} sweep hit its page ceiling — transactions beyond it `
            + `were NOT processed by this run.`,
        );
    }
    return { transactions, truncated: sweep.truncated };
}

/**
 * GET /api/admin/finance/paystack-sync
 *
 * Fetches ALL Paystack transactions from the Paystack API and back-fills any
 * missing records into Firestore (processedPayments / failedPayments).
 *
 * This is idempotent — existing Firestore docs are skipped, never overwritten.
 */
async function paystackSyncHandler(_req: NextRequest) {
    try {
        // ── Auth guard ────────────────────────────────────────────────────────
        // finance:reconcile, not finance:read.
        //
        // This route reads nothing. Every successful transaction it finds goes
        // through processMarketplaceOrder, processExportInvestment,
        // processCooperativeRegistration, processAcademyRegistration,
        // processFarmNationRegistration, processWaveRegistration or
        // confirmWalletFundingAction — the same processors the Paystack webhook
        // uses. They grant roles, activate memberships and credit wallets.
        //
        // finance:read is held by support, cooperative_admin and
        // marketplace_admin, none of which hold any other finance permission.
        // So a support agent could trigger platform-wide payment fulfilment.
        //
        // The matrix already had the right shape — finance:process_withdrawals
        // is held by super_admin and admin alone — and that is the set
        // finance:reconcile is granted to. The permission is new only because
        // none of the existing names describe replaying fulfilment.
        //
        // The scheduled twin of this job, cron/reconcile-paystack, runs the
        // same processors behind CRON_SECRET and was always guarded correctly.
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:reconcile")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
        if (!PAYSTACK_SECRET_KEY) {
            return NextResponse.json({ success: false, error: "PAYSTACK_SECRET_KEY not configured" }, { status: 500 });
        }

        // ── Fetch all pages from Paystack — one pass per status bucket ──────────
        // Paystack's /transaction endpoint without a status filter does NOT reliably
        // return all abandoned transactions. We must query each status explicitly.
        logger.info("[PaystackSync] Fetching success, failed, and abandoned transactions from Paystack...");

        const [successSweep, failedSweep, abandonedSweep] = await Promise.all([
            fetchAllPaystackByStatus("success", PAYSTACK_SECRET_KEY),
            fetchAllPaystackByStatus("failed", PAYSTACK_SECRET_KEY),
            fetchAllPaystackByStatus("abandoned", PAYSTACK_SECRET_KEY),
        ]);
        const successTxs = successSweep.transactions;
        const failedTxs = failedSweep.transactions;
        const abandonedTxs = abandonedSweep.transactions;
        //   A sync that could not read everything has not synced everything, and
        //   the admin who pressed the button needs to know that before concluding
        //   the remaining gaps are real.
        const syncTruncated = successSweep.truncated || failedSweep.truncated || abandonedSweep.truncated;

        // Deduplicate by reference (a tx should only appear in one bucket, but just in case)
        const seen = new Set<string>();
        const allTxs: PaystackTx[] = [];
        for (const tx of [...successTxs, ...failedTxs, ...abandonedTxs]) {
            if (!seen.has(tx.reference)) {
                seen.add(tx.reference);
                allTxs.push(tx);
            }
        }

        logger.info(`[PaystackSync] Fetched ${allTxs.length} total (success: ${successTxs.length}, failed: ${failedTxs.length}, abandoned: ${abandonedTxs.length})`);

        // ── Back-fill missing docs into Firestore ──────────────────────────────
        let synced = 0;
        let skipped = 0;
        let errors = 0;
        //   #531 Payments nothing here can fulfil, counted and NAMED.
        //
        //   They used to be written as `status: "completed"` and added to
        //   `synced`. Four readers sum PROCESSED_PAYMENTS where status is
        //   "completed" as revenue, and this route skips a reference already
        //   marked completed — so an unroutable payment entered the revenue
        //   figure with nobody credited and could never be healed afterwards.
        let unhandled = 0;
        const unhandledReferences: string[] = [];

        // Process in chunks to avoid overwhelming Firestore
        const CHUNK = 50;
        for (let i = 0; i < allTxs.length; i += CHUNK) {
            const chunk = allTxs.slice(i, i + CHUNK);

            await Promise.allSettled(
                chunk.map(async (tx) => {
                    try {
                        const reference = tx.reference;
                        const isSuccess = tx.status === "success";
                        const isFailed = tx.status === "failed";
                        const isAbandoned = tx.status === "abandoned";
                        const amountNGN = tx.amount / 100;
                        const metadata = tx.metadata || {};
                        // COMPATIBILITY: Old cooperative portal used `purpose` instead of `type`.
                        //
                        //   #531 `|| "payment"` was a THIRD spelling of "we do not
                        //   know". The webhook and the cron both use `|| null`, and
                        //   a placeholder that reads like a real type is how an
                        //   unroutable payment came to be written as completed.
                        const type = metadata.type || metadata.purpose || null;

                        //   #531 The legacy identity chain, which this route alone
                        //   did not walk. It read `metadata.userId ?? null` while
                        //   the webhook and the cron both call resolveActiveUserId
                        //   — #449: "on a twice-migrated member the session said one
                        //   account and this credited another". This is the MANUAL
                        //   repair tool, reached precisely when a payment did not
                        //   land, so fulfilling it against a stale identity is the
                        //   worst place for that gap to have been.
                        const rawUserId = metadata.userId ?? null;
                        const userId = rawUserId
                            ? (await resolveActiveUserId(rawUserId, db.collection(COLLECTIONS.USERS))).id
                            : null;
                        const paidAtDate = tx.paid_at ? new Date(tx.paid_at) : undefined;

                        if (isSuccess) {
                            const docRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
                            const snap = await docRef.get();
                            
                            // Skip ONLY if we already fully synced it
                            if (snap.exists && snap.data()?.status === "completed") {
                                skipped++;
                                return; // or let it hit next condition
                            }

                            // The user requested to strictly enforce Paystack numbers. By using the core
                            // webhook processors here, we ensure that resolving a 'pending' payment
                            // automatically updates the user's cooperative/academy/etc documents too!
                            const handled = await dispatchPaystackPayment(type, {
                                reference, amount: amountNGN, userId: userId as string, metadata, paidAt: paidAtDate,
                            });

                            if (!handled) {
                                //   #531 THIS BRANCH USED TO WRITE `status: "completed"`.
                                //
                                //   A payment nothing here can fulfil was recorded as
                                //   a completed payment — summed as revenue by four
                                //   readers, and skipped by the check twenty lines
                                //   above on every later run, so it could never be
                                //   healed. The webhook's own note says why that is
                                //   wrong: "with a status that is NOT 'completed' so
                                //   it is not summed as revenue, and logged loudly
                                //   enough to be found."
                                //
                                //   Same status the webhook writes, so the two doors
                                //   leave one kind of record and an admin looking for
                                //   these has one thing to search for.
                                await docRef.set({
                                    reference,
                                    type: type || "unknown",
                                    userId,
                                    amount: amountNGN,
                                    status: UNHANDLED_PAYMENT_STATUS,
                                    processedAt: tx.paid_at ? new Date(tx.paid_at) : FieldValue.serverTimestamp(),
                                    source: "paystack_sync",
                                    channel: tx.channel ?? null,
                                    currency: tx.currency ?? "NGN",
                                    customerEmail: tx.customer?.email ?? null,
                                    metadata,
                                }, { merge: true });

                                unhandled++;
                                unhandledReferences.push(reference);
                                logger.error(
                                    `[PaystackSync] ${reference} could not be routed — type "${type}". `
                                    + `Recorded as ${UNHANDLED_PAYMENT_STATUS}, NOT as revenue.`,
                                );
                                return;
                            }

                            synced++;
                            logger.info(`[PaystackSync] Back-filled successful payment & updated module UI: ${reference}`);
                        } else if (isFailed || isAbandoned) {
                            const docRef = db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference);
                            const snap = await docRef.get();
                            if (!snap.exists) {
                                await docRef.set({
                                    reference,
                                    type,
                                    userId,
                                    amount: amountNGN,
                                    status: isAbandoned ? "abandoned" : "failed",
                                    gatewayResponse: tx.gateway_response ?? null,
                                    channel: tx.channel ?? null,
                                    currency: tx.currency ?? "NGN",
                                    customerEmail: tx.customer?.email ?? null,
                                    customerName: tx.customer?.first_name
                                        ? `${tx.customer.first_name} ${tx.customer.last_name ?? ""}`.trim()
                                        : null,
                                    failedAt: tx.created_at ? new Date(tx.created_at) : FieldValue.serverTimestamp(),
                                    abandonedAt: isAbandoned
                                        ? (tx.created_at ? new Date(tx.created_at) : FieldValue.serverTimestamp())
                                        : null,
                                    paystackEvent: isAbandoned ? "charge.abandoned" : "charge.failed",
                                    metadata,
                                    source: "paystack_sync",
                                });
                                synced++;
                                logger.info(`[PaystackSync] Back-filled ${tx.status} payment: ${reference}`);
                            } else {
                                skipped++;
                            }
                        } else {
                            // Pending / initialised — ignore
                            skipped++;
                        }
                    } catch (err: any) {
                        errors++;
                        logger.error(`[PaystackSync] Error processing ${tx.reference}:`, err);
                    }
                })
            );
        }

        logger.info(`[PaystackSync] Done. synced=${synced} skipped=${skipped} unhandled=${unhandled} errors=${errors}`);

        try {
            const { deleteCache, deleteCachePattern } = await import("@/lib/redis");
            await deleteCache("admin:finance-overview:global");
            await deleteCache("admin:dashboard-stats:global");
            await deleteCachePattern("admin:dashboard-stats:*");
            logger.info("[PaystackSync] Invalidated finance and dashboard analytics Redis caches.");
        } catch (cacheErr: any) {
            logger.error("[PaystackSync] Cache invalidation error:", cacheErr);
        }

        await recordAdminAction({
            action: 'paystack_sync_run',
            userId: session.user.id,
            targetType: 'paystack_reconciliation',
            //   #531 What the run DID, not just what it read.
            //
            //   The row recorded `{ total }` alone — the number of transactions
            //   fetched — on an operation that grants roles, activates
            //   memberships and credits wallets. "How many members did this run
            //   fulfil" is the question an audit row about a reconciliation
            //   exists to answer, and it could not be asked of it.
            metadata: {
                total: allTxs.length,
                synced, skipped, errors, unhandled,
                truncated: syncTruncated,
                unhandledReferences: unhandledReferences.slice(0, 50),
            },
        });
        return NextResponse.json({
            success: true,
            //   Named, not just logged: a sync that hit its ceiling has left
            //   payments unprocessed, and the admin who ran it would otherwise
            //   read the remaining gaps as real.
            truncated: syncTruncated,
            total: allTxs.length,
            breakdown: {
                success: successTxs.length,
                failed: failedTxs.length,
                abandoned: abandonedTxs.length,
            },
            synced,
            skipped,
            errors,
            //   Named in the response so the admin who pressed the button sees
            //   them. These are payments a person made that nothing on this
            //   platform knows how to fulfil, which is the one result of this
            //   job that needs a human.
            unhandled,
            unhandledReferences: unhandledReferences.slice(0, 50),
        });
    } catch (error: any) {
        logger.error("[PaystackSync] Fatal error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Internal error" },
            { status: 500 }
        );
    }
}

/**
 * Throttled, which it was not.
 *
 * One call pages through the ENTIRE Paystack transaction history — three status
 * buckets in parallel, 100 per page, no page ceiling — and then runs fulfilment
 * on everything successful. It was exported bare, so any holder of the guard
 * permission could run that as fast as they could issue requests, against a
 * third-party API with its own rate limits and a bill attached.
 */
export const GET = withRateLimit(paystackSyncHandler);
