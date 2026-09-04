/**
 * @jest-environment node
 */

/**
 *   #212 (from #286) ONE BANK TRANSFER COVERING TWO INSTALMENTS COULD NOT BE
 *        RECORDED AT ALL.
 *
 *        claimPaymentOnce is keyed on the bank reference ALONE, so a transfer
 *        of ₦120,000 settling instalment 3 (₦100,000) and part of instalment 4
 *        (₦20,000) could be recorded exactly once. Before #286 the admin's only
 *        move was to record the whole ₦120,000 against instalment 3 — the
 *        credit is `increment(amount)` and the status is
 *        `newPaidAmount >= totalDue ? "paid"`, so instalment 3 went to paid with
 *        ₦20,000 above what it owed and nothing carried the excess anywhere.
 *        The money was gone. #286 refuses that, correctly, and left the transfer
 *        with no way to be recorded.
 *
 * THE DECISION, AND THE TWO OPTIONS IT REJECTED
 * ---------------------------------------------
 * A SUFFIXED REFERENCE — TRF12345-1, TRF12345-2 — was the obvious move and is
 * the wrong one. Each suffix is a separate claim, so nothing ties the parts to
 * one transfer and nothing bounds their total: an admin can invent -3, -4, -5
 * and credit as much as the instalments will absorb. That is as unbounded as
 * the old workaround while LOOKING controlled — finding class (n).
 *
 * A CREDIT NOTE adds a second money concept to a codebase whose recurring
 * defect is already too many names for one quantity (#270, #271, #336).
 *
 * WHAT WAS WRONG IS THE UNIT. The operation is "reconcile a transfer,
 * allocating it across instalments", so the reference is claimed ONCE for the
 * WHOLE transfer and the split happens inside that claim. claimPaymentOnce's
 * guarantee is untouched: one reference, one claim, ever.
 *
 * AND THE SUM MUST EQUAL THE TRANSFER, not merely fit inside it. Recording
 * ₦100,000 of a ₦120,000 transfer would spend the reference and strand ₦20,000
 * that could never be allocated — the same defect, one step along.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    checkRepaymentAllocations,
    singleAllocation,
    MAX_ALLOCATIONS_PER_TRANSFER,
} from '@/lib/repayment-allocation';
import { checkRepaymentAmount } from '@/lib/loan-repayment-amount';
import { stripComments } from '@/lib/testing/strip-comments';

const BORROWER = 'member-1';
const ADMIN = 'admin-1';
const LOAN = 'loan-1';
const REFERENCE = 'FT26081012345678';

const ALLOCATION_MODULE = 'src/lib/repayment-allocation.ts';
const ACTIONS = 'src/app/actions/cooperative/_loans_repayments.ts';
const ADMIN_MODAL = 'src/components/admin/RecordRepaymentModal.tsx';

const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
    markFulfilmentFailed: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: jest.fn(),
}));

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles } },
        error: null,
    }));
}

/** An instalment as the schedule stores it, due far enough out to carry no penalty. */
function instalment(over: Record<string, any> = {}) {
    return {
        loanId: LOAN,
        userId: BORROWER,
        installmentNumber: 3,
        dueDate: { toDate: () => new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        totalAmount: 100_000,
        paidAmount: 0,
        status: 'pending',
        ...over,
    };
}

const MISSING = { exists: false, empty: true, docs: [], data: () => null };

/**
 * Routes reads BY DOCUMENT ID, because a split reads more than one instalment
 * and a single blanket stub would make every line look identical — which is
 * exactly the assertion this file needs to be able to fail.
 */
function setDocs(rows: Record<string, Record<string, any>>) {
    (global as any).mockFirestoreGet.mockImplementation((key: string) => {
        if (rows[key]) {
            return Promise.resolve({ exists: true, empty: false, docs: [], data: () => rows[key] });
        }
        if (key === LOAN) {
            return Promise.resolve({
                exists: true, empty: false, docs: [],
                data: () => ({ userId: BORROWER, memberId: BORROWER, amount: 500_000, status: 'active' }),
            });
        }
        if (key === 'loan_repayments') {
            // The post-credit sweep. Non-empty and not all paid, so the loan is
            // not swept to "repaid" and that path stays out of these assertions.
            return Promise.resolve({
                exists: true, empty: false,
                docs: Object.values(rows).map((r) => ({ data: () => r })),
                data: () => null,
            });
        }
        return Promise.resolve(MISSING);
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(MISSING));
}

/**
 * What was actually added to each instalment, as `[docId, naira]`.
 *
 * Reads the FieldValue's operand rather than the object, because the credit
 * MUST be an increment applied in SQL — a plain number here would be the lost
 * update this action was fixed for, and reading `_operand` off a number is
 * undefined, so this assertion fails on that shape rather than passing.
 */
function creditsApplied(): Array<[string, number]> {
    return ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .filter(([, fields]) => fields && 'paidAmount' in fields)
        .map(([id, fields]) => [id, fields.paidAmount?._operand]);
}

async function submit(data: Record<string, any>, caller = { id: ADMIN, roles: ['admin'] }) {
    setSession(caller.id, caller.roles);
    const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
    return submitRepaymentAction(data as any) as any;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#212 — a transfer, as lines', () => {
    const OWES_100K = { id: 'inst-3', ...instalment() };
    const OWES_100K_TOO = { id: 'inst-4', ...instalment({ installmentNumber: 4 }) };
    const BOOK = { 'inst-3': OWES_100K, 'inst-4': OWES_100K_TOO };

    it('ACCEPTS THE TRANSFER THE PRODUCT COULD NOT RECORD', () => {
        // THE test. ₦120,000 settling instalment 3 in full and ₦20,000 of
        // instalment 4 — one bank reference, one claim, two credits.
        const verdict = checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 100_000 }, { installmentId: 'inst-4', amount: 20_000 }],
            BOOK,
            120_000,
        );

        expect(verdict.ok).toBe(true);
        expect(verdict.ok === true && verdict.total).toBe(120_000);
    });

    it('and the one-instalment case, which is the same operation with one line', () => {
        // Vacuity guard. Every existing caller sends this shape and must be
        // unaffected.
        expect(checkRepaymentAllocations(singleAllocation('inst-3', 100_000), BOOK, 100_000).ok).toBe(true);
    });

    it('singleAllocation is one line whose amount IS the transfer', () => {
        expect(singleAllocation('inst-3', 100_000)).toEqual([{ installmentId: 'inst-3', amount: 100_000 }]);
    });

    it('REFUSES A SHORTFALL, so the reference cannot be spent on part of a transfer', () => {
        // The defect one step along. Allowing this would let an admin record
        // ₦100,000 of a ₦120,000 transfer and burn the reference, stranding
        // ₦20,000 that nothing could ever allocate.
        const verdict = checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 100_000 }],
            BOOK,
            120_000,
        );

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.reason).toBe('sum_mismatch');
        // The figure has to be in the message. "Does not match" tells an admin
        // reconciling against a bank statement nothing they can act on.
        expect(verdict.ok === false && verdict.message).toMatch(/20,000/);
        // And which DIRECTION it is out by, or the admin has to work out
        // whether to add a line or reduce one.
        expect(verdict.ok === false && verdict.message).toMatch(/unallocated/i);
    });

    it('and refuses allocating MORE than the transfer', () => {
        const verdict = checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 100_000 }, { installmentId: 'inst-4', amount: 30_000 }],
            BOOK,
            120_000,
        );

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.reason).toBe('sum_mismatch');
        expect(verdict.ok === false && verdict.message).toMatch(/10,000/);
        expect(verdict.ok === false && verdict.message).toMatch(/more than the transfer/i);
    });

    it('compares in kobo, so naira decimals do not refuse a correct allocation', () => {
        // 1000.10 + 1000.20 is 2000.3000000000002 in IEEE-754, and a ₦2,000.30
        // transfer split that way is an ordinary one. An exact comparison on the
        // raw sum would refuse it for a reason nobody could see — a worse
        // failure than the one being fixed, because the admin has no move.
        expect(1000.10 + 1000.20).not.toBe(2000.30);

        expect(checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 1000.10 }, { installmentId: 'inst-4', amount: 1000.20 }],
            BOOK,
            2000.30,
        ).ok).toBe(true);
    });

    it('but a kobo really missing is still a mismatch', () => {
        // Vacuity guard on the rounding above: it must tolerate float dust, not
        // a real difference.
        expect(checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 100_000 }, { installmentId: 'inst-4', amount: 20_000 }],
            BOOK,
            120_000.01,
        ).ok).toBe(false);
    });

    it('REFUSES THE SAME INSTALMENT TWICE', () => {
        // Not tidiness. Each line is bounded SEPARATELY against the same
        // outstanding figure, so two lines of ₦100,000 against one instalment
        // owing ₦100,000 would both pass their own bound and together credit
        // twice what it owes — the #286 defect, reintroduced through the split.
        const verdict = checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: 100_000 }, { installmentId: 'inst-3', amount: 100_000 }],
            BOOK,
            200_000,
        );

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.reason).toBe('duplicate_installment');
    });

    it('refuses an empty allocation', () => {
        expect(checkRepaymentAllocations([], BOOK, 120_000)).toMatchObject({ ok: false, reason: 'none' });
    });

    it('refuses more lines than one transfer may be split across', () => {
        const many = Array.from({ length: MAX_ALLOCATIONS_PER_TRANSFER + 1 }, (_, i) => ({
            installmentId: `inst-${i}`, amount: 1,
        }));

        expect(checkRepaymentAllocations(many, BOOK, many.length))
            .toMatchObject({ ok: false, reason: 'none' });
    });

    it('refuses a line with no instalment chosen, saying so', () => {
        // The MESSAGE is the assertion. An empty select falls through to the
        // schedule lookup and is refused either way, so a refusal alone would
        // pass with this check deleted — and the admin would be told the
        // instalment is not on the loan rather than that they have not picked
        // one, which is a different problem with a different fix.
        const verdict = checkRepaymentAllocations([{ installmentId: '', amount: 120_000 }], BOOK, 120_000);

        expect(verdict).toMatchObject({ ok: false, reason: 'unknown_installment' });
        expect(verdict.ok === false && verdict.message).toMatch(/choose an instalment for every line/i);
    });

    it('refuses an instalment that is not on this loan schedule', () => {
        const verdict = checkRepaymentAllocations(
            [{ installmentId: 'inst-99', amount: 120_000 }], BOOK, 120_000,
        );

        expect(verdict).toMatchObject({ ok: false, reason: 'unknown_installment' });
        expect(verdict.ok === false && verdict.message).toMatch(/not on this loan/i);
    });

    it('refuses a transfer amount that is not a positive number', () => {
        for (const bad of [0, -1, NaN, 'abc', undefined, null]) {
            expect(checkRepaymentAllocations(
                [{ installmentId: 'inst-3', amount: 100_000 }], BOOK, bad,
            ).ok).toBe(false);
        }
    });

    it('and says the AMOUNT is missing rather than reporting a mismatch against zero', () => {
        // A blank amount field is the ordinary case. Without its own check the
        // sum comparison still refuses — 100,000 against 0 — but tells the
        // admin their allocations come to ₦100,000 more than the transfer,
        // which describes a problem they do not have.
        const verdict = checkRepaymentAllocations([{ installmentId: 'inst-3', amount: 100_000 }], BOOK, 0);

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.message).toMatch(/enter the amount of the bank transfer/i);
    });

    it('refuses an empty allocation with a message the caller can act on', () => {
        // The action used to restate this rule beside the call. It does not any
        // more, so this refusal — message included — is the only one there is.
        const verdict = checkRepaymentAllocations([], BOOK, 120_000);

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.message).toMatch(/at least one instalment/i);
    });

    it('BOUNDS EACH LINE WITH #286 RULE, not a copy of it', () => {
        // Shared predicate, asserted by identity of the REFUSAL: the message a
        // line refusal carries is the one checkRepaymentAmount produces for that
        // same line, so weakening one weakens both and this test notices.
        const over = { installmentId: 'inst-3', amount: 100_001 };
        const verdict = checkRepaymentAllocations([over], BOOK, 100_001);

        const direct = checkRepaymentAmount(over.amount, OWES_100K);

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.reason).toBe('line_refused');
        expect(verdict.ok === false && verdict.message).toBe(direct.ok === false ? direct.message : '');
        expect(verdict.ok === false && verdict.installmentId).toBe('inst-3');
    });

    it('and includes the penalty, so an overdue line can still be settled', () => {
        // The trap #286 named. calculatePenalty is 0.1%/day after a seven-day
        // grace, so an overdue instalment owes MORE than totalAmount and a bound
        // that forgot it would refuse the payment that clears the instalment.
        const overdue = {
            id: 'inst-3',
            ...instalment({ dueDate: { toDate: () => new Date(Date.now() - 37 * 24 * 3600 * 1000) } }),
        };
        const owed = checkRepaymentAmount(1, overdue).owed;

        expect(owed).toBeGreaterThan(100_000);
        expect(checkRepaymentAllocations(
            [{ installmentId: 'inst-3', amount: owed }], { 'inst-3': overdue }, owed,
        ).ok).toBe(true);
    });

    it('imports the owed-amount rule and nothing else', () => {
        // #381's discipline. A shared rule that pulls in the database adapter or
        // a "use server" module cannot be called from the browser, and the
        // screen calling the same rule as the server is half of this fix.
        const imports = code(ALLOCATION_MODULE).match(/^import .*$/gm) ?? [];

        expect(imports).toHaveLength(1);
        expect(imports[0]).toContain('@/lib/loan-repayment-amount');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#212 — submitRepaymentAction records the split', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDocs({
            'inst-3': instalment(),
            'inst-4': instalment({ installmentNumber: 4 }),
        });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
    });

    const SPLIT = [
        { installmentId: 'inst-3', amount: 100_000 },
        { installmentId: 'inst-4', amount: 20_000 },
    ];

    it('CREDITS BOTH INSTALMENTS FROM ONE TRANSFER', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        expect(r.success).toBe(true);

        expect(creditsApplied()).toEqual([['inst-3', 100_000], ['inst-4', 20_000]]);
    });

    it('CLAIMING THE REFERENCE EXACTLY ONCE, FOR THE WHOLE TRANSFER', async () => {
        // The guarantee that must not have been weakened to make the split
        // possible. A second claim per line is what a suffixed reference would
        // have been, and it bounds nothing.
        await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
        const [args] = mockClaimPayment.mock.calls[0] as [any];
        expect(args.reference).toBe(REFERENCE);
        expect(args.amount).toBe(120_000);
        expect(args.userId).toBe(BORROWER);
    });

    it('and the claim names every instalment the transfer paid', async () => {
        // `data.installmentId` is undefined on a split, so metadata built from
        // it would leave the one record of this reference unable to say what it
        // settled.
        await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        const [args] = mockClaimPayment.mock.calls[0] as [any];
        expect(args.metadata.installmentIds).toEqual(['inst-3', 'inst-4']);
    });

    it('writes one payment row per line, each carrying the transfer it belongs to', async () => {
        // One reference now produces more than one loan_payments row. A reader
        // reconciling against a bank statement has to be able to tell those are
        // parts of one transfer rather than duplicates of it.
        await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        const rows = ((global as any).mockFirestoreSet.mock.calls as any[])
            .map(([, data]) => data)
            .filter((d) => d && d.paymentReference === REFERENCE);

        expect(rows).toHaveLength(2);
        expect(rows.map((d) => [d.installmentId, d.amount, d.transferAmount, d.allocationCount]))
            .toEqual([
                ['inst-3', 100_000, 120_000, 2],
                ['inst-4', 20_000, 120_000, 2],
            ]);
    });

    it('REFUSES A SPLIT THAT DOES NOT SUM TO THE TRANSFER, WITHOUT SPENDING THE REFERENCE', async () => {
        // The reason the whole allocation is checked before the claim. A
        // refusal afterwards burns the reference; with a split it is worse — one
        // line credited and one refused leaves a half-applied transfer that no
        // second attempt can finish, because the reference is gone.
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE,
            allocations: [{ installmentId: 'inst-3', amount: 100_000 }],
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/20,000/);
        expect(mockClaimPayment).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('and refuses a line larger than its instalment owes, before the claim', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 220_000,
            paymentReference: REFERENCE,
            allocations: [
                { installmentId: 'inst-3', amount: 200_000 },
                { installmentId: 'inst-4', amount: 20_000 },
            ],
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/more than this instalment owes/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('and refuses the same instalment twice, before the claim', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 200_000,
            paymentReference: REFERENCE,
            allocations: [
                { installmentId: 'inst-3', amount: 100_000 },
                { installmentId: 'inst-3', amount: 100_000 },
            ],
        });

        expect(r.success).toBe(false);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('and refuses an unreadable instalment before the claim rather than mid-way through', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE,
            allocations: [
                { installmentId: 'inst-3', amount: 100_000 },
                { installmentId: 'inst-gone', amount: 20_000 },
            ],
        });

        expect(r.success).toBe(false);
        // The message matters as much as the refusal: a preflight row that read
        // as PRESENT but empty would still be refused, on the bound — telling
        // the admin the instalment has nothing outstanding when the truth is
        // that it could not be read.
        expect(String(r.error)).toMatch(/not on this loan/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses an empty allocation through the shared rule, not a second one beside it', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: [],
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/at least one instalment/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('BINDS EVERY LINE TO THE LOAN, not just the first', async () => {
        // The #286-era ownership check ran once, on one instalment. With a split
        // it has to run per line or a second line could credit an instalment of
        // somebody else's loan under this transfer.
        setDocs({
            'inst-3': instalment(),
            'inst-4': instalment({ installmentNumber: 4, loanId: 'loan-someone-else' }),
        });

        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/does not belong to this loan/i);
    });

    it('and to the borrower, not just the first', async () => {
        setDocs({
            'inst-3': instalment(),
            'inst-4': instalment({ installmentNumber: 4, userId: 'member-2' }),
        });

        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/does not belong to this borrower/i);
    });

    it('THE SINGLE-INSTALMENT SHAPE STILL WORKS, UNCHANGED', async () => {
        // repayLoanFromSavingsAction and every other existing caller send
        // `installmentId` and an amount with no allocations. The split is a
        // widening, not a replacement.
        const r = await submit({
            loanId: LOAN, installmentId: 'inst-3', userId: BORROWER,
            amount: 100_000, paymentReference: REFERENCE,
        });

        expect(r.success).toBe(true);
        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
        expect(creditsApplied()).toEqual([['inst-3', 100_000]]);
    });

    it('and a single-instalment amount above what it owes is still refused', async () => {
        // #286, still enforced through the new path.
        const r = await submit({
            loanId: LOAN, installmentId: 'inst-3', userId: BORROWER,
            amount: 500_000, paymentReference: REFERENCE,
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/more than this instalment owes/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses a call that names no instalment at all', async () => {
        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000, paymentReference: REFERENCE,
        });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/at least one instalment/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('AND THE POST-CLAIM BOUND IS WHAT CATCHES A LINE THAT WAS FINE AT PREFLIGHT', async () => {
        // Why there are two checks and not one. claimPaymentOnce serialises on
        // the REFERENCE, not on the instalment, so another reference can settle
        // instalment 3 between the preflight read and the credit read. Here the
        // preflight sees it owing ₦100,000 and the credit read sees it settled:
        // the authoritative check on the read the credit is computed from is the
        // only thing standing between that and a ₦100,000 overpayment.
        let reads = 0;
        (global as any).mockFirestoreGet.mockImplementation((key: string) => {
            if (key === 'inst-3') {
                reads += 1;
                return Promise.resolve({
                    exists: true, empty: false, docs: [],
                    data: () => instalment(reads > 1 ? { paidAmount: 100_000, status: 'partial' } : {}),
                });
            }
            if (key === LOAN) {
                return Promise.resolve({
                    exists: true, empty: false, docs: [],
                    data: () => ({ userId: BORROWER, memberId: BORROWER }),
                });
            }
            return Promise.resolve(MISSING);
        });

        const r = await submit({
            loanId: LOAN, installmentId: 'inst-3', userId: BORROWER,
            amount: 100_000, paymentReference: REFERENCE,
        });

        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
        expect(r.success).toBe(false);
        expect(creditsApplied()).toEqual([]);
    });

    it('re-recording the transfer credits nothing, split or not', async () => {
        // Rule 3 in wallet-ledger.ts. A lost claim means the money already
        // moved: a success, and with a split it must not credit ANY line again.
        mockClaimPayment.mockResolvedValue({ claimed: false, status: 'loan_repayment' });

        const r = await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('the audit log records the whole split, not whichever line ran last', async () => {
        await submit({
            loanId: LOAN, userId: BORROWER, amount: 120_000,
            paymentReference: REFERENCE, allocations: SPLIT,
        });

        const [logged] = (global as any).mockCreateAdminAuditLog.mock.calls[0] as [any];

        expect(logged.metadata.allocations.map((a: any) => [a.installmentId, a.amount]))
            .toEqual([['inst-3', 100_000], ['inst-4', 20_000]]);
        expect(logged.metadata.amount).toBe(120_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#212 — the whole allocation is settled before anything is written', () => {
    const src = code(ACTIONS);
    const body = (() => {
        const start = src.indexOf('export async function submitRepaymentAction');
        return src.slice(start, src.indexOf('\nexport async function', start + 10));
    })();

    it('the allocation is checked BEFORE the reference is claimed', () => {
        // Positional as well as behavioural. The behaviour tests above pin the
        // refusals that exist today; this one stops a later edit moving the
        // check below the claim, where a refusal burns the reference.
        expect(body.indexOf('checkRepaymentAllocations('))
            .toBeGreaterThan(-1);
        expect(body.indexOf('checkRepaymentAllocations('))
            .toBeLessThan(body.indexOf('claimPaymentOnce('));
    });

    it('and every line is READ before the check, not as the credit reaches it', () => {
        // A per-line check that credited as it went would leave a half-applied
        // transfer on the first refusal, with the reference already spent.
        expect(body.indexOf('preflightRows')).toBeLessThan(body.indexOf('checkRepaymentAllocations('));
        expect(body.indexOf('preflightRows')).toBeLessThan(body.indexOf('claimPaymentOnce('));
    });

    it('and #286 authoritative per-line bound still runs after the claim', () => {
        // The preflight cannot be the guard: claimPaymentOnce serialises on the
        // REFERENCE and not on the instalment, so two different references
        // against one instalment could both clear an up-front check.
        expect(body.lastIndexOf('checkRepaymentAmount('))
            .toBeGreaterThan(body.indexOf('claimPaymentOnce('));
    });

    it('the credit loop walks the allocations rather than one instalment id', () => {
        // The shape of the fix. `data.installmentId` inside the credit block
        // would mean the split was accepted and only one line applied.
        const loop = body.slice(body.indexOf('claimPaymentOnce('));

        expect(loop).toMatch(/for \(const line of allocations\)/);
        expect(loop).toContain('line.installmentId');
        expect(loop).toContain('FieldValue.increment(line.amount)');
        expect(loop).not.toContain('FieldValue.increment(data.amount)');
    });

    it('and no suffixed-reference scheme was introduced', () => {
        // The rejected option, pinned. A per-line reference derived from the
        // transfer's own would restore an unbounded number of claims under one
        // bank transfer.
        expect(body).not.toMatch(/paymentReference\s*\+/);
        expect(body).not.toMatch(/\$\{data\.paymentReference\}-/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#212 — the screen and the server share one verdict', () => {
    const src = code(ADMIN_MODAL);

    it('the modal asks checkRepaymentAllocations', () => {
        expect(src).toContain('checkRepaymentAllocations(allocations, installmentsById, transferAmount)');
    });

    it('and the SAME verdict is what it displays and what it refuses on', () => {
        // #286's lesson applied to the sum. Two spellings of "does this add up"
        // is how the figure shown and the figure enforced drift apart, so the
        // verdict is computed once and read twice.
        expect((src.match(/checkRepaymentAllocations\(/g) ?? [])).toHaveLength(1);
        expect(src).toMatch(/if \(!verdict\.ok\) return showToast\(verdict\.message/);
        expect(src).toMatch(/\{!verdict\.ok &&/);
    });

    it('and it sends the transfer AND its allocation to the action', () => {
        expect(src).toMatch(/submitRepaymentAction\(\{[\s\S]*allocations,[\s\S]*\}\)/);
        expect(src).toMatch(/amount: verdict\.total/);
    });

    it('and it does not restate the sum rule in the browser', () => {
        // A second client-side "allocated === transfer" comparison would be the
        // copy this fix exists to avoid.
        expect(src).not.toMatch(/allocated\s*[=!]==?\s*transfer/);
        expect(src).not.toMatch(/unallocated\s*[=!]==?\s*0/);
    });

    it('lines can be added and removed, or the split cannot be expressed', () => {
        // #362's shape in reverse: a check that permits a split, on a screen
        // with no way to enter one, would be a control nobody can reach.
        expect(src).toContain('function addLine(');
        expect(src).toContain('function removeLine(');
        expect(src).toContain('MAX_ALLOCATIONS_PER_TRANSFER');
    });
});
