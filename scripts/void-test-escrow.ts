/**
 *   #971 VOID A NAMED TEST ESCROW, SO A TEST PAYMENT CANNOT BECOME A REAL PAYOUT.
 *
 *   Report (writes nothing):   npm run escrow:void -- ESC-ORD-...
 *   Apply:                     npm run escrow:void -- ESC-ORD-... --apply
 *
 *   WHY THIS EXISTS
 *   ---------------
 *   #968 gave dispatch a payout clock: an escrow at `funded` or `in_transit`
 *   whose order was marked shipped is released to the seller five days later.
 *
 *   The production escrow sweep on 2026-09-28 found one row at `funded` —
 *   ESC-ORD-5h5e2cagmi-x10x9, ₦300,000 — which the owner identified as test data
 *   rather than a customer transaction. It carries no `shippedAt`, so #968's loop
 *   cannot reach it today. But `funded` IS in ESCROW_DISPATCH_RELEASABLE_FROM, so
 *   if anyone ever marks that order shipped, the dispatch branch stamps it and the
 *   cron pays ₦300,000 of test money to a real seller five days later.
 *
 *   Moving it to `cancelled` takes it out of every releasable and refundable set
 *   at once — see lib/escrow-status: `cancelled` is terminal, and it is in neither
 *   ESCROW_RELEASABLE_FROM nor ESCROW_REFUNDABLE_FROM. That closes the path
 *   without touching the row's history.
 *
 *   NOTHING IS DELETED, AND THAT IS DELIBERATE. The owner's standing instruction
 *   on this repository is that wrongly-programmed data is repaired rather than
 *   destroyed, and data is kept safe. So this is a STATUS TRANSITION, recorded:
 *   every field the row had it still has, plus why it was voided, by whom, and
 *   when. A reader six months from now can see that this was a decision and not a
 *   customer outcome.
 *
 *   IT IS A COMPARE-AND-SWAP, NOT AN UPDATE
 *   ---------------------------------------
 *   The claim is `from` the exact status this script reported, so:
 *
 *     - if the row was released or refunded between the report and the --apply,
 *       the claim fails and nothing is written. That is the case that matters:
 *       voiding a row whose money has already moved would make the record lie
 *       about where the money went;
 *     - if somebody disputed it in the meantime, the claim also fails, and a
 *       dispute is a person's decision this script must not overwrite.
 *
 *   The adapter's runTransaction takes no lock — that is why every money path in
 *   this codebase claims rather than checks-then-writes, and #653 and #652 are
 *   what it cost to learn.
 *
 *   IT REFUSES ANYTHING THAT IS NOT SAFELY VOIDABLE
 *   -----------------------------------------------
 *   Only `pending`, `funded` and `in_transit` may be voided here. Deliberately
 *   NOT `delivered` (a buyer has confirmed receipt and is owed either goods or a
 *   refund), NOT `disputed` (a person is deciding), and NOT the settled statuses
 *   (the money has gone; the record must keep saying where).
 *
 *   The id is a REQUIRED argument with no default. A maintenance script that
 *   voids escrows and defaults to any of them is one keystroke from voiding the
 *   wrong one.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { isApply, modeBanner, targetHost } from './_maintenance-guard';

//   Meant for the real database, so .env.local is loaded; a local stack wins if
//   one is up. Same order as repair-savings-balance.ts.
if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

const APPLY = isApply();

/**
 * The statuses this script will void, and the reason each of the others is out.
 *
 * Duplicated from lib/escrow-status rather than imported because scripts/ is
 * outside the `@/` alias and reaching through it has broken the docker build
 * context check twice (#427, #967). The test asserts the two agree.
 */
const VOIDABLE = ['pending', 'funded', 'in_transit'] as const;

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

/** The escrow id to void, from argv. Required — see the header. */
function escrowIdFromArgv(argv: readonly string[] = process.argv): string {
    const id = argv.slice(2).find((a) => !a.startsWith('--'));
    if (!id) {
        fail(
            'Which escrow? Pass the id:\n\n'
            + '    npm run escrow:void -- ESC-ORD-5h5e2cagmi-x10x9\n\n'
            + 'Nothing is written without --apply. There is no default id on purpose.',
        );
    }
    return id;
}

async function main(): Promise<void> {
    const escrowId = escrowIdFromArgv();

    console.log(modeBanner(`Void test escrow ${escrowId}`, APPLY, targetHost()));

    const { data, error } = await admin
        .from('document_collections')
        .select('id, raw_data')
        .eq('collection_name', 'escrow_transactions')
        .eq('id', escrowId)
        .maybeSingle();

    if (error) fail(`Reading ${escrowId} failed: ${error.message}`);
    if (!data) fail(`No escrow row with id ${escrowId}.`);

    const row = (data.raw_data ?? {}) as Record<string, unknown>;
    const status = String(row.status ?? '').trim().toLowerCase();
    const gross = Number(row.amount ?? 0);
    const net = Number(row.netAmount);

    console.log(`Status:      ${status || '(none)'}`);
    console.log(`Amount:      ${naira(gross)}${Number.isFinite(net) && net > 0 ? `  (net ${naira(net)})` : ''}`);
    console.log(`Order:       ${String(row.orderId ?? '(none)')}`);
    console.log(`Seller:      ${String(row.sellerId ?? '(unknown)')}`);
    console.log(`Buyer:       ${String(row.buyerId ?? '(unknown)')}`);
    console.log(`shippedAt:   ${row.shippedAt ? String(row.shippedAt) : '(absent — the 5-day dispatch clock cannot reach it yet)'}`);
    console.log('');

    if (!(VOIDABLE as readonly string[]).includes(status)) {
        fail(
            `Status '${status}' is not voidable by this script.\n\n`
            + `   Voidable: ${VOIDABLE.join(', ')}.\n`
            + `   'delivered' is excluded because a buyer has confirmed receipt and is\n`
            + `   owed goods or a refund; 'disputed' because a person is deciding; and\n`
            + `   released/refunded/cancelled because the money has already gone and the\n`
            + `   record must keep saying where.`,
        );
    }

    if (!APPLY) {
        console.log(`Would claim ${escrowId} from '${status}' to 'cancelled', recording why.`);
        console.log('\nNothing was written. Re-run with --apply to write.\n');
        return;
    }

    /*
     *   COMPARE-AND-SWAP on the status this script just reported. A row that
     *   moved between the report and this call is NOT voided — see the header for
     *   which cases that protects.
     *
     *   Written through the same jsonb merge the app's claim helper uses rather
     *   than replacing raw_data, so every field the row had it keeps.
     */
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin
        .from('document_collections')
        .update({
            raw_data: {
                ...row,
                status: 'cancelled',
                cancelledAt: nowIso,
                cancelledBy: 'scripts/void-test-escrow.ts',
                voidReason:
                    'Test transaction, not a customer payment. Voided so #968\'s '
                    + 'five-day dispatch release cannot pay it out if the order is '
                    + 'ever marked shipped. No funds moved.',
                updatedAt: nowIso,
            },
            updated_at: nowIso,
        })
        .eq('collection_name', 'escrow_transactions')
        .eq('id', escrowId)
        .eq('raw_data->>status', status)
        .select('id');

    if (claimError) fail(`Voiding ${escrowId} failed: ${claimError.message}`);

    if (!claimed || claimed.length === 0) {
        fail(
            `${escrowId} was NOT voided: its status is no longer '${status}'.\n\n`
            + `   Something moved this row between the report and this write. Nothing\n`
            + `   was changed. Re-run without --apply to see where it is now.`,
        );
    }

    console.log(`✅ ${escrowId} voided: '${status}' → 'cancelled'.`);
    console.log('   Every other field is unchanged, and the reason is recorded on the row.');
    console.log('   No funds moved — this row never paid out and now cannot.\n');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
