/**
 * @jest-environment node
 */

/**
 *   #286 A LOAN REPAYMENT HAD NO UPPER BOUND, SO OVERPAYING DESTROYED THE
 *        EXCESS.
 *
 *        Both repayment paths checked that the amount was POSITIVE and nothing
 *        else:
 *
 *          submitRepaymentAction        `if (data.amount <= 0) refuse`
 *          repayLoanFromSavingsAction   the same, plus the ₦5,000 savings floor
 *
 *        Neither compared it to what the instalment owed. The credit is
 *        `paidAmount: FieldValue.increment(amount)` and the status is
 *        `newPaidAmount >= totalDue ? "paid" : ...`, so an amount larger than
 *        the balance marked the instalment paid and left paidAmount above
 *        totalAmount. Nothing carries the excess to the next instalment, credits
 *        it to savings, or refunds it. It is gone.
 *
 *        THE SAVINGS PATH MAKES THAT REAL MONEY. repayLoanFromSavingsAction
 *        DEBITS the member's savings by the amount and credits the instalment
 *        afterwards, so ₦500,000 against an instalment owing ₦50,000 took
 *        ₦500,000 out of savings and put ₦50,000 of value back. Its own comment
 *        says a failure between the two is "DELIBERATELY NOT COMPENSATED",
 *        which is exactly why the bound is checked BEFORE the debit — the test
 *        that pins the ORDER is the important one in this file.
 *
 *        AND THE SCREEN ALREADY KNEW THE NUMBER. RecordRepaymentModal computed
 *        `Math.max(0, totalAmount - paidAmount)`, printed it beside the input
 *        as "₦50,000 outstanding on this instalment", and then validated only
 *        `value > 0`. #272's shape exactly: a figure displayed and not enforced.
 *
 * WHY A SHARED MODULE RATHER THAN THREE `if` STATEMENTS
 * -----------------------------------------------------
 * The owed figure is `totalAmount + penalty - paidAmount`, and the penalty term
 * is what makes three hand-written copies drift. A bound that forgot it would
 * refuse the very payment that settles an overdue instalment — the failure mode
 * is refusing valid money, which is worse than the defect. So the expression
 * lives in lib/loan-repayment-amount.ts and every caller asks it.
 *
 * IT REFUSES RATHER THAN CAPPING
 * ------------------------------
 * Silently reducing what somebody typed is its own surprise, and on the savings
 * path the caller has to know the figure before any money moves. The refusal
 * names the outstanding amount.
 *
 * WHAT THIS DID NOT SOLVE — AND #212 DID
 * --------------------------------------
 * This fix left a single bank transfer covering TWO instalments unrecordable:
 * claimPaymentOnce is keyed on the reference alone, so the second recording
 * would be seen as a duplicate. That was not made worse here — before, such a
 * transfer was recorded against one instalment and the remainder was destroyed —
 * but it did leave the admin with no move at all.
 *
 * #212 closed it by changing the UNIT rather than the guarantee: the reference
 * is claimed ONCE for the whole transfer and an ALLOCATION splits it across
 * instalments inside that claim. Each line is bounded by THIS module's rule, so
 * nothing below is weakened; see one-transfer-across-two-instalments.test.ts.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { amountOwedOn, checkRepaymentAmount } from '@/lib/loan-repayment-amount';
import { checkRepaymentAllocations } from '@/lib/repayment-allocation';

const BORROWER = 'member-1';

const ACTIONS = 'src/app/actions/cooperative/_loans_repayments.ts';
const ADMIN_MODAL = 'src/components/admin/RecordRepaymentModal.tsx';
const SAVINGS_MODAL = 'src/components/loans/RepayFromSavingsModal.tsx';

/** Call order across both primitives, so the SEQUENCE is asserted, not counts. */
const callOrder: string[] = [];

const mockClaimKey = jest.fn() as jest.Mock<any>;
const mockDebitFloor = jest.fn() as jest.Mock<any>;
const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...a: any[]) => { callOrder.push('claim'); return mockClaimKey(...a); },
    debitJsonbBalanceWithFloor: (...a: any[]) => { callOrder.push('debit'); return mockDebitFloor(...a); },
    claimPaymentOnce: (...a: any[]) => { callOrder.push('record'); return mockClaimPayment(...a); },
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), claimVersionedUpdate: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
    markFulfilmentFailed: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: jest.fn(),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles } },
        error: null,
    }));
}

/**
 * An instalment of ₦10,000 with `paid` already credited, on a loan BORROWER
 * owns, due in the future so no penalty applies. The same stub serves the
 * member read and the instalment read, as in the sibling suites.
 */
function setDocs({ paid = 0, savings = 500_000 }: { paid?: number; savings?: number } = {}) {
    const snap = {
        exists: true,
        empty: false,
        docs: [],
        data: () => ({
            membershipStatus: 'active',
            savingsBalance: savings,
            loanId: 'loan-1',
            userId: BORROWER,
            installmentNumber: 1,
            dueDate: { toDate: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
            totalAmount: 10_000,
            paidAmount: paid,
            status: paid > 0 ? 'partial' : 'pending',
            amount: 100_000,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

async function record(amount: number) {
    setSession(BORROWER);
    const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
    return submitRepaymentAction({
        loanId: 'loan-1',
        installmentId: 'inst-1',
        userId: BORROWER,
        amount,
        paymentReference: 'FT26081012345678',
    }) as any;
}

async function repayFromSavings(amount: number) {
    setSession(BORROWER);
    const { repayLoanFromSavingsAction } = await import('@/app/actions/cooperative/_loans_repayments');
    return repayLoanFromSavingsAction({
        loanId: 'loan-1',
        installmentId: 'inst-1',
        userId: BORROWER,
        amount,
    }) as any;
}

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — what an instalment owes', () => {
    const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const LONG_OVERDUE = new Date(Date.now() - 37 * 24 * 3600 * 1000);

    it('is the total when nothing has been paid', () => {
        expect(amountOwedOn({ totalAmount: 10_000, paidAmount: 0, dueDate: FUTURE })).toBe(10_000);
    });

    it('is the REMAINDER after a partial payment', () => {
        // The half the modal had right and the server did not check at all.
        expect(amountOwedOn({ totalAmount: 10_000, paidAmount: 4_000, dueDate: FUTURE })).toBe(6_000);
    });

    it('INCLUDES THE PENALTY, so an overdue instalment can still be settled', () => {
        // The trap in this fix. calculatePenalty is 0.1%/day after a 7-day
        // grace, so 30 days overdue on ₦10,000 is ₦300. A bound of
        // `totalAmount - paidAmount` would refuse ₦10,300 — the exact payment
        // that clears the instalment, since the action marks it paid against
        // `totalAmount + penalty`.
        const owed = amountOwedOn({ totalAmount: 10_000, paidAmount: 0, dueDate: LONG_OVERDUE });

        expect(owed).toBeGreaterThan(10_000);
        expect(checkRepaymentAmount(owed, {
            totalAmount: 10_000, paidAmount: 0, dueDate: LONG_OVERDUE,
        }).ok).toBe(true);
    });

    it('never goes negative when more was somehow already paid', () => {
        // Rows written before this fix are exactly that shape: paidAmount above
        // totalAmount. They must read as settled, not as a negative ceiling
        // that accepts every amount by being less than it.
        expect(amountOwedOn({ totalAmount: 10_000, paidAmount: 50_000, dueDate: FUTURE })).toBe(0);
    });

    it('reads a Firestore-shaped timestamp as well as a Date', () => {
        // The server passes `{ toDate() }`; the modal passes whatever the
        // schedule action returned. Both have to work or the penalty term
        // silently disappears on one side.
        const fromTimestamp = amountOwedOn({
            totalAmount: 10_000, paidAmount: 0, dueDate: { toDate: () => LONG_OVERDUE },
        });

        expect(fromTimestamp).toBe(amountOwedOn({
            totalAmount: 10_000, paidAmount: 0, dueDate: LONG_OVERDUE,
        }));
    });

    it('and an unusable date costs the penalty rather than the whole bound', () => {
        // Fail toward the principal. No date means no penalty, so an overdue
        // instalment with a broken row can be paid down to its face value but
        // not beyond — which is a smaller wrong than refusing every payment.
        expect(amountOwedOn({ totalAmount: 10_000, paidAmount: 0, dueDate: 'not-a-date' })).toBe(10_000);
        expect(amountOwedOn({ totalAmount: 10_000, paidAmount: 0, dueDate: null })).toBe(10_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — the verdict', () => {
    const INST = { totalAmount: 10_000, paidAmount: 0, dueDate: new Date(Date.now() + 864e5) };

    it('REFUSES MORE THAN IS OWED, and says what is owed', () => {
        const v = checkRepaymentAmount(50_000, INST);

        expect(v.ok).toBe(false);
        expect(v.ok === false && v.reason).toBe('over_owed');
        // The number has to be in the message: an admin reconciling a transfer
        // needs to see the figure they are off by, not "invalid amount".
        expect(v.ok === false && v.message).toMatch(/10,000/);
    });

    it('accepts exactly the owed amount', () => {
        // The boundary, in the direction that matters. An off-by-one here makes
        // every instalment unsettleable.
        expect(checkRepaymentAmount(10_000, INST).ok).toBe(true);
    });

    it('accepts a partial payment', () => {
        // Vacuity guard: a bound that refused everything would pass the test
        // above and break the product.
        expect(checkRepaymentAmount(1, INST).ok).toBe(true);
        expect(checkRepaymentAmount(9_999, INST).ok).toBe(true);
    });

    it('refuses zero, negatives and non-numbers with distinct reasons', () => {
        expect(checkRepaymentAmount(0, INST).ok).toBe(false);
        expect(checkRepaymentAmount(-5, INST)).toMatchObject({ reason: 'not_positive' });
        expect(checkRepaymentAmount('abc', INST)).toMatchObject({ reason: 'not_a_number' });
        expect(checkRepaymentAmount(NaN, INST)).toMatchObject({ reason: 'not_a_number' });
        expect(checkRepaymentAmount(Infinity, INST)).toMatchObject({ reason: 'not_a_number' });
    });

    it('refuses any payment against an instalment with nothing outstanding', () => {
        expect(checkRepaymentAmount(1, { totalAmount: 10_000, paidAmount: 10_000 }))
            .toMatchObject({ reason: 'already_settled' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — submitRepaymentAction, the hand-reconciled bank transfer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        callOrder.length = 0;
        setDocs();
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
    });

    it('REFUSES AN AMOUNT LARGER THAN THE INSTALMENT OWES', () => {
        // The defect. ₦50,000 against a ₦10,000 instalment used to be accepted,
        // mark it "paid", and leave paidAmount at 50,000.
        return record(50_000).then((r) => {
            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/more than this instalment owes/i);
        });
    });

    it('AND DOES NOT SPEND THE BANK REFERENCE DOING SO', () => {
        // THE test for where the check sits. claimPaymentOnce runs before the
        // instalment is read for the credit, and a refusal after the claim
        // burns the reference: the admin fixing a mistyped amount would
        // resubmit the real reference, hit the duplicate branch, and be told
        // the repayment succeeded with nothing credited. Mistyping is the
        // ordinary case, so the bound has to be checked first.
        return record(50_000).then(() => {
            expect(mockClaimPayment).not.toHaveBeenCalled();
        });
    });

    it('still records the exact outstanding amount', async () => {
        // Vacuity guard: the action has to still work.
        const r = await record(10_000);

        expect(r.success).toBe(true);
        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
    });

    it('and a partial payment against a partly-paid instalment', async () => {
        // ₦4,000 already credited, so ₦6,000 is the ceiling and ₦2,000 of it is
        // a legitimate partial payment.
        setDocs({ paid: 4_000 });

        expect((await record(2_000)).success).toBe(true);
    });

    it('but not one that would push a partly-paid instalment over', async () => {
        setDocs({ paid: 4_000 });
        const r = await record(6_001);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/6,000/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — repayLoanFromSavingsAction, where the excess was real money', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        callOrder.length = 0;
        setDocs();
        mockClaimKey.mockResolvedValue({ claimed: true });
        mockDebitFloor.mockResolvedValue({ ok: true, balance: 100_000 });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
    });

    it('REFUSES AN AMOUNT LARGER THAN THE INSTALMENT OWES', async () => {
        // ₦100,000 against a ₦10,000 instalment, from ₦500,000 of savings — so
        // the ₦5,000 floor is nowhere near and this refusal can only be the new
        // bound. The first version of this test used ₦500,000 and passed on the
        // FLOOR's message instead, which would have left the bound untested.
        const r = await repayFromSavings(100_000);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/more than this instalment owes/i);
    });

    it('AND NOTHING LEAVES SAVINGS — checked BEFORE the debit, not at the credit', async () => {
        // The whole point of the ordering. This path debits savings and credits
        // the instalment afterwards, and its own comment says a failure between
        // the two is "DELIBERATELY NOT COMPENSATED". A bound applied at the
        // credit would leave the member short by exactly the overpayment it
        // refused — the fix would have caused the loss it was preventing.
        await repayFromSavings(100_000);

        expect(mockDebitFloor).not.toHaveBeenCalled();
        expect(mockClaimKey).not.toHaveBeenCalled();
        expect(callOrder).toEqual([]);
    });

    it('still repays the exact outstanding amount, claiming before debiting', async () => {
        // Vacuity guard, and it re-pins the sequence the sibling suite protects:
        // the new read must not have been inserted between the claim and the
        // debit.
        const r = await repayFromSavings(10_000);

        expect(r.success).toBe(true);
        expect(callOrder.indexOf('claim')).toBeLessThan(callOrder.indexOf('debit'));
    });

    it('and refuses when the instalment cannot be read at all', async () => {
        // Fail closed. This path has no later re-read to fall back on, so an
        // unreadable instalment must not become an unbounded debit.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: false, empty: true, docs: [], data: () => null,
        }));

        const r = await repayFromSavings(10_000);

        expect(r.success).toBe(false);
        expect(mockDebitFloor).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — both server paths ask the same module', () => {
    const src = codeOnly(ACTIONS);

    it('BOTH ACTIONS CALL checkRepaymentAmount', () => {
        // Derived rather than counted by hand: every function in this file that
        // credits an instalment has to be bounded, and a third one added later
        // is the way this comes back.
        expect(src).toContain('import { checkRepaymentAmount }');

        for (const fn of ['submitRepaymentAction', 'repayLoanFromSavingsAction']) {
            const start = src.indexOf(`export async function ${fn}`);
            expect({ fn, found: start > -1 }).toEqual({ fn, found: true });

            const body = src.slice(start, src.indexOf('\nexport async function', start + 10));
            expect({ fn, bounded: body.includes('checkRepaymentAmount(') })
                .toEqual({ fn, bounded: true });
        }
    });

    it('and neither one open-codes the owed figure beside it', () => {
        // The drift this module exists to stop. `totalAmount - paidAmount`
        // written inline is a second expression for one quantity, and it is the
        // one that forgets the penalty.
        expect(src).not.toMatch(/totalAmount\s*-\s*\(?\s*\w*[Pp]aidAmount/);
    });

    it('the savings path checks it before it claims or debits', () => {
        // Positional, because on this path the ORDER is the safety argument and
        // a later refactor moving the check down would still call it.
        const start = src.indexOf('export async function repayLoanFromSavingsAction');
        const body = src.slice(start);

        expect(body.indexOf('checkRepaymentAmount('))
            .toBeLessThan(body.indexOf('claimIdempotencyKey('));
        expect(body.indexOf('checkRepaymentAmount('))
            .toBeLessThan(body.indexOf('debitJsonbBalanceWithFloor('));
    });

    it('and the bank-transfer path checks it before it claims the reference', () => {
        // #212 CHANGED THE SPELLING AND NOT THE GUARANTEE. The pre-flight is
        // now checkRepaymentAllocations, because that path records a transfer
        // split across instalments and every line of it has to be bounded
        // before the reference is spent. It applies THIS rule per line — proved
        // by identity of the refusal in the test below, not by its name.
        const start = src.indexOf('export async function submitRepaymentAction');
        const body = src.slice(start, src.indexOf('\nexport async function', start + 10));

        expect(body.indexOf('checkRepaymentAllocations('))
            .toBeGreaterThan(-1);
        expect(body.indexOf('checkRepaymentAllocations('))
            .toBeLessThan(body.indexOf('claimPaymentOnce('));
    });

    it('and the pre-flight applies THIS bound, not a second one beside it', () => {
        // What stops #212's wrapper from becoming the drift this module exists
        // to prevent. The message a refused line carries is the one
        // checkRepaymentAmount produces for that line, so weakening either
        // makes them differ and this notices.
        const installment = { totalAmount: 10_000, paidAmount: 0, dueDate: new Date(Date.now() + 864e5) };
        const line = { installmentId: 'i1', amount: 50_000 };

        const viaAllocation = checkRepaymentAllocations([line], { i1: { id: 'i1', ...installment } }, 50_000);
        const direct = checkRepaymentAmount(line.amount, installment);

        expect(viaAllocation.ok).toBe(false);
        expect(direct.ok).toBe(false);
        expect(viaAllocation.ok === false && viaAllocation.message)
            .toBe(direct.ok === false && direct.message);
    });

    it('while keeping the authoritative check on the read the credit uses', () => {
        // Two checks, not one. The pre-flight is friendly; the one inside the
        // credit block is the guard, because claimPaymentOnce serialises on the
        // REFERENCE rather than the instalment, so two references against one
        // instalment could both clear a single up-front check.
        const start = src.indexOf('export async function submitRepaymentAction');
        const body = src.slice(start, src.indexOf('\nexport async function', start + 10));

        expect((body.match(/checkRepaymentAmount\(/g) ?? []).length).toBe(1);
        expect(body.lastIndexOf('checkRepaymentAmount('))
            .toBeGreaterThan(body.indexOf('claimPaymentOnce('));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — the screen that displayed the figure it was not enforcing', () => {
    const src = codeOnly(ADMIN_MODAL);

    it('RecordRepaymentModal ENFORCES the outstanding amount it prints', () => {
        // #212 widened this screen from one instalment to an allocation, so the
        // call it makes is checkRepaymentAllocations — which applies THIS bound
        // per line (pinned by the refusal-identity test above). What matters and
        // has not changed: the screen refuses on a verdict rather than printing
        // a figure it does not enforce.
        expect(src).toContain('checkRepaymentAllocations(');
        expect(src).toMatch(/if \(!verdict\.ok\) return showToast\(verdict\.message/);
    });

    it('and the figure it prints comes from the same expression the server uses', () => {
        // Not a second subtraction that agrees today. It was
        // `Math.max(0, (selected.totalAmount || 0) - (selected.paidAmount || 0))`
        // — which omits the penalty, so on an overdue instalment the screen
        // understated what was owed and would now refuse a valid settlement.
        expect(src).toContain('amountOwedOn(');
        expect(src).not.toMatch(/totalAmount \|\| 0\) - \(/);
        expect(src).not.toMatch(/totalAmount\s*-\s*\(?\s*\w*[Pp]aidAmount/);
    });

    it('the instalment list, the prefill and every allocation line use it too', () => {
        // Three places in one file printed the same wrong subtraction; #212's
        // per-line select made it four. Counted, so a fifth cannot quietly go
        // back to arithmetic.
        expect((src.match(/amountOwedOn\(/g) ?? []).length).toBe(4);
    });

    it('and the amount inputs carry the ceiling as well as the floor', () => {
        // `min="1"` was there from the start; the ceiling never was. Per LINE
        // now, bounded by what that line's instalment owes.
        expect(src).toMatch(/max=\{owed \|\| undefined\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#286 — the savings modal, deliberately NOT bounded on the client', () => {
    /**
     * RepayFromSavingsModal does not have the instalment. `amountDue` is a prop,
     * and my-loans passes `loan.nextPaymentAmount` — the scheduled figure, not
     * `totalAmount + penalty - paidAmount`. Capping at it would REFUSE the
     * payment that settles an overdue instalment, because the penalty makes the
     * real owed figure larger.
     *
     * So the bound is the server's alone on that path, which is safe because
     * repayLoanFromSavingsAction applies it before any money moves — asserted
     * above. This pins the reasoning so the asymmetry between the two modals
     * reads as a decision rather than an omission.
     */
    it('is documented, and still submits to the action that does bound it', () => {
        const doc = readFileSync(join(process.cwd(), SAVINGS_MODAL), 'utf-8');

        expect(doc).toContain('#286');
        expect(doc).toContain('repayLoanFromSavingsAction');
    });

    it('and it does not invent a ceiling from the prop it was handed', () => {
        // The mistake this note exists to prevent. `value > amountDue` looks
        // like the fix and refuses valid money on every overdue instalment.
        expect(codeOnly(SAVINGS_MODAL)).not.toMatch(/value\s*>\s*amountDue/);
    });
});
