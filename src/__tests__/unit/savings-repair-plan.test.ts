/**
 * @jest-environment node
 */

/**
 * The savings-balance repair decides whether to change a real member's money.
 *
 * scripts/repair-savings-balance.ts cannot run without a database, so the part
 * of it that makes that decision was moved to lib/savings-repair-plan.ts and is
 * tested here. Everything the script still owns is I/O.
 *
 * WHAT THE REPAIR IS FOR
 * ----------------------
 * A cooperative contribution had two confirmation paths crediting different
 * fields: the Paystack webhook credited totalContributions AND savingsBalance;
 * the browser redirect credited only totalContributions. claim_payment_once is
 * keyed on the reference alone, so exactly one ran per payment, and whether a
 * member's spendable balance went up came down to a race.
 *
 * The code defect is fixed. This is the tool for the records it already made,
 * and these are the properties it must have to be safe to point at production:
 *
 *   1. Idempotent — a second run must not credit anyone twice.
 *   2. Conservative — a payment whose fulfilment never completed must be
 *      reported, not repaired, because the member was credited NOTHING and
 *      topping up one field would hide that.
 *   3. Arithmetically right — per member, across multiple payments.
 *
 * Property 1 is the one that costs money if it is wrong, so it is tested from
 * both directions: a stamped row is skipped, and an unstamped one is not.
 */

import { describe, it, expect } from '@jest/globals';
import {
    parseAffectedRow,
    buildRepairPlan,
    type AffectedPayment,
} from '@/lib/savings-repair-plan';

function row(overrides: Record<string, any> = {}) {
    const { raw = {}, ...rest } = overrides;
    return {
        id: 'ref-1',
        user_id: 'user-1',
        amount: 25000,
        raw_data: { type: 'cooperative_contribution', source: 'client_verify', amount: 25000, userId: 'user-1', processedAt: '2026-05-01T10:00:00.000Z', ...raw },
        ...rest,
    };
}

describe('parseAffectedRow — which payments are candidates', () => {
    it('accepts an unrepaired client-verified contribution', () => {
        expect(parseAffectedRow(row())).toEqual({
            reference: 'ref-1',
            userId: 'user-1',
            amount: 25000,
            processedAt: '2026-05-01T10:00:00.000Z',
        });
    });

    it('skips a row already stamped by an earlier run', () => {
        // The whole of the idempotency guarantee. Without this, a second
        // --apply credits every member a second time.
        const stamped = row({ raw: { savingsBalanceRepairedAt: '2026-08-16T09:00:00.000Z' } });
        expect(parseAffectedRow(stamped)).toBeNull();
    });

    it('skips a stamped row even when everything else is valid', () => {
        // Guards against a future refactor that checks the stamp after
        // validating, or only when some other field is missing.
        const stamped = row({ raw: { savingsBalanceRepairedAt: '2026-08-16T09:00:00.000Z', amount: 999999, userId: 'user-9' } });
        expect(parseAffectedRow(stamped)).toBeNull();
    });

    it('prefers raw_data over the denormalised columns', () => {
        // claim_payment_once writes the authoritative copy into raw_data; the
        // columns are a convenience and a legacy row may disagree.
        const parsed = parseAffectedRow(row({ amount: 1, user_id: 'stale-user', raw: { amount: 30000, userId: 'user-real' } }));
        expect(parsed).toEqual(expect.objectContaining({ amount: 30000, userId: 'user-real' }));
    });

    it('falls back to the columns when raw_data lacks the values', () => {
        const parsed = parseAffectedRow(row({ amount: 12000, user_id: 'user-2', raw: { amount: undefined, userId: undefined } }));
        expect(parsed).toEqual(expect.objectContaining({ amount: 12000, userId: 'user-2' }));
    });

    it.each([
        ['a non-numeric amount', { amount: 'abc' }],
        ['a zero amount', { amount: 0 }],
        ['a negative amount', { amount: -5000 }],
        ['an Infinity amount', { amount: Infinity }],
    ])('skips %s rather than incrementing by it', (_label, raw) => {
        // NaN or Infinity reaching apply_increments would corrupt the balance
        // outright, and there is no undo for that.
        expect(parseAffectedRow(row({ amount: null, raw }))).toBeNull();
    });

    it.each([
        ['a missing user', { userId: undefined }],
        ['the string "null"', { userId: 'null' }],
        ['the string "undefined"', { userId: 'undefined' }],
    ])('skips %s — there is no member to credit', (_label, raw) => {
        expect(parseAffectedRow(row({ user_id: null, raw }))).toBeNull();
    });

    it('reports a missing processedAt as null rather than inventing one', () => {
        const parsed = parseAffectedRow(row({ raw: { processedAt: undefined } }));
        expect(parsed?.processedAt).toBeNull();
    });
});

describe('buildRepairPlan — who gets credited and by how much', () => {
    const payment = (reference: string, userId: string, amount: number): AffectedPayment =>
        ({ reference, userId, amount, processedAt: null });

    it('repairs only payments the ledger confirms were credited', () => {
        // A claim with no ledger row means fulfilment failed after claiming, so
        // the member was credited NOTHING — not just savingsBalance. Topping up
        // one field would leave totalContributions short and hide the problem.
        const affected = [
            payment('ref-a', 'user-1', 10_000),
            payment('ref-b', 'user-2', 20_000), // stranded
        ];
        const plan = buildRepairPlan(affected, new Set(['ref-a']));

        expect(plan.repairable.map(p => p.reference)).toEqual(['ref-a']);
        expect(plan.stranded.map(p => p.reference)).toEqual(['ref-b']);
    });

    it('excludes stranded money from the total to be credited', () => {
        const affected = [payment('ref-a', 'user-1', 10_000), payment('ref-b', 'user-2', 20_000)];
        const plan = buildRepairPlan(affected, new Set(['ref-a']));
        expect(plan.totalOwed).toBe(10_000);
    });

    it('sums several payments per member into one increment', () => {
        // One RPC per member rather than one per payment: fewer writes, and the
        // per-member figure is what the report shows.
        const affected = [
            payment('ref-a', 'user-1', 10_000),
            payment('ref-b', 'user-1', 5_000),
            payment('ref-c', 'user-2', 7_500),
        ];
        const plan = buildRepairPlan(affected, new Set(['ref-a', 'ref-b', 'ref-c']));

        expect(plan.byMember.size).toBe(2);
        expect(plan.byMember.get('user-1')!.reduce((s, p) => s + p.amount, 0)).toBe(15_000);
        expect(plan.byMember.get('user-2')!.reduce((s, p) => s + p.amount, 0)).toBe(7_500);
        expect(plan.totalOwed).toBe(22_500);
    });

    it('keeps a member out of byMember entirely when all their payments are stranded', () => {
        // Not "credited zero" — absent. A zero-amount RPC is a write against a
        // member the script has decided not to touch.
        const affected = [payment('ref-a', 'user-1', 10_000), payment('ref-b', 'user-2', 20_000)];
        const plan = buildRepairPlan(affected, new Set(['ref-a']));

        expect(plan.byMember.has('user-2')).toBe(false);
        expect([...plan.byMember.keys()]).toEqual(['user-1']);
    });

    it('credits a member their confirmed payments while reporting their stranded one', () => {
        // The mixed case, which is the one a naive per-member split gets wrong.
        const affected = [
            payment('ref-a', 'user-1', 10_000),
            payment('ref-b', 'user-1', 6_000), // stranded
        ];
        const plan = buildRepairPlan(affected, new Set(['ref-a']));

        expect(plan.byMember.get('user-1')!.map(p => p.reference)).toEqual(['ref-a']);
        expect(plan.stranded.map(p => p.reference)).toEqual(['ref-b']);
        expect(plan.totalOwed).toBe(10_000);
    });

    it('plans nothing when there is nothing to repair', () => {
        const plan = buildRepairPlan([], new Set());
        expect(plan.byMember.size).toBe(0);
        expect(plan.totalOwed).toBe(0);
        expect(plan.stranded).toEqual([]);
    });

    it('repairs nothing when the ledger confirms none of them', () => {
        const affected = [payment('ref-a', 'user-1', 10_000), payment('ref-b', 'user-2', 20_000)];
        const plan = buildRepairPlan(affected, new Set());
        expect(plan.byMember.size).toBe(0);
        expect(plan.totalOwed).toBe(0);
        expect(plan.stranded).toHaveLength(2);
    });
});
