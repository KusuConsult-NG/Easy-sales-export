/**
 * @jest-environment node
 */

/**
 * A payment that was claimed and then failed to fulfil must be findable.
 *
 * THE DEFECT
 * ----------
 * claim_payment_once writes `status` at claim time and its default is
 * 'completed' (migration 009: `p_status TEXT DEFAULT 'completed'`). Claiming
 * before fulfilling is deliberate — for money, a stuck payment somebody
 * investigates beats one that silently fulfils twice — but it means the row
 * reads "completed" from the instant of the claim, before any work has happened.
 *
 * So when fulfilment then threw, the result was:
 *
 *   - money collected
 *   - nothing delivered
 *   - processed_payments saying `completed`
 *   - reconcilePendingFulfillments looking only for `pending_fulfilment`, so it
 *     never found these
 *
 * Nothing anywhere recorded that the payment had failed. This is the same
 * category the savings-balance repair had to label STRANDED and refuse to touch.
 *
 * MEASURED, NOT ASSUMED
 * ---------------------
 * Twenty claim sites across all six modules. Fifteen take the default status.
 * Of those, four had throw paths after the claim:
 *
 *   farm-nation-payment.ts   farm_nation_escrow        3 throws
 *   _payment.ts              cooperative_contribution  2 throws
 *   export-payment.ts        export_investment         2 throws
 *   service.ts               cooperative_contribution  1 throw
 *
 * _loans_repayments.ts is deliberately excluded from that list: it sets
 * `status: "loan_repayment"`, so its rows never claim to be completed payments.
 * It still marks on failure, because nothing looked for a claimed repayment that
 * was never credited either.
 *
 * processWaveRegistration was in an earlier draft of this list and should not
 * have been — the throw attributed to it belongs to processCooperativeContribution,
 * which starts 69 lines later in the same file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const rpc = jest.fn<any>();

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: { rpc: (...a: any[]) => rpc(...a) },
    supabase: {},
}));

beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
});

describe('markFulfilmentFailed', () => {
    it('marks the row fulfilment_failed with the reason and a timestamp', async () => {
        const { markFulfilmentFailed } = await import('@/lib/wallet-ledger');

        await markFulfilmentFailed('PSK-REF-1', 'Property is not in pending escrow state');

        expect(rpc).toHaveBeenCalledTimes(1);
        const [fn, args] = rpc.mock.calls[0] as [string, any];
        expect(fn).toBe('apply_document_patch');
        expect(args.p_table).toBe('processed_payments');
        expect(args.p_id).toBe('PSK-REF-1');
        expect(args.p_patch.status).toBe('fulfilment_failed');
        expect(args.p_patch.fulfilmentError).toBe('Property is not in pending escrow state');
        expect(Number.isNaN(Date.parse(args.p_patch.fulfilmentFailedAt))).toBe(false);
    });

    it('does NOT release the claim', async () => {
        // Releasing it would let a webhook retry fulfil a payment whose failure
        // may be non-deterministic, and double-fulfilment is the thing claiming
        // exists to prevent. Only the status changes.
        const { markFulfilmentFailed } = await import('@/lib/wallet-ledger');

        await markFulfilmentFailed('PSK-REF-2', 'boom');

        const [, args] = rpc.mock.calls[0] as [string, any];

        // Nothing is removed, and the patch touches ONLY the three fulfilment
        // fields — not the reference, the amount, the user or the type, all of
        // which are what make the claim a claim.
        expect(args.p_deletes).toEqual([]);
        expect(Object.keys(args.p_patch).sort()).toEqual([
            'fulfilmentError',
            'fulfilmentFailedAt',
            'status',
        ]);
    });

    it('never throws when the patch itself fails', async () => {
        // It is called from a catch block on the way to re-raising the original
        // error. An error while recording an error must not replace it, or the
        // reason the payment failed is lost.
        rpc.mockResolvedValue({ error: { message: 'PostgREST is down' } });
        const { markFulfilmentFailed } = await import('@/lib/wallet-ledger');

        await expect(markFulfilmentFailed('PSK-REF-3', 'boom')).resolves.toBeUndefined();
    });

    it('never throws when the RPC rejects outright', async () => {
        rpc.mockRejectedValue(new Error('socket hang up'));
        const { markFulfilmentFailed } = await import('@/lib/wallet-ledger');

        await expect(markFulfilmentFailed('PSK-REF-4', 'boom')).resolves.toBeUndefined();
    });

    it('truncates an enormous reason rather than writing it whole', async () => {
        // Error messages can carry a stack or a whole response body; the column is
        // not a log sink.
        const { markFulfilmentFailed } = await import('@/lib/wallet-ledger');

        await markFulfilmentFailed('PSK-REF-5', 'x'.repeat(5000));

        const [, args] = rpc.mock.calls[0] as [string, any];
        expect(args.p_patch.fulfilmentError.length).toBeLessThanOrEqual(500);
    });
});

describe('every money path that can fail after claiming records it', () => {
    /** The sites measured to have post-claim failure paths. */
    const SITES = [
        ['src/app/actions/farm-nation-payment.ts', 'farm_nation_escrow'],
        ['src/app/actions/cooperative/_payment.ts', 'cooperative_contribution (browser)'],
        ['src/app/actions/export-payment.ts', 'export_investment'],
        ['src/infrastructure/payments/service.ts', 'cooperative_contribution (webhook)'],
        ['src/app/actions/cooperative/_loans_repayments.ts', 'loan_repayment'],
    ] as const;

    it.each(SITES)('%s (%s) calls markFulfilmentFailed', (file: string, _label: string) => {
        const src = readFileSync(join(process.cwd(), file), 'utf-8');

        expect(
            /markFulfilmentFailed\s*\(/.test(src)
                ? 'ok'
                : `${file} can fail after claiming a payment but never records it, so the payment ` +
                  `is invisible: money collected, nothing delivered, and reconciliation cannot ` +
                  `find it.`
        ).toBe('ok');
    });

    it('and imports it from wallet-ledger rather than redefining it', () => {
        for (const [file] of SITES) {
            const src = readFileSync(join(process.cwd(), file), 'utf-8');
            expect(
                /import \{[^}]*markFulfilmentFailed[^}]*\} from ['"]@\/lib\/wallet-ledger['"]/.test(src)
                    ? 'ok'
                    : `${file} does not import markFulfilmentFailed from @/lib/wallet-ledger`
            ).toBe('ok');
        }
    });

    it('the claim default really is completed, which is why this matters', () => {
        // The premise, asserted against the migration rather than trusted. If the
        // default ever becomes 'pending_fulfilment', these marks stop being the
        // only trace and reconciliation could find them on its own.
        const migration = readFileSync(
            join(process.cwd(), 'supabase/migrations/009_claim_payment_once.sql'),
            'utf-8'
        );
        expect(migration).toMatch(/p_status\s+TEXT\s+DEFAULT\s+'completed'/);
    });
});
