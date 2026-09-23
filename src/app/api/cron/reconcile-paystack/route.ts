export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { resolveActiveUserId } from "@/lib/user-identity";
import { Timestamp } from "@/lib/firestore-compat";
import { paystackBaseUrl } from "@/lib/paystack-host";
import { eachPaystackSuccess } from "@/lib/paystack-sweep";
import { logger } from "@/lib/logger";
import { refuseUnauthorisedCron } from "@/lib/cron-auth";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";

/**
 * Automated Paystack ↔ Firebase Reconciliation
 *
 * Cron job endpoint — triggered daily by Railway Cron at 06:00 WAT.
 * Also callable manually from the admin dashboard.
 *
 * What it checks:
 *   1. Fetches all successful Paystack transactions (last 30 days)
 *   2. Compares against processedPayments collection in Firestore
 *   3. Identifies transactions missing from Firebase (payment collected, record absent)
 *   4. Writes results to system_health/paystack_reconciliation in Firestore
 *   5. Returns summary JSON for Railway cron logs
 *
 * Authorization: Bearer CRON_SECRET header required in production.
 */
export async function GET(request: NextRequest) {
    // ── Auth gate ────────────────────────────────────────────────────────────────
    //   #659 — one gate, shared. See lib/cron-auth.
    const refusal = refuseUnauthorisedCron(request, "reconcile-paystack");
    if (refusal) return refusal;

    const startedAt = new Date();
    const results: {
        status: "ok" | "warning" | "critical";
        paystackTotal: number;
        firebaseTotal: number;
        missingInFirebase: Array<{
            reference: string;
            amount: number;
            email: string | undefined;
            date: string;
            channel: string;
        }>;
        discrepancies: number;
        runAt: string;
        durationMs: number;
        error?: string;
    } = {
        status: "ok",
        paystackTotal: 0,
        firebaseTotal: 0,
        missingInFirebase: [],
        discrepancies: 0,
        runAt: startedAt.toISOString(),
        durationMs: 0,
    };

    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            throw new Error("PAYSTACK_SECRET_KEY is not set in environment");
        }

        // ── 1. Fetch Paystack successful transactions (last 30 days) ────────────
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromDate = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

        const allPaystackTransactions: Array<{
            reference: string;
            amount: number;
            paid_at: string;
            channel: string;
            customer?: { email?: string };
        }> = [];
        //   #519 THE SIXTH COPY, AND THE ONE NOBODY IS WATCHING.
        //
        //   `if (page < (data.meta?.pageCount || 1))` is the same defect as the
        //   `?? 1` form in the other five — when Paystack omits the field the
        //   loop reads one page and stops — and it is spelled differently, which
        //   is why a ratchet searching for the literal string `pageCount ?? 1`
        //   could never have found it. This one runs on a schedule, so its
        //   under-reading is not attached to anyone pressing a button.
        const sweep = await eachPaystackSuccess(
            secretKey,
            { label: "CronReconcile", dateFrom: new Date(fromDate), timeoutMs: 15000 },
            (tx) => { allPaystackTransactions.push(tx as typeof allPaystackTransactions[number]); },
        );
        if (sweep.truncated) {
            logger.error(
                "[CronReconcile] the Paystack sweep hit its page ceiling — transactions beyond it "
                + "were never compared, so this run's clean result means nothing.",
            );
        }

        results.paystackTotal = allPaystackTransactions.length;

        /*
         * ── 2. Fetch Firebase processedPayments references ───────────────────
         *
         *   .all(), NOT .get(), AND THE SIBLING JOB ALREADY LEARNED THIS.
         *
         *   reconcile-fulfilment's own comment records it verbatim: "a plain
         *   .get() stops at DEFAULT_QUERY_LIMIT (5,000) and returns a short
         *   result that looks complete". That fix was never ported here, and
         *   this set is the more dangerous of the two to truncate.
         *
         *   THIS SET IS WHAT STOPS A PAYMENT BEING HEALED TWICE. Every
         *   reference it does not contain is treated as missing from the
         *   platform and sent to dispatchPaystackPayment — which has no
         *   idempotency guard of its own; the processors validate the AMOUNT,
         *   not whether the reference was already fulfilled. So a truncated
         *   read does not merely under-report: it re-fulfils every completed
         *   payment past the cap, every six hours, for as long as the ledger
         *   stays above 5,000 rows.
         *
         *   It also explains the cost. Each of those false positives costs a
         *   sequential Paystack verify, which is what makes this job long
         *   enough to hold the container while users wait behind it.
         *
         *   .all() carries the adapter's UNBOUNDED_CEILING and reports reaching
         *   it as an error rather than a short answer, so the failure mode
         *   becomes loud instead of silent. .select() narrows the payload to
         *   the three fields the mapper below actually reads, rather than
         *   detoasting every raw_data in the ledger to collect one string.
         */
        const paymentsSnapshot = await db
            .collection("processedPayments")
            .where("status", "==", "completed")
            .select("reference", "paystackReference", "ref")
            .all()
            .get();

        const firebaseRefs = new Set<string>();
        paymentsSnapshot.docs.forEach(doc => {
            const ref = doc.data().reference || doc.data().paystackReference || doc.data().ref;
            if (ref) firebaseRefs.add(ref);
        });

        results.firebaseTotal = firebaseRefs.size;

        // ── 3. Find and Auto-Heal transactions in Paystack but not in Firebase ──────────────────
        //
        //   #531 One dispatcher, shared with the webhook and the admin sync.
        //   This chain routed six of the nine processors service.ts exports —
        //   it could not fulfil a farm-nation or WAVE registration — and it
        //   counted what it could not route as healed. See payment-router.
        const { dispatchPaystackPayment } = await import("@/infrastructure/payments/payment-router");

        /*
         *   THE VERIFY CALLS RUN TOGETHER; THE HEALING STILL RUNS ONE AT A TIME.
         *
         *   This loop used to `await fetch` Paystack once per missing
         *   reference, in series, inside the request handler that serves users.
         *   Each call is allowed ten seconds, so N missing references is N
         *   sequential round trips — and while they run, inbound requests queue
         *   behind them on the same container. That is the burst of
         *   `Error: aborted / ECONNRESET` in the production log: clients giving
         *   up, their disconnect events draining together the moment this job
         *   finally returns.
         *
         *   ONLY THE READ-ONLY HALF IS PARALLELISED, and that is the whole
         *   care in this change. Verifying a transaction is a pure GET and
         *   reorderable; dispatchPaystackPayment WRITES — it credits wallets,
         *   grants roles and records payments. Two heals for the same person
         *   running at once is a race this job has never had, and a
         *   reconciliation job is the last place to introduce one. So the
         *   verifies are fetched with bounded concurrency, then the healing
         *   walks the results in the original order, serially, exactly as
         *   before.
         *
         *   SIX AT A TIME, deliberately modest: the point is to stop holding
         *   the container for N x 10s, not to hammer Paystack, whose rate limit
         *   is theirs to enforce and not ours to discover in production.
         */
        const VERIFY_CONCURRENCY = 6;

        const missing = allPaystackTransactions.filter((tx) => !firebaseRefs.has(tx.reference));

        const verified = await mapWithConcurrency(missing, VERIFY_CONCURRENCY, async (tx) => {
            try {
                const txDetailRes = await fetch(
                    `${paystackBaseUrl()}/transaction/verify/${tx.reference}`,
                    {
                        headers: { Authorization: `Bearer ${secretKey}` },
                        signal: AbortSignal.timeout(10000),
                    }
                );
                if (!txDetailRes.ok) return { tx, detail: null as any, error: null as unknown };
                return { tx, detail: await txDetailRes.json(), error: null as unknown };
            } catch (fetchErr) {
                //   Returned rather than thrown: one unreachable verify must
                //   not abandon the other N-1, which a rejection inside
                //   mapWithConcurrency would do.
                return { tx, detail: null as any, error: fetchErr };
            }
        });

        for (const { tx, detail: prefetched, error: fetchError } of verified) {
            //   Every entry in `verified` is already a missing reference — the
            //   filter above did the work the old `if (!firebaseRefs.has(...))`
            //   did here, once, instead of per iteration.
            {
                try {
                    if (fetchError) throw fetchError;
                    if (prefetched) {
                        const detail = prefetched;
                        if (detail.status && detail.data?.status === "success") {
                            const data = detail.data;
                            const amountPaidv = data.amount / 100;
                            const metadata = data.metadata || {};
                            const rawUserId = metadata.userId;
                            let userId = rawUserId;

                            // Resolve legacy Firebase UID to active Supabase ID if migrated
                            if (rawUserId) {
                                // #449. One hop became the whole chain, so this and the
                                // session agree on who was paid.
                                userId = (await resolveActiveUserId(rawUserId, db.collection("users"))).id;
                            }

                            const type = metadata.type || metadata.purpose || null;
                            const paidAtDate = data.paid_at ? new Date(data.paid_at) : undefined;

                            console.log(`[Reconciliation Cron] Auto-healing missing payment ${tx.reference} of type "${type}" for user: ${userId}`);

                            const healed = await dispatchPaystackPayment(type, {
                                reference: tx.reference,
                                amount: amountPaidv,
                                userId,
                                metadata,
                                paidAt: paidAtDate,
                            });

                            //   #531 THE THREE LINES BELOW USED TO RUN
                            //   UNCONDITIONALLY, under the comment "Successfully
                            //   processed", after a chain with no else.
                            //
                            //   A payment whose type matched nothing was counted
                            //   as healed AND the `continue` skipped the
                            //   missingInFirebase.push at the foot of the loop —
                            //   so the one job that exists to surface payments
                            //   the platform missed was removing them from its
                            //   own discrepancy list. A payment with no
                            //   application metadata (a Paystack payment link,
                            //   which is the shape of the twelve ghost ₦10,000
                            //   payments) has `type` null and takes exactly this
                            //   path every run.
                            //
                            //   Now only a payment a processor actually fulfilled
                            //   is marked healed. Anything else falls through to
                            //   the discrepancy list, where a human sees it.
                            if (healed) {
                                results.firebaseTotal++;
                                firebaseRefs.add(tx.reference);
                                continue;
                            }

                            console.error(
                                `[Reconciliation Cron] ${tx.reference} could not be routed — type "${type}". `
                                + `Reported as a discrepancy rather than counted as healed.`,
                            );
                        }
                    }
                } catch (healErr) {
                    console.error(`[Reconciliation Cron] Failed to auto-heal transaction ${tx.reference}:`, healErr);
                }

                // If verification/processing fails, log as discrepancy in system health dashboard
                results.missingInFirebase.push({
                    reference: tx.reference,
                    amount: tx.amount / 100,
                    email: tx.customer?.email,
                    date: tx.paid_at,
                    channel: tx.channel,
                });
            }
        }

        results.discrepancies = results.missingInFirebase.length;
        results.status =
            results.discrepancies === 0 ? "ok" :
            results.discrepancies <= 3  ? "warning" : "critical";

    } catch (err: unknown) {
        results.status = "critical";
        results.error = err instanceof Error ? err.message : String(err);
    }

    // ── 4. Write results to Firestore system_health collection ──────────────────
    results.durationMs = Date.now() - startedAt.getTime();

    try {
        await db
            .collection("system_health")
            .doc("paystack_reconciliation")
            .collection("runs")
            .add({
                ...results,
                // Store only the first 20 discrepancies to avoid huge docs
                missingInFirebase: results.missingInFirebase.slice(0, 20),
                runAt: Timestamp.fromDate(startedAt),
            });

        // Update the "latest" snapshot for quick dashboard reads
        await db
            .collection("system_health")
            .doc("paystack_reconciliation")
            .set({
                status:        results.status,
                discrepancies: results.discrepancies,
                paystackTotal: results.paystackTotal,
                firebaseTotal: results.firebaseTotal,
                lastRunAt:     Timestamp.fromDate(startedAt),
                durationMs:    results.durationMs,
                ...(results.error ? { lastError: results.error } : {}),
            }, { merge: true });

    } catch (writeErr) {
        // Non-fatal — the reconciliation result is still returned in the response
        console.error("Failed to write reconciliation results to Firestore:", writeErr);
    }

    // Invalidate Redis caches to ensure Total Revenue and other dashboard stats update immediately if we healed any records
    if (results.firebaseTotal > 0) {
        try {
            const { deleteCache, deleteCachePattern } = await import("@/lib/redis");
            await deleteCache("admin:finance-overview:global");
            await deleteCache("admin:dashboard-stats:global");
            await deleteCachePattern("admin:dashboard-stats:*");
            await deleteCache("admin:coop-reports:global");
            await deleteCachePattern("admin:coop-reports:*");
            console.log("[Reconciliation Cron] Invalidated finance, dashboard, and coop report Redis caches.");
        } catch (cacheErr: any) {
            console.error("[Reconciliation Cron] Cache invalidation error:", cacheErr);
        }
    }

    // ── 5. Return summary ────────────────────────────────────────────────────────
    /**
     *   #677 THE WORST THING THIS JOB CAN FIND WAS REPORTED AS SUCCESS.
     *
     *        The mapping was:
     *
     *            ok      → 200
     *            warning → 200
     *            error   → 500
     *            EVERYTHING ELSE → 200
     *
     *        and `critical` is everything else. `critical` means MORE THAN
     *        THREE PAYMENTS EXIST IN PAYSTACK THAT ARE MISSING FROM THIS
     *        DATABASE — money the platform took and has no record of. The 500
     *        fired only when an exception had been thrown, so a run that
     *        completed perfectly and found fifty missing payments answered 200.
     *
     *        AND NOTHING ELSE WAS WATCHING. The result is written to
     *        `system_health/paystack_reconciliation`, and that collection is
     *        read by NO screen, NO action and NO other route in this
     *        repository — swept today. So the finding went into a document
     *        nobody opens, and the one process that does look at this job, the
     *        scheduled workflow, was told the run succeeded.
     *
     *        That is two of this audit's recurring shapes stacked on the
     *        payment-reconciliation path: a check that cannot fail, and a
     *        record nothing consults. Every six hours, for ever.
     *
     *   WHY 409 AND NOT 500. #631 established that this workflow must say which
     *   KIND of failure it met, because "the route is missing" and "nothing is
     *   deployed" need different people to do different things. A reconciliation
     *   that RAN CORRECTLY and found a discrepancy is a third kind: the job is
     *   healthy and the data is not. 500 would say the endpoint broke, which is
     *   the one thing that did not happen.
     *
     *   WARNING STAYS AT 200 ON PURPOSE. One to three unmatched references is
     *   the ordinary noise of a payment window straddling a run boundary, and
     *   this file's own workflow already records the principle: a failure every
     *   few hours is a failure nobody reads. The alarm is kept for the case
     *   that warrants one.
     */
    const httpStatus =
        results.error                 ? 500 :
        results.status === "critical" ? 409 :
        200;

    return NextResponse.json(results, { status: httpStatus });
}
