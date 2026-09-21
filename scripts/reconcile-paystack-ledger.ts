/**
 * The ledger against Paystack. Report by default; `--apply` repairs dates only.
 *
 *   Run:  npx tsx scripts/reconcile-paystack-ledger.ts
 *         npx tsx scripts/reconcile-paystack-ledger.ts --apply
 *
 *   Needs PAYSTACK_SECRET_KEY and the Supabase service credentials the other
 *   maintenance scripts use.
 *
 * ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 *
 *   Three questions, which are the three ways a row and a transaction fail to
 *   line up. The Academy reconciliation found one of each:
 *
 *     money Paystack has that the ledger does not   j559i4zu6j, ₦50,000
 *     rows Paystack has never heard of              TEST_E2E_REF_123456
 *     rows whose dates disagree                     five, all stamped 2026-07-06
 *
 *   The arithmetic is lib/paystack-reconciliation, which has no database and no
 *   network in it and is tested against those exact figures. This file is the
 *   fetching and the printing.
 *
 * ── WHAT --apply WILL AND WILL NOT DO ───────────────────────────────────────
 *
 *   IT REPAIRS DATES, AND ONLY DATES. For a row that matched a transaction, it
 *   writes Paystack's `paid_at` into raw_data.paidAt. Additive, idempotent,
 *   reversible: no amount changes, no row is created, nothing is deleted, and a
 *   row that already agrees is skipped.
 *
 *   IT DOES NOT CREATE THE MISSING ROWS. Writing one means deciding what the
 *   payer bought — which plan, which module, which fulfilment should follow —
 *   and fulfilment is exactly what did not happen. A row with money and no
 *   entitlement behind it is a different wrong answer, not a fix.
 *
 *   IT DOES NOT DELETE THE FABRICATED ONES. Something may have been fulfilled
 *   against that row months ago, and deleting it revokes whatever that was from
 *   whoever has been using it. Both are decisions about a person, made by
 *   someone with the Paystack dashboard open beside the table.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 *
 *   The WHOLE ledger, not Academy's. The isTestRef mock served every verify
 *   path — cooperative, wave, export, marketplace escrow, farm-nation — and
 *   only Academy has been reconciled by hand.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import {
    dateRepairs,
    reconcile,
    type LedgerRow,
    type PaystackTransaction,
} from "@/lib/paystack-reconciliation";

import { isApply, modeBanner, runScript, targetHost } from "./_maintenance-guard";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Paystack's maximum, so the fewest round trips. */
const PER_PAGE = 100;

/**
 * Every transaction Paystack will show us, newest first.
 *
 *   Paged rather than fetched at once because the endpoint caps a page and a
 *   platform with a year of history has more than one. Stops when a page comes
 *   back short, which is Paystack's own end-of-list signal.
 */
async function fetchAllTransactions(secret: string): Promise<PaystackTransaction[]> {
    const all: PaystackTransaction[] = [];

    for (let page = 1; ; page++) {
        const res = await fetch(
            `${PAYSTACK_BASE_URL}/transaction?perPage=${PER_PAGE}&page=${page}`,
            {
                headers: { Authorization: `Bearer ${secret}` },
                signal: AbortSignal.timeout(30_000),
            },
        );

        if (!res.ok) {
            throw new Error(`Paystack returned ${res.status} on page ${page}: ${await res.text()}`);
        }

        const body = await res.json() as { status?: boolean; message?: string; data?: PaystackTransaction[] };
        if (!body.status) throw new Error(`Paystack refused: ${body.message ?? "no message"}`);

        const rows = body.data ?? [];
        all.push(...rows);
        console.log(`   page ${page}: ${rows.length} transactions (${all.length} so far)`);

        if (rows.length < PER_PAGE) return all;
    }
}

async function fetchLedger(): Promise<LedgerRow[]> {
    const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).all().get();
    return snap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
            reference: String(d.reference ?? doc.id),
            amount: Number(d.amount) || 0,
            created_at: (d.created_at ?? d.createdAt ?? null) as string | null,
            raw_data: {
                type: (d.type ?? null) as string | null,
                status: (d.status ?? null) as string | null,
                source: (d.source ?? null) as string | null,
                paidAt: (d.paidAt ?? null) as string | null,
            },
        };
    });
}

async function main() {
    const apply = isApply();
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
        throw new Error("PAYSTACK_SECRET_KEY is not set — there is nothing to reconcile against.");
    }

    //   The shared banner, not a second spelling of it — the name, the mode
    //   and WHICH DATABASE, which is the whole point of #448. `applyDoes` says
    //   what applying actually does here, because "this will write" would
    //   overstate it: the only write is one JSONB key on rows that already
    //   exist.
    console.log(modeBanner(
        "reconcile-paystack-ledger",
        apply,
        targetHost(),
        "this will set raw_data.paidAt on matched rows — no row is created or deleted",
    ));

    console.log("Fetching Paystack transactions…");
    const transactions = await fetchAllTransactions(secret);

    console.log("Reading processed_payments…");
    const ledger = await fetchLedger();

    const result = reconcile(transactions, ledger);

    console.log(
        `\n${result.counts.paystack} settled transactions · ${result.counts.ledger} ledger rows · `
        + `${result.counts.matched} matched\n`,
    );

    // ── 1. Money Paystack has and we do not ─────────────────────────────────
    console.log(`MONEY PAYSTACK HAS THAT THE LEDGER DOES NOT — ${result.missingFromLedger.length}`);
    if (!result.missingFromLedger.length) console.log("   none");
    for (const m of result.missingFromLedger) {
        console.log(`   ${m.reference}  ₦${m.amount}  ${m.settledAt ?? "(undated)"}  ${m.email ?? "(no email)"}`);
    }
    if (result.missingFromLedger.length) {
        console.log(
            "   NOT created automatically: writing one means deciding what was bought, and\n"
            + "   fulfilment is what did not happen. Check each against the payer's records.",
        );
    }

    // ── 2. Rows Paystack has never heard of ─────────────────────────────────
    console.log(`\nROWS PAYSTACK HAS NEVER HEARD OF — ${result.missingFromPaystack.length}`);
    if (!result.missingFromPaystack.length) console.log("   none");
    for (const m of result.missingFromPaystack) {
        console.log(`   ${m.reference}  ₦${m.amount}  ${m.type ?? "(no type)"}`);
    }
    if (result.missingFromPaystack.length) {
        console.log(
            "   NOT deleted automatically: something may have been fulfilled against these\n"
            + "   months ago, and deleting revokes it from whoever has been using it.",
        );
    }

    if (result.adminVerified.length) {
        console.log(
            `\n   (${result.adminVerified.length} admin-verified row(s) excluded above — recorded by hand,`
            + " so Paystack has nothing and never will.)",
        );
    }

    // ── 3. Dates that disagree — the one thing --apply repairs ──────────────
    const repairs = dateRepairs(result);
    console.log(`\nROWS WHOSE DATES DISAGREE — ${repairs.length}`);
    for (const d of result.dateDisagreements) {
        console.log(`   ${d.reference}  ledger ${d.ledgerDate.slice(0, 10)}  paystack ${d.paystackDate.slice(0, 10)}  (${d.driftDays}d)`);
    }

    if (!repairs.length) {
        console.log("   none");
        return result;
    }

    if (!apply) {
        console.log("\n   report only — nothing written. Re-run with --apply to set raw_data.paidAt.");
        return result;
    }

    console.log("\n   writing settlement dates…");
    let written = 0;
    for (const r of repairs) {
        try {
            await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(r.reference).update({ paidAt: r.paidAt });
            written++;
        } catch (err) {
            //   One row failing must not abandon the rest: each is independent
            //   and a partial repair is still a repair.
            console.error(`   ${r.reference}: FAILED — ${(err as Error).message}`);
        }
    }
    console.log(`   ${written}/${repairs.length} settlement dates written.`);

    return result;
}

runScript("reconcile-paystack-ledger", main);
