/**
 * @jest-environment node
 */

/**
 *   #333 A SECOND CONTRIBUTION ACTION CREDITED COOPERATIVE SAVINGS WITH NO
 *        PAYMENT AT ALL.
 *
 *        Two ways to add to a member's savings existed. Only one took money.
 *
 *          THE WIRED ONE   /cooperatives/(member)/contribute
 *                          → initializeContributionPaymentAction  (Paystack)
 *                          → verifyContributionPaymentAction      (_payment.ts)
 *
 *                          claimPaymentOnce on the Paystack reference, then
 *                          increments BOTH totalContributions and
 *                          savingsBalance, writes the unified and cooperative
 *                          ledger rows against that reference, recomputes tier.
 *
 *          _makeContributionAction   read an amount off a FormData and did
 *
 *                              savingsBalance: FieldValue.increment(amount)
 *                              totalSavings:   FieldValue.increment(amount)
 *
 *                          for "savings", or
 *
 *                              loanBalance: FieldValue.increment(-amount)
 *
 *                          for "loan_repayment". No payment, no reference, no
 *                          claim. The amount was whatever the caller typed.
 *
 *        WHY IT IS NOT COSMETIC. savingsBalance is the SPENDABLE figure:
 *        _withdrawal.ts debits it for a bank transfer, _loans_repayments.ts
 *        repays a loan from it, and the borrowing limit is a multiple of it. So
 *        the credit could be walked out as real money or borrowed against — and
 *        the other branch simply erased the caller's own loan balance.
 *
 *        It was also the one money action in _coop_money.ts with no
 *        canTransactAsMember check, so a SUSPENDED member could use it.
 *
 *        REACHABILITY, CHECKED FIRST. Its only UI, ContributionModal.tsx, is
 *        imported by nothing. But _coop_money.ts is "use server" and the
 *        cooperative barrel re-exports the action, and that barrel is imported
 *        by client components that ARE rendered — so it compiled into a live
 *        authenticated POST endpoint with no screen in front of it. The shape
 *        of #279, where an unreferenced enrollInCourseAction granted paid
 *        courses for free.
 *
 *        REFUSED, NOT REMOVED. The export, the signature and the state shape
 *        all stand — nothing that imports it breaks, and no stored data is
 *        touched. What changed is that the endpoint no longer moves money.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const PAYMENT = 'src/app/actions/cooperative/_payment.ts';
const BARREL = 'src/app/actions/cooperative/index.ts';

/**
 * The slice of _coop_money.ts that is the contribution action, from its
 * declaration to the export that wraps it. Every assertion about what the
 * action does or does not do is made against THIS, not the whole file — the
 * file also holds the withdrawal, the loan application and the fixed-savings
 * creator, all of which legitimately move money.
 */
function contributionAction(): string {
    const src = source(MONEY);
    const start = src.indexOf('async function _makeContributionAction(');
    const end = src.indexOf('export const makeContributionAction =');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#333 — the unpaid contribution endpoint credits nothing', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('REFUSES, and says where a contribution is actually made', async () => {
        // THE test. Executed, not read: the action is called with the exact
        // FormData its own schema accepts, and must not report success.
        const { makeContributionAction } = await import('@/app/actions/cooperative/_coop_money');

        const fd = new FormData();
        fd.set('cooperativeId', 'coop-1');
        fd.set('amount', '500000');
        fd.set('type', 'savings');

        const result = await makeContributionAction(
            { error: null, success: true as const, data: { message: '' }, meta: null } as any,
            fd,
        );

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be paid for/i);
        expect(result.error).toMatch(/Contribute page/i);
    });

    it('and refuses the loan_repayment branch too, which erased debt for free', async () => {
        const { makeContributionAction } = await import('@/app/actions/cooperative/_coop_money');

        const fd = new FormData();
        fd.set('cooperativeId', 'coop-1');
        fd.set('amount', '2000000');
        fd.set('type', 'loan_repayment');

        const result = await makeContributionAction({ error: 'x', success: false as const } as any, fd);
        expect(result.success).toBe(false);
    });

    it('still goes through requireSession, so the auth ratchet holds', async () => {
        // The action reaches no write, but it is still an exported server
        // action and action-auth-per-function.test.ts asserts every one of them
        // reaches a guard. Asserted here too so the reason is next to the code.
        const action = contributionAction();
        expect(action).toContain('await requireSession()');
        expect(action).toContain('Authentication required');
    });

    it('WRITES NOTHING — no increment survives behind the refusal', async () => {
        // A refusal that still ran the increments would pass the two tests
        // above. The global firestore recorders are the only way to see that.
        const { makeContributionAction } = await import('@/app/actions/cooperative/_coop_money');

        const g = globalThis as any;
        g.mockFirestoreUpdate?.mockClear?.();
        g.mockFirestoreSet?.mockClear?.();
        g.mockFirestoreAdd?.mockClear?.();

        const fd = new FormData();
        fd.set('cooperativeId', 'coop-1');
        fd.set('amount', '1000000');
        fd.set('type', 'savings');
        await makeContributionAction({ error: 'x', success: false as const } as any, fd);

        expect(g.mockFirestoreUpdate).not.toHaveBeenCalled();
        expect(g.mockFirestoreSet).not.toHaveBeenCalled();
        expect(g.mockFirestoreAdd).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL: those recorders do fire for a write in the same file', async () => {
        // Without this, the assertion above passes for a suite in which the
        // recorders were never wired at all.
        const g = globalThis as any;
        expect(typeof g.mockFirestoreUpdate).toBe('function');
        expect(typeof g.mockFirestoreSet).toBe('function');

        g.mockFirestoreSet.mockClear();
        const { supabaseDb } = await import('@/lib/supabase-db');
        await supabaseDb.collection('cooperative_members').doc('probe').set({ probe: true });
        expect(g.mockFirestoreSet).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#333 — the writes that are gone', () => {
    const action = contributionAction();

    it('the free savings credit is not in the action any more', () => {
        expect(action).not.toMatch(/savingsBalance:\s*FieldValue\.increment/);
    });

    it('nor the cooperative totalSavings credit that went with it', () => {
        expect(action).not.toMatch(/totalSavings:\s*FieldValue\.increment/);
    });

    it('nor the free loan write-down', () => {
        expect(action).not.toMatch(/loanBalance:\s*FieldValue\.increment\(-/);
    });

    it('and it writes no ledger row, because there is no movement to record', () => {
        expect(action).not.toContain('COOPERATIVE_TRANSACTIONS');
        expect(action).not.toContain('COLLECTIONS.TRANSACTIONS');
    });

    it('VACUITY GUARD: the slice really is the contribution action', () => {
        // If the slice were empty or pointed at the wrong function, every
        // not.toMatch above would pass on nothing.
        expect(action.length).toBeGreaterThan(200);
        expect(action).toContain('_makeContributionAction');
        expect(action).toContain('MakeContributionState');
    });

    it('and the same file STILL performs the money moves that are legitimate', () => {
        // The counterpart guard: this finding is about one action, not about
        // disabling the cooperative money layer. If a future edit emptied the
        // file, the assertions above would pass and this one would not.
        const src = source(MONEY);
        expect(src).toContain('debitJsonbBalanceWithFloor');
        expect(src).toContain('claimSingleOpenLoanApplication');
        expect(src).toMatch(/canTransactAsMember/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#333 — the paid path, which is the one that should credit savings', () => {
    const paid = source(PAYMENT);

    it('claims the Paystack reference before crediting anything', () => {
        expect(paid).toContain('claim.claimed');
        expect(paid).toMatch(/claimPaymentOnce/);
    });

    it('credits savingsBalance AND totalContributions, which the free one never did', () => {
        expect(paid).toMatch(/totalContributions:\s*FieldValue\.increment\(amountInNaira\)/);
        expect(paid).toMatch(/savingsBalance:\s*FieldValue\.increment\(amountInNaira\)/);
    });

    it('and writes its ledger rows against that reference', () => {
        // The field the refused action omitted, and the reason the admin
        // cooperative ledger screen showed "N/A" for those rows.
        expect(paid).toMatch(/type:\s*"contribution"/);
        expect(paid).toContain('reference');
    });

    it('the member-facing screen that reaches it exists and goes through Paystack', () => {
        const page = source('src/app/cooperatives/(member)/contribute/page.tsx');
        expect(page).toContain('initializeContributionPaymentAction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#333 — why an action with no screen was still an endpoint', () => {
    it('the module is "use server", so every export is a POST endpoint', () => {
        // Read from the RAW file: stripComments would not remove the directive,
        // but the first line is the claim, so assert it verbatim.
        const raw = readFileSync(MONEY, 'utf-8');
        expect(raw.trimStart().startsWith('"use server"')).toBe(true);
    });

    it('the barrel re-exports it, and live client components import that barrel', () => {
        expect(source(BARREL)).toContain('makeContributionAction');

        // Not the unrendered ContributionModal — components a page actually
        // renders, which is what puts the module in the client graph.
        const { execSync } = require('child_process');
        const importers = execSync(
            "grep -rln 'from \"@/app/actions/cooperative\"' src/components src/app " +
            "--include=*.tsx || true",
            { encoding: 'utf-8' },
        )
            .split('\n')
            .filter(Boolean)
            .filter((f: string) => !f.endsWith('components/modals/ContributionModal.tsx'));

        expect(importers.length).toBeGreaterThan(0);
    });

    it('and its own modal is still imported by nothing — the reachability check', () => {
        // Recorded as a fact rather than acted on: the modal is left in place
        // (nothing is deleted), and it now shows the refusal instead of
        // reporting a contribution that never had a payment behind it.
        const { execSync } = require('child_process');
        // IMPORTS, not mentions: the tombstone comment in _coop_money.ts names
        // the modal, and a bare name grep counts that as an importer.
        const importersOf = (name: string): string[] =>
            execSync(
                `grep -rlE 'import .*${name}' src --include=*.tsx --include=*.ts || true`,
                { encoding: 'utf-8' },
            )
                .split('\n')
                .filter(Boolean)
                .filter((f: string) => !f.includes(`components/modals/${name}.tsx`))
                .filter((f: string) => !f.includes(`components/ui/${name}.tsx`))
                .filter((f: string) => !f.includes('__tests__'));

        // POSITIVE CONTROL for the pattern itself: a component that IS imported
        // must come back non-empty, or the assertion below proves nothing.
        expect(importersOf('Modal').length).toBeGreaterThan(0);

        const importers = importersOf('ContributionModal');

        expect(importers).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#333 — the forensic reconciliation still counts the rows it already wrote', () => {
    it('"savings" stays a credit type, because those rows are in the collection', () => {
        // Nothing is deleted (owner directive). The historical rows are real
        // balance movements as far as a member is concerned, so dropping the
        // type would make every affected member report as a permanent mismatch
        // — the exact failure mode the check was repaired for.
        const forensics = source('src/app/actions/forensics.ts');
        expect(forensics).toMatch(/CREDIT_TYPES\s*=\s*\[[^\]]*"savings"/);
    });
});
