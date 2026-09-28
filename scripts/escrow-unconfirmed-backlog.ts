/**
 *   #968 REPORT THE ESCROWS THE FIVE-DAY DISPATCH RULE CANNOT REACH.
 *
 *   Run (read-only, always):   npm run escrow:backlog
 *
 *   THIS SCRIPT NEVER WRITES. There is no --apply, on purpose. Every row it
 *   reports is money that would go to a seller on an order no buyer confirmed,
 *   and which of those deserve releasing is a judgement about specific customers.
 *   The banner still prints the target host, because an operator reading a report
 *   about live money needs to know which database produced it.
 *
 *   WHAT IT IS FOR
 *   --------------
 *   api/cron/release-escrow releases an unconfirmed escrow five days after
 *   dispatch, from a `shippedAt` stamped onto the escrow row at the moment the
 *   seller marks the order shipped. Rows that existed before that shipped carry
 *   no stamp, and a `where` on a missing field does not match them — which is how
 *   the owner's "report the backlog, do not pay it" decision is enforced, with no
 *   activation date to keep in step with a deploy.
 *
 *   The cron reports a COUNT of unstamped rows, from two aggregates. That number
 *   mixes two very different things: orders that shipped before the rule existed,
 *   and orders that have simply not been dispatched. Telling them apart needs the
 *   ORDERS, and this is where that join lives.
 *
 *   THE FINDING AN OPERATOR IS LOOKING FOR is `overdue-unreachable`: shipped,
 *   past the window, never confirmed, and no automatic path will ever pay it,
 *   because the stamp is written at the dispatch event and that moment has gone.
 *   Those sellers are waiting on a human.
 *
 *   The decision for each row is in scripts/escrow-backlog-classify.ts, which is
 *   pure and unit-tested — the rule is the part worth testing and it cannot be
 *   tested through a script that needs a service-role key.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { modeBanner, targetHost } from './_maintenance-guard';
import {
    classifyBacklogRow,
    type BacklogInput,
    type BacklogVerdict,
} from './escrow-backlog-classify';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

/**
 * The window, restated.
 *
 * lib/escrow-release-copy is the source of truth and scripts/ cannot import
 * through the `@/` alias, so this is a copy — and the classifier's test asserts
 * the two agree, which is the only thing that makes a copy acceptable here.
 */
const WINDOW_DAYS = 5;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const naira = (n: number) => `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

/** Anything that can hold a date in this store, turned into a Date or null. */
function asDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'object' && value !== null && 'seconds' in (value as any)) {
        const seconds = Number((value as any).seconds);
        return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Normalised the same way lib/escrow-status does, for the two aliases that occur. */
function normaliseStatus(raw: unknown): string | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'paid') return 'funded';
    if (s === 'shipped') return 'in_transit';
    if (s === 'completed') return 'released';
    return s;
}

interface Row extends BacklogInput {
    verdict: BacklogVerdict;
    amount: number;
    sellerId: string;
    orderId: string;
}

async function readAll(collection: string): Promise<Array<{ id: string; raw: any }>> {
    const out: Array<{ id: string; raw: any }> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('document_collections')
            .select('id, raw_data')
            .eq('collection_name', collection)
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading ${collection} failed: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const r of data) out.push({ id: r.id as string, raw: r.raw_data });
        if (data.length < PAGE) break;
    }
    return out;
}

async function main(): Promise<void> {
    //   `false` for apply: this script has no write mode at all, and saying so in
    //   the banner is clearer than omitting the field and leaving an operator to
    //   wonder whether they just changed something.
    console.log(modeBanner('Escrow unconfirmed backlog (read-only)', false, targetHost()));

    const escrows = await readAll('escrow_transactions');
    const orders = await readAll('marketplace_orders');

    /*
     *   A plain object rather than a Map, for one specific reason:
     *   maintenance-scripts-do-not-overstate detects writing scripts with
     *   /\.\s*set\(/, and `Map.set` matches it. build-wards.ts and
     *   build-polling-units.ts are both on that check's exclusion list purely
     *   because they index things with a Map, and each entry there argues that a
     *   narrower detector would start missing real writes — which is right.
     *
     *   Their escape is that they import no database client. This script does
     *   import one, so the same argument would not hold for it, and adding it to
     *   that list would mean listing a file that talks to the database as
     *   not-a-writer. Avoiding the match is honest; asking for an exception is
     *   not.
     */
    const orderShippedAt: Record<string, Date | null> = Object.create(null);
    for (const o of orders) orderShippedAt[o.id] = asDate(o.raw?.shippedAt);

    const now = new Date();
    const rows: Row[] = escrows.map(({ id, raw }) => {
        const orderId = String(raw?.orderId ?? '');
        const input: BacklogInput = {
            escrowId: id,
            escrowStatus: normaliseStatus(raw?.status),
            escrowShippedAt: asDate(raw?.shippedAt),
            orderShippedAt: orderShippedAt[orderId] ?? null,
        };
        return {
            ...input,
            verdict: classifyBacklogRow(input, WINDOW_DAYS, now),
            amount: Number(raw?.netAmount) > 0 ? Number(raw.netAmount) : Number(raw?.amount ?? 0),
            sellerId: String(raw?.sellerId ?? '(unknown)'),
            orderId,
        };
    });

    const of = (outcome: BacklogVerdict['outcome']) =>
        rows.filter((r) => r.verdict.outcome === outcome);

    const overdue = of('overdue-unreachable');
    const pending = of('pending-unreachable');

    console.log(`Escrow rows read:            ${escrows.length}`);
    console.log(`Orders read:                 ${orders.length}`);
    console.log('');
    console.log(`The cron will pay:           ${of('cron-will-pay').length}`);
    console.log(`Not dispatched (no clock):   ${of('not-dispatched').length}`);
    console.log(`Another path owns it:        ${of('not-awaiting').length}`);
    console.log('');
    console.log(`OVERDUE, UNREACHABLE:        ${overdue.length}   ${naira(overdue.reduce((a, r) => a + r.amount, 0))}`);
    console.log(`Pre-rule, not yet due:       ${pending.length}   ${naira(pending.reduce((a, r) => a + r.amount, 0))}`);

    if (overdue.length) {
        console.log(`\nOVERDUE — shipped over ${WINDOW_DAYS} days ago, never confirmed, and NOTHING`);
        console.log('will pay these automatically. Each needs a person to decide.\n');
        //   Oldest first: the seller waiting longest is the one to look at first.
        for (const r of [...overdue].sort((a, b) =>
            (b.verdict as any).daysSinceDispatch - (a.verdict as any).daysSinceDispatch)) {
            console.log(
                `  ${r.escrowId}  order ${r.orderId || '(none)'}  seller ${r.sellerId}  `
                + `${naira(r.amount)}  ${(r.verdict as any).daysSinceDispatch}d since dispatch`,
            );
        }
    }

    if (pending.length) {
        console.log('\nPRE-RULE, NOT YET PAST THE WINDOW — these will become overdue and');
        console.log('will also never be paid automatically, for the same reason.\n');
        for (const r of pending) {
            console.log(
                `  ${r.escrowId}  order ${r.orderId || '(none)'}  seller ${r.sellerId}  `
                + `${naira(r.amount)}  ${(r.verdict as any).daysSinceDispatch}d since dispatch`,
            );
        }
    }

    console.log('\nNothing was written. This script has no write mode.\n');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
