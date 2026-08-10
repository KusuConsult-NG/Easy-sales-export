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
    fulfilledKeys: () => Promise<Set<string>>;
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
            const snap = await db.collection(COLLECTIONS.USERS).get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                const academy = data?.serviceRegistrations?.academy;
                const roles = Array.isArray(data?.roles) ? data.roles : [];
                if (academy?.paymentStatus === "completed" || roles.includes("academy_participant")) {
                    keys.add(d.id);
                }
            });
            return keys;
        },
    },
    {
        paymentType: "cooperative_membership_registration",
        artefact: "a cooperative_members row for the payer",
        keyFor: (p) => p.userId,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                keys.add(d.id);
                const uid = d.data()?.userId;
                if (uid) keys.add(uid);
            });
            return keys;
        },
    },
    {
        paymentType: "marketplace_order",
        artefact: "a marketplaceOrders row past pending_payment",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).get();
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
            return keys;
        },
    },
    {
        paymentType: "export_investment",
        artefact: "an export_slots row carrying the payment reference",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.EXPORT_SLOTS).get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const ref = d.data()?.paymentReference;
                if (ref) keys.add(ref);
            });
            return keys;
        },
    },
    {
        paymentType: "farm_nation_escrow",
        artefact: "a farm_nation_transactions row at payment_confirmed or beyond",
        keyFor: (p) => p.reference,
        fulfilledKeys: async () => {
            const snap = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).get();
            const keys = new Set<string>();
            snap.docs.forEach((d: any) => {
                const data = d.data() ?? {};
                const ref = data.paymentReference;
                if (ref && data.status && data.status !== "pending_payment") {
                    keys.add(ref);
                }
            });
            return keys;
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
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).get();

        const payments = paymentsSnap.docs
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
                if (p.status !== "completed") return false;
                if (!p.processedAt) return true; // undated: check it rather than skip it
                const t = new Date(p.processedAt);
                return isNaN(t.getTime()) ? true : t >= cutoff;
            });

        const results: Record<string, any> = {};
        let totalUnfulfilled = 0;

        for (const check of CHECKS) {
            const forType = payments.filter((p: any) => p.type === check.paymentType);
            if (forType.length === 0) {
                results[check.paymentType] = { checked: 0, unfulfilled: 0, references: [] };
                continue;
            }

            const fulfilled = await check.fulfilledKeys();
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

        const body = {
            status: totalUnfulfilled > 0 ? "unfulfilled_payments_found" : "ok",
            windowDays: days,
            paymentsInWindow: payments.length,
            totalUnfulfilled,
            byType: results,
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
