/**
 * @jest-environment node
 */

/**
 *   #298 THE RECONCILIATION JOBS COUNTED A FAILED WALLET CREDIT AS HEALED.
 *
 *        Two jobs exist to find payments Paystack took that this platform
 *        never recorded, and to back-fill them:
 *
 *            api/cron/reconcile-paystack       runs on a schedule
 *            api/admin/finance/paystack-sync   run by an admin
 *
 *        Both dispatch on the payment type:
 *
 *            if (type === "marketplace_order")      await processMarketplaceOrder(...)
 *            else if (type === "export_investment") await processExportInvestment(...)
 *            ... five more ...
 *            else if (type === "wallet_funding") {
 *                const { confirmWalletFundingAction } = await import("@/app/actions/wallet");
 *                await confirmWalletFundingAction(reference, paidAt);
 *            }
 *
 *            // Successfully processed — increment local counter and add to
 *            // set to bypass discrepancy marking
 *            results.firebaseTotal++;
 *            firebaseRefs.add(tx.reference);
 *
 *        EVERY PROCESSOR IN infrastructure/payments/service.ts THROWS when it
 *        cannot fulfil. That is the whole design: the surrounding catch drops
 *        the payment into `missingInFirebase`, the discrepancy count rises, and
 *        the health status goes to warning or critical. For six of the seven
 *        branches it works.
 *
 *        confirmWalletFundingAction is NOT a processor. It is a server action
 *        wrapped in withSafeAction, and a business refusal is RETURNED as
 *        `{ success: false, error }` — it never throws. So the one branch that
 *        credits a member's wallet was the one branch whose failure was
 *        invisible: the counter incremented, the reference was added to the set
 *        that explicitly BYPASSES discrepancy marking, and the job reported
 *        "ok".
 *
 *        A member's funding that Paystack collected and this platform failed to
 *        credit was therefore deleted from the only report built to find it.
 *        The job's entire purpose, inverted, for exactly one payment type — and
 *        the one where the money is most directly the member's.
 *
 * WHY A PROCESSOR RATHER THAN TWO GUARDS
 * --------------------------------------
 * `if (!result.success) throw` twice would have worked today. There were two
 * call sites, and a third would have been written the same way — which is
 * #297, one finding ago, where my own fix landed on one of three copies. It is
 * a processor now, so the seventh branch cannot behave differently from the
 * other six.
 *
 * HOW IT WAS FOUND
 * ----------------
 * The browser-layer sweep re-run over `.ts` as well as `.tsx`. D3 — an action
 * awaited with its result discarded — went from 6 hits to 103 once server files
 * were included. Nearly all are notifications and audit-log writes, which are
 * fire-and-forget by design (#176–#178 settled that a failed audit write must
 * not fail the operation). Two were not: these.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const CRON = 'src/app/api/cron/reconcile-paystack/route.ts';
const SYNC = 'src/app/api/admin/finance/paystack-sync/route.ts';
const SERVICE = 'src/infrastructure/payments/service.ts';

const mockConfirm = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/wallet', () => ({
    confirmWalletFundingAction: (...a: any[]) => mockConfirm(...a),
}));

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#298 — processWalletFunding refuses loudly', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('THROWS WHEN THE CREDIT DID NOT HAPPEN', async () => {
        // The defect in one assertion. This used to be a bare await, and a
        // returned refusal read exactly like a success.
        mockConfirm.mockResolvedValue({ success: false, error: 'Payment not found on Paystack' });
        const { processWalletFunding } = await import('@/infrastructure/payments/service');

        await expect(processWalletFunding('ref-1')).rejects.toThrow(/payment not found/i);
    });

    it('and when the action returns nothing at all', async () => {
        // withSafeAction can return an error shape without `success`; treating
        // that as fulfilled is the same mistake in a different costume.
        mockConfirm.mockResolvedValue(undefined);
        const { processWalletFunding } = await import('@/infrastructure/payments/service');

        await expect(processWalletFunding('ref-2')).rejects.toThrow();
    });

    it('and passes the paid-at date through, which back-dates the ledger row', async () => {
        // Vacuity guard plus a real property: these jobs heal OLD payments, so
        // recording them as if they arrived today would misstate every
        // date-filtered report.
        const paidAt = new Date('2026-02-03T10:00:00Z');
        mockConfirm.mockResolvedValue({ success: true, data: { newBalance: 5000 } });
        const { processWalletFunding } = await import('@/infrastructure/payments/service');

        await expect(processWalletFunding('ref-3', paidAt)).resolves.toBeUndefined();
        expect(mockConfirm).toHaveBeenCalledWith('ref-3', paidAt);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#298 — both jobs treat wallet funding like every other type', () => {
    for (const [name, rel] of [['cron', CRON], ['admin sync', SYNC]] as const) {
        it(`the ${name} job calls the processor, not the action`, () => {
            const src = code(rel);

            expect(src).toContain('processWalletFunding(');
            // The bare call that could not fail.
            expect(src).not.toMatch(/await confirmWalletFundingAction\(/);
            expect(src).not.toMatch(/import\("@\/app\/actions\/wallet"\)/);
        });

        it(`and the ${name} job still handles the other six types`, () => {
            // Vacuity guard: the dispatch has to survive.
            const src = code(rel);

            for (const p of ['processMarketplaceOrder', 'processExportInvestment', 'processAcademyRegistration']) {
                expect({ p, present: src.includes(`${p}(`) }).toEqual({ p, present: true });
            }
        });
    }

    it('THE CRON ONLY COUNTS A PAYMENT AS HEALED AFTER THE DISPATCH', () => {
        // Positional, because the whole defect is that the counter runs
        // unconditionally after a branch that could not fail. With every branch
        // throwing, reaching the counter means fulfilment happened.
        const src = code(CRON);
        const dispatch = src.indexOf('processWalletFunding(');
        const counted = src.indexOf('results.firebaseTotal++', dispatch);

        expect(dispatch).toBeGreaterThan(-1);
        expect(counted).toBeGreaterThan(dispatch);
    });

    it('and the catch that a throw lands in still records a discrepancy', () => {
        // The other half of the argument: throwing is only useful because the
        // caller turns it into missingInFirebase.
        const src = code(CRON);

        expect(src).toMatch(/catch \(healErr\)/);
        expect(src).toContain('results.missingInFirebase.push');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#298 — every payment processor fails the same way', () => {
    /**
     * The ratchet. The defect existed because one of seven branches called
     * something with a different failure contract. A processor that RETURNS a
     * refusal instead of throwing would reintroduce it silently.
     */
    it('NO PROCESSOR RETURNS A REFUSAL, AND EVERY ONE CAN THROW', () => {
        /**
         * Two properties, because the first version of this asserted the wrong
         * one. It looked for `return { … success: … }` anywhere in a processor
         * and reported five of them — but those are the returns of an INNER
         * IIFE whose value the processor immediately checks with
         * `if (!result?.success) { … throw }`. A success object travelling
         * inside a function is not a failure contract; what matters is what the
         * processor hands its CALLER.
         */
        const src = code(SERVICE);
        const returnsRefusal: string[] = [];
        const cannotThrow: string[] = [];

        for (const m of src.matchAll(/export async function (process\w+)\s*\(/g)) {
            const start = m.index ?? 0;
            const next = src.indexOf('\nexport async function', start + 10);
            const body = src.slice(start, next > 0 ? next : src.length);

            if (/return \{[^}]*success:\s*false/.test(body)) returnsRefusal.push(m[1]);
            // `throw`, not `throw new Error` — the first version demanded the
            // latter and reported the two processors whose only propagation is
            // a RETHROW of the fulfilment error. Rethrowing is propagating.
            if (!/\bthrow\b/.test(body)) cannotThrow.push(m[1]);
        }

        expect(returnsRefusal).toEqual([]);
        expect(cannotThrow).toEqual([]);
    });

    it('#299 EVERY FULFILMENT THAT THREW AFTER THE CLAIM IS MARKED FINDABLE', () => {
        /**
         *   #299 ONLY ONE PROCESSOR RECORDED A STUCK PAYMENT.
         *
         *        Each processor claims the reference, then fulfils inside an
         *        IIFE. If fulfilment throws, the claim is already spent —
         *        nothing retries it, and the payment sits paid-but-unfulfilled.
         *        #258/#259 established markFulfilmentFailed as the way such a
         *        payment stays findable, and processCooperativeContribution has
         *        used it since. The other five just let the error propagate,
         *        so the failed-fulfilment report never learned about them.
         *
         *        All six now attach the same `.catch` — mark, then rethrow, so
         *        the caller's behaviour is unchanged and the payment is
         *        recorded either way.
         */
        const src = code(SERVICE);
        const unmarked: string[] = [];

        for (const m of src.matchAll(/export async function (process\w+)\s*\(/g)) {
            const start = m.index ?? 0;
            const next = src.indexOf('\nexport async function', start + 10);
            const body = src.slice(start, next > 0 ? next : src.length);

            // Only the processors that claim-then-fulfil through an IIFE.
            if (!body.includes('})()')) continue;
            if (!body.includes('markFulfilmentFailed(')) unmarked.push(m[1]);
        }

        // Was: every one except processCooperativeContribution.
        expect(unmarked).toEqual([]);
    });

    it('and processWalletFunding is one of them', () => {
        // Not just present — exported from the same module as the other six, so
        // a caller reaches for it in the same place.
        const src = code(SERVICE);

        expect(src).toMatch(/export async function processWalletFunding\(/);
        expect(src).toMatch(/throw new Error\(reason\)/);
    });
});
