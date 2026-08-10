export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Fulfilment reconciliation — did the thing the payment paid for happen?
 *
 * WHY THIS EXISTS
 * ---------------
 * `reconcile-paystack` asks "was the payment RECORDED?" — it compares Paystack's
 * list of successful transactions against `processed_payments` by reference.
 * Every check in this codebase asked that question, and none asked the next one.
 *
 * That gap is not theoretical. Eight cooperative registrations paid between
 * 2026-07-21 and 2026-08-08 were never fulfilled and had to be repaired by hand.
 * Every one of them HAD its `processed_payments` row — the payment was recorded
 * correctly; the membership row was silently discarded by a `set(merge)` on a
 * document that did not exist yet. Run over that window, `reconcile-paystack`
 * reported `discrepancies: 0`.
 *
 * A payment that is recorded but not fulfilled is invisible to a
 * reference-level comparison. This route asks the other question: for each
 * completed payment, does the artefact it should have produced exist?
 *
 * IT REPORTS, IT DOES NOT HEAL
 * ----------------------------
 * Deliberate. Healing is per-type, and reconstructing a membership is not the
 * same operation as reconstructing an order or an investment slot — the repair
 * of those eight needed decisions about `membershipStatus` that no generic
 * rule would have got right. An alert a human acts on is the correct output
 * here; a generic auto-heal on money artefacts is how you turn one bad row into
 * a thousand.
 *
 * COVERAGE IS PARTIAL, AND SAYS SO
 * --------------------------------
 * Only the types below are checked. The response lists what it did NOT check,
 * because a reconciler that silently ignores a payment type is worse than no
 * reconciler — it reads as an all-clear.
 *
 * Authorization: Bearer CRON_SECRET, as with the other cron routes.
 */

/** How far back to look when no `days` parameter is given. */
const DEFAULT_WINDOW_DAYS = 30;

/** Cap on references listed per type, so one bad day cannot produce a huge body. */
const MAX_LISTED = 50;

interface Check {
    /** The `type` recorded on the processed_payments row. */
    paymentType: string;
    /** Human description of the artefact that proves fulfilment. */
    artefact: string;
    /**
     * Returns the set of payment identifiers that ARE fulfilled.
     *
     * Each check fetches its artefact collection once and builds a Set, rather
     * than querying per payment — a 30-day window is a few hundred payments and
     * a per-payment query would be a few hundred round trips.
     */
    fulfilledKeys: () => Promise<{ keys: Set<string>; truncated: boolean }>;
    /** How to derive this payment's key for lookup in that Set. */
    keyFor: (payment: { reference: string; userId: string }) => string;
}

const CHECKS: Check[] = [
    {
        // Added after a manual sweep found one such payment that the original
        // four checks did not cover. Academy fulfilment lives on the USERS
        // document rather than in a collection of its own, so this check reads
        // users and asks whether the academy registration was recorded.
        paymentType: "academy_registration",
        artefact: "serviceRegistrations.academy.paymentStatus = completed on the payer",
        keyFor: (p) => p.userId,
        fulfilledKeys: async () => {
            // .all(), not .get(): a plain .get() stops at DEFAULT_QUERY_LIMIT
            // (5,000) and returns a short result that looks complete. USERS is
            // ~41,000 rows, so this check was building its fulfilled-set from an
            // eighth of the table and reporting every academy payment outside
            // that slice as unfulfilled. .select() narrows the payload to the
            // two fields actually read.
            const snap = await db.collection(COLLECTIONS.USERS)
                .select("serviceRegistrations", "roles")
                .all()
                .get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                const academy = data?.serviceRegistrations?.academy;
                const roles = Array.isArray(data?.roles) ? data.roles : [];
                if (academy?.paymentStatus === "completed" || roles.includes("academy_participant")) {
                    keys.add(d.id);
                }
            });
            return { keys, truncated: snap.truncated };
        },
    },
    {
        paymentType: "cooperative_membership_registration",
        artefact: "a cooperative_members row for the payer",
        keyFor: (p) => p.userId,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).all().get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                keys.add(d.id);
                const uid = d.data()?.userId;
                if (uid) keys.add(uid);
            });
            return { keys, truncated: snap.truncated };
        },
    },
    {
        paymentType: "marketplace_order",
        artefact: "a marketplaceOrders row past pending_payment",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .select("paymentReference", "paymentStatus")
                .all()
                .get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                const ref = data.paymentReference;
                // An order still at pending_payment has NOT been fulfilled, even
                // though the row exists — presence alone would be a false pass.
                if (ref && data.paymentStatus && data.paymentStatus !== "pending") {
                    keys.add(ref);
                }
            });
            return { keys, truncated: snap.truncated };
        },
    },
    {
        paymentType: "export_investment",
        artefact: "an export_slots row carrying the payment reference",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.EXPORT_SLOTS)
                .select("paymentReference")
                .all()
                .get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const ref = d.data()?.paymentReference;
                if (ref) keys.add(ref);
            });
            return { keys, truncated: snap.truncated };
        },
    },
    {
        paymentType: "farm_nation_escrow",
        artefact: "a farm_nation_transactions row at payment_confirmed or beyond",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .select("paymentReference", "status")
                .all()
                .get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                const ref = data.paymentReference;
                if (ref && data.status && data.status !== "pending_payment") {
                    keys.add(ref);
                }
            });
            return { keys, truncated: snap.truncated };
        },
    },
];

const CHECKED_TYPES = new Set(CHECKS.map((c) => c.paymentType));

export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: "Unauthorized. Provide Authorization: Bearer <CRON_SECRET>" },
            { status: 401 }
        );
    }

    const startedAt = new Date();

    try {
        const daysParam = Number(request.nextUrl.searchParams.get("days"));
        const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : DEFAULT_WINDOW_DAYS;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Completed payments in the window. `status` lives in raw_data, so this
        // filters in JavaScript rather than SQL — the volume is a few hundred.
        // .all(), not .get(). This reads every payment and filters by date in
        // JavaScript, so a plain .get() truncated at 5,000 rows BEFORE the window
        // filter ran — and the rows dropped were arbitrary, not the oldest.
        //
        // The date filter is deliberately NOT pushed into the query. The JS
        // filter below keeps rows with no processedAt ("undated: check it rather
        // than skip it"), and a SQL `processedAt >= cutoff` would drop exactly
        // those — the ones most likely to be malformed and worth looking at.
        // `processedAt` is also written as a server timestamp on some paths and
        // an ISO string on others, so a string comparison would not be sound
        // across both.
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).all().get();

        const allInWindow = paymentsSnap.docs
            .map((d: any) => {
                const data = d.data() ?? {};
                return {
                    reference: data.reference || d.id,
                    userId: data.userId || "",
                    type: data.type || "",
                    status: data.status || "",
                    processedAt: data.processedAt || null,
                };
            })
            .filter((p: any) => {
                if (!p.processedAt) return true; // undated: check it rather than skip it
                const t = new Date(p.processedAt);
                return isNaN(t.getTime()) ? true : t >= cutoff;
            });

        const payments = allInWindow.filter((p: any) => p.status === "completed");

        // Payments claimed but never promoted to a final status.
        //
        // processExportInvestment claims as "pending_fulfilment" and promotes to
        // "completed" or "overfunded_review" once the overfunding branch
        // resolves — a two-step write, because the status cannot be known before
        // the branch runs. A crash between the two leaves the row stranded here.
        //
        // The artefact checks below only look at "completed" rows, so a stranded
        // row would be invisible to every one of them. It is reported separately
        // instead: a payment that was claimed and never fulfilled is the
        // strongest signal this job can produce — it needs no artefact lookup to
        // know something is wrong.
        const stranded = allInWindow.filter((p: any) => p.status === "pending_fulfilment");

        const results: Record<string, any> = {};
        let totalUnfulfilled = 0;

        // Which scans came back INCOMPLETE.
        //
        // Every scan below uses .all(), which raises the ceiling to 500,000 and
        // logs an error rather than truncating quietly. That error goes to logs,
        // and the defect this route exists to catch was itself hidden by a
        // warning in logs nobody read. So it is reported in the response too: a
        // reconciler running against a partial view must not be able to say
        // "ok". An incomplete artefact scan makes every "unfulfilled" result for
        // that type a possible false positive.
        const incompleteScans: string[] = [];

        for (const check of CHECKS) {
            const forType = payments.filter((p: any) => p.type === check.paymentType);
            if (forType.length === 0) {
                results[check.paymentType] = { checked: 0, unfulfilled: 0, references: [] };
                continue;
            }

            const { keys: fulfilled, truncated } = await check.fulfilledKeys();
            if (truncated) incompleteScans.push(check.paymentType);
            const missing = forType.filter((p: any) => !fulfilled.has(check.keyFor(p)));

            totalUnfulfilled += missing.length;
            results[check.paymentType] = {
                checked: forType.length,
                unfulfilled: missing.length,
                artefact: check.artefact,
                references: missing.slice(0, MAX_LISTED).map((p: any) => ({
                    reference: p.reference,
                    userId: p.userId,
                })),
                ...(missing.length > MAX_LISTED
                    ? { truncated: missing.length - MAX_LISTED }
                    : {}),
            };
        }

        // Everything this route does NOT check, named explicitly. A reconciler
        // that silently ignores a payment type reads as an all-clear.
        const uncheckedTypes: Record<string, number> = {};
        payments.forEach((p: any) => {
            if (!CHECKED_TYPES.has(p.type)) {
                uncheckedTypes[p.type || "(no type)"] = (uncheckedTypes[p.type || "(no type)"] || 0) + 1;
            }
        });

        // Orders charged for stock that turned out not to be there.
        //
        // Both stock-reservation paths mark an order paymentStatus
        // "paid_awaiting_refund" / status "cancelled_out_of_stock" when the
        // reservation fails after the payment is already claimed. The comment
        // beside each says the same thing: "this still needs an operational
        // follow-up — nothing yet PROCESSES those refunds."
        //
        // Nothing surfaced them either, which is the half that made them easy to
        // forget: the money is owed, the order carries the reason and the
        // amount, and no job ever mentioned it again. This does not issue the
        // refund — moving money back out belongs behind a human, the same
        // reasoning that keeps this whole route alerting rather than auto-
        // healing. It makes the debt impossible to miss.
        const refundsOwed: Array<Record<string, any>> = [];

        for (const col of [COLLECTIONS.MARKETPLACE_ORDERS, COLLECTIONS.EXPORT_ORDERS]) {
            // .all(): this scan was added with a plain .get() and carried the
            // same truncation as the checks above — a refund owed on an order
            // past the 5,000th row would never have been reported.
            const snap = await db.collection(col)
                .where("paymentStatus", "==", "paid_awaiting_refund")
                .all()
                .get();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                if (data.paymentStatus !== "paid_awaiting_refund") return;
                refundsOwed.push({
                    collection: col,
                    orderId: data.orderId || d.id,
                    userId: data.buyerId || data.userId || "",
                    amount: data.refundAmount ?? data.paidAmount ?? null,
                    reason: data.refundReason || data.status || "",
                });
            });
        }

        const refundTotal = refundsOwed.reduce(
            (sum, r) => sum + (Number(r.amount) || 0), 0
        );

        // Both of these count toward the alarm as much as a missing artefact
        // does. Reporting either without counting it would let a run with
        // stranded payments, or with money owed to buyers, report "ok".
        totalUnfulfilled += stranded.length + refundsOwed.length;

        const body = {
            // An incomplete scan cannot report "ok". Every "unfulfilled" result
            // for a truncated type is a possible false positive, and every
            // fulfilled one a possible false negative — the answer is unknown,
            // not clean.
            status: incompleteScans.length > 0
                ? "incomplete_scan"
                : totalUnfulfilled > 0 ? "unfulfilled_payments_found" : "ok",
            incompleteScans,
            windowDays: days,
            paymentsInWindow: payments.length,
            totalUnfulfilled,
            byType: results,
            strandedClaims: {
                count: stranded.length,
                meaning: "claimed as pending_fulfilment and never promoted — fulfilment died part-way",
                references: stranded.slice(0, MAX_LISTED).map((p: any) => ({
                    reference: p.reference,
                    userId: p.userId,
                    type: p.type,
                })),
                ...(stranded.length > MAX_LISTED
                    ? { truncated: stranded.length - MAX_LISTED }
                    : {}),
            },
            refundsOwed: {
                count: refundsOwed.length,
                totalAmount: refundTotal,
                meaning: "buyer was charged, stock was not there — refund owed and NOT yet issued",
                orders: refundsOwed.slice(0, MAX_LISTED),
                ...(refundsOwed.length > MAX_LISTED
                    ? { truncated: refundsOwed.length - MAX_LISTED }
                    : {}),
            },
            notChecked: uncheckedTypes,
            runAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
        };

        if (totalUnfulfilled > 0) {
            // Loud on purpose: this is somebody having paid for something they
            // did not get.
            logger.error("[reconcile-fulfilment] payments recorded but not fulfilled", {
                totalUnfulfilled,
                byType: Object.fromEntries(
                    Object.entries(results).map(([k, v]: any) => [k, v.unfulfilled])
                ),
            });
        } else {
            logger.info("[reconcile-fulfilment] all checked payments fulfilled", {
                paymentsInWindow: payments.length,
            });
        }

        return NextResponse.json(body);
    } catch (error: any) {
        logger.error("[reconcile-fulfilment] failed", { error: error?.message });
        return NextResponse.json(
            { status: "error", error: error?.message || "Reconciliation failed" },
            { status: 500 }
        );
    }
}
