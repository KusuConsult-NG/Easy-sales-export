/**
 * @jest-environment node
 */

/**
 *   #276 THE WITHDRAWAL DOOR THE UI ACTUALLY USES APPLIED NEITHER GUARD.
 *
 *        Four doors take a cooperative withdrawal. Here is what each one
 *        checked before this:
 *
 *          api/cooperative/withdraw       minimum  YES   member state  YES
 *          cooperative/_coop_money.ts     minimum  YES   member state  YES
 *          cooperative/_withdrawal.ts     minimum  YES   member state  NO
 *          actions/platform.ts            minimum  NO    member state  NO
 *
 *        The last one is what WithdrawalModal.tsx calls. It is the only door a
 *        member can reach through the product, and it is the only one of the
 *        four that applies neither rule.
 *
 *        BOTH RULES EXIST, AND BOTH HAVE A MODULE WRITTEN TO UNIFY THEM.
 *
 *        cooperative-limits.ts exports COOPERATIVE_MINIMUM_WITHDRAWAL, ₦1,000,
 *        and three doors enforce it. Through the modal, ₦1 goes through.
 *
 *        cooperative-membership-status.ts exists for exactly this question and
 *        opens with "FIVE DOORS, THREE ANSWERS", listing the doors it corrected
 *        and what each of them used to do. platform.ts is not on that list. So
 *        the unification pass enumerated the doors it knew about and the
 *        UI-wired one was not among them — the same shape as #273, where six of
 *        seven upload callers bounded the file size and the live route did not.
 *
 *        WHAT IT COSTS. platform.ts checks that a membership row EXISTS and
 *        that its cooperativeId matches. A member at "pending" — registered,
 *        onboarding incomplete, contribution perhaps landed and nothing
 *        approved — satisfies both. The module's own note spells out why that
 *        matters, about the two doors it did fix: "A member still at 'pending'
 *        — registered, not yet paid, onboarding incomplete — could file a loan
 *        application and lock savings into a fixed plan through them, while the
 *        routes doing the same work refused."
 *
 *        Withdrawal is the same sentence with money leaving instead of being
 *        locked.
 *
 * WHY "approved" MUST STILL PASS
 * ------------------------------
 * It is the LEGACY spelling of "active", not a lesser state — the member
 * directory, the admin list, updateMemberStatusAction and the ID-card reader
 * all treat the two as one. canTransactAsMember already knows that. Adding a
 * hand-written `=== "active"` here instead would refuse every legacy member
 * their own savings, which is the defect that module was written to end.
 *
 * AND THE RATCHET BELOW IMMEDIATELY FOUND A SECOND ONE, WHICH COSTS MORE
 * ----------------------------------------------------------------------
 * _coop_money.ts:94, in _initiateCooperativePaymentAction — the registration
 * payment door, not a withdrawal one, in a file that ALREADY IMPORTS
 * canTransactAsMember and uses it forty lines further down:
 *
 *     if (data?.membershipStatus === "active") return "already a member"
 *
 * A legacy member at "approved" fails that comparison. They then fall past the
 * `paymentStatus === "completed"` branch too if their row does not carry it,
 * and reach the `set(..., { merge: true })` under it, which writes
 *
 *     membershipStatus: "pending"
 *
 * over their existing status — and then initialises a Paystack charge for the
 * registration fee. So the door does not merely tell an established member the
 * wrong thing. IT DEMOTES THEM AND BILLS THEM AGAIN.
 *
 * That is why the ratchet spans every door touching the question rather than
 * only the four withdrawal ones: the shape is "one predicate, several sites,
 * some converted", and the unconverted site is never the one anybody is
 * looking at.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * The CAS primitives are Postgres functions; the fake DB does not implement
 * them, so an unmocked run fails at the debit and every "refuses" assertion
 * below would pass for the wrong reason. Stubbed exactly as
 * withdrawal-reservation-contract.test.ts does, so what these tests exercise is
 * the GUARDS — which is what #276 is about.
 */
jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: jest.fn(async () => ({ claimed: true })),
    debitJsonbBalanceWithFloor: jest.fn(async () => ({ ok: true, newBalance: 450_000 })),
    compensateJsonbDebit: jest.fn(async () => ({ ok: true })),
    debitJsonbBalance: jest.fn(async () => ({ ok: true })),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    claimVersionedUpdate: jest.fn(), incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(), markFulfilmentFailed: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
import { readFileSync } from 'fs';
import { join } from 'path';
import { canTransactAsMember } from '@/lib/cooperative-membership-status';
import { COOPERATIVE_MINIMUM_WITHDRAWAL } from '@/lib/cooperative-limits';

const DOORS = [
    'src/app/api/cooperative/withdraw/route.ts',
    'src/app/actions/cooperative/_coop_money.ts',
    'src/app/actions/cooperative/_withdrawal.ts',
    'src/app/actions/platform.ts',
];

/** The one the product actually reaches. */
const UI_DOOR = 'src/app/actions/platform.ts';
const MODAL = 'src/components/modals/WithdrawalModal.tsx';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#276 — every withdrawal door applies both rules', () => {
    it('finds all four, so the checks below are not vacuous', () => {
        for (const f of DOORS) expect(codeOnly(f).length).toBeGreaterThan(500);
    });

    it('EVERY DOOR ENFORCES THE MINIMUM WITHDRAWAL', () => {
        const missing = DOORS.filter((f) => !codeOnly(f).includes('COOPERATIVE_MINIMUM_WITHDRAWAL'));

        // Was: ["src/app/actions/platform.ts"] — the one the modal calls.
        expect(missing).toEqual([]);
    });

    it('EVERY DOOR ASKS WHETHER THE MEMBER MAY TRANSACT', () => {
        const missing = DOORS.filter((f) => !codeOnly(f).includes('canTransactAsMember('));

        // Was: platform.ts and _withdrawal.ts, both checking only that a
        // membership row EXISTS.
        expect(missing).toEqual([]);
    });

    it('and none of them re-answers the membership question by hand', () => {
        // A hand-written `=== "active"` refuses every legacy member at
        // "approved" — the defect cooperative-membership-status.ts was written
        // to end. #253, #270, #271 and #275 all came from leaving the old
        // comparison beside the new call.
        //
        // Was: ["src/app/actions/cooperative/_coop_money.ts:73"] — the
        // registration door, in a file that already imports the predicate and
        // uses it forty lines lower. See the header: that one demoted an
        // established member and re-billed them.
        const offenders = DOORS
            .flatMap((f) => codeOnly(f).split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => /membershipStatus\s*(===|!==)\s*["']/.test(line))
            .map((o) => o.at);

        expect(offenders).toEqual([]);
    });

    it('the modal still points at the door this fixed', () => {
        // Pinned: if the modal is ever repointed, the door it moves to is the
        // one that has to carry these guards.
        expect(codeOnly(MODAL)).toContain('@/app/actions/platform');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#276 — the rules themselves, so the guards mean something', () => {
    it('a pending member may not transact', () => {
        // The state platform.ts admitted: a row exists, so it passed.
        expect(canTransactAsMember({ membershipStatus: 'pending' })).toBe(false);
        expect(canTransactAsMember({ membershipStatus: 'suspended' })).toBe(false);
        expect(canTransactAsMember({ membershipStatus: 'rejected' })).toBe(false);
        expect(canTransactAsMember({})).toBe(false);
        expect(canTransactAsMember(null)).toBe(false);
    });

    it('AND A LEGACY "approved" MEMBER STILL MAY', () => {
        // The other half, and the reason this uses the shared predicate rather
        // than a literal: "approved" is the legacy spelling of "active".
        expect(canTransactAsMember({ membershipStatus: 'approved' })).toBe(true);
        expect(canTransactAsMember({ membershipStatus: 'active' })).toBe(true);
    });

    it('the minimum is a real floor, not zero', () => {
        // Vacuity guard: a minimum of 0 would satisfy the source checks above
        // while letting a ₦1 withdrawal through, which is what platform.ts did.
        expect(COOPERATIVE_MINIMUM_WITHDRAWAL).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#276 — the UI door, executed', () => {
    const mockRequireSession = jest.fn() as jest.Mock<any>;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    /**
     * Source checks above prove the guards are PRESENT. This proves they FIRE —
     * #274's lesson, where a limiter that was wired up and switched off left
     * every source assertion passing.
     */
    async function submit(opts: { membershipStatus?: string; amount: string }) {
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'member-1', email: 'm@e.test', roles: ['cooperative_member'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'member-1', {
            cooperativeId: 'coop-1',
            membershipStatus: opts.membershipStatus ?? 'active',
            savingsBalance: 500_000,
        });

        const { submitWithdrawalAction } = await import('@/app/actions/platform');

        const fd = new FormData();
        fd.set('idempotencyKey', `k-${Math.random()}`);
        fd.set('amount', opts.amount);
        fd.set('cooperativeId', 'coop-1');
        fd.set('accountNumber', '0123456789');
        fd.set('accountName', 'A Member');
        fd.set('bankName', 'Test Bank');
        fd.set('reason', 'School fees');

        return submitWithdrawalAction({ success: false, error: null } as any, fd) as any;
    }

    it('REFUSES A PENDING MEMBER', async () => {
        const res = await submit({ membershipStatus: 'pending', amount: '50000' });
        expect(res.success).toBe(false);
    });

    it('REFUSES AN AMOUNT BELOW THE MINIMUM', async () => {
        const res = await submit({ amount: '1' });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/minimum/i);
    });

    it('and still lets an active member withdraw a real amount', async () => {
        // Vacuity guard for this whole block.
        const res = await submit({ amount: '50000' });
        expect(res.success).toBe(true);
    });

    it('and a legacy "approved" member too', async () => {
        const res = await submit({ membershipStatus: 'approved', amount: '50000' });
        expect(res.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#276 — the other two doors, executed', () => {
    /**
     * WHY THESE EXIST AND THE SOURCE RATCHET IS NOT ENOUGH.
     *
     * Mutation-testing the four source changes, two mutants SURVIVED. Wrapping
     * the guard as
     *
     *     if (false && !canTransactAsMember(membership)) {
     *
     * leaves the string `canTransactAsMember(` in the file, so "EVERY DOOR ASKS
     * WHETHER THE MEMBER MAY TRANSACT" above kept passing against a guard that
     * had been switched off. Exactly #274, where a limiter that was wired up
     * and disabled satisfied every source assertion written for it.
     *
     * The two platform.ts changes were caught because the block below executes
     * that door. These two had no executing test, so they get one.
     */
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function withMember(membershipStatus: string) {
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'member-2', email: 'm2@e.test', roles: ['cooperative_member'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'member-2', {
            userId: 'member-2',
            cooperativeId: 'coop-1',
            membershipStatus,
            savingsBalance: 500_000,
        });

        return store;
    }

    const REFUSAL = 'Your cooperative membership must be active before you can do this.';

    /**
     *   #248 EVERY DOOR LABELS ITS ROW WITH THE COOPERATIVE, FROM THE MEMBERSHIP.
     *
     *        Two of the three wrote no cooperativeId at all, and the admin
     *        approve and reject paths compare a scoped admin's cooperative
     *        against exactly that field. An unlabelled row was waved through.
     *
     *        EXECUTED RATHER THAN GREPPED, because the first version of this was
     *        a source scan for `cooperativeId:` anywhere in the door's file —
     *        and _coop_money.ts mentions the field in another function, so
     *        deleting the label from the withdrawal write left the scan passing.
     *        Mutation testing caught it. Same lesson as the block header above.
     *
     *        The form and the request body both carry a cooperativeId the caller
     *        chose; each case below sends a DIFFERENT one, so a door that took
     *        the caller's value fails here.
     */
    describe('#248 — the row says which cooperative it belongs to', () => {
        it('_coop_money.ts submitWithdrawalAction labels it from the membership', async () => {
            const store = await withMember('active');
            const { COLLECTIONS } = await import('@/lib/types/firestore');
            const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_coop_money');

            const fd = new FormData();
            fd.set('amount', '50000');
            fd.set('reason', 'School fees');
            fd.set('bankAccount', JSON.stringify({ accountNumber: '0123456789', bankName: 'Test Bank' }));
            // What the caller says. It must not reach the row.
            fd.set('cooperativeId', 'coop-ATTACKER');

            const res: any = await submitWithdrawalAction({ success: false, error: null } as any, fd);
            expect(res.success).toBe(true);

            const rows = store.all(COLLECTIONS.COOPERATIVE_WITHDRAWALS).map(([, doc]) => doc as any);
            expect(rows).toHaveLength(1);
            expect(rows[0].cooperativeId).toBe('coop-1');
        });

        it('and so does _withdrawal.ts, which already did', async () => {
            // Vacuity guard on the pair above: the door that was already correct
            // stays correct, so the assertion is about the field and not about
            // one file.
            const store = await withMember('active');
            const { COLLECTIONS } = await import('@/lib/types/firestore');
            const { submitWithdrawalRequestAction } =
                await import('@/app/actions/cooperative/_withdrawal');

            const res: any = await submitWithdrawalRequestAction({
                amount: 50_000,
                accountNumber: '0123456789',
                accountName: 'A Member',
                bankName: 'Test Bank',
                reason: 'School fees',
                cooperativeId: 'coop-ATTACKER',
            } as any);
            expect(res.success).toBe(true);

            const rows = store.all(COLLECTIONS.COOPERATIVE_WITHDRAWALS).map(([, doc]) => doc as any);
            expect(rows).toHaveLength(1);
            expect(rows[0].cooperativeId).toBe('coop-1');
        });
    });

    describe('_withdrawal.ts submitWithdrawalRequestAction', () => {
        async function request(membershipStatus: string) {
            await withMember(membershipStatus);
            const { submitWithdrawalRequestAction } = await import('@/app/actions/cooperative/_withdrawal');

            return (submitWithdrawalRequestAction as any)({
                amount: 50_000,
                bankName: 'Test Bank',
                accountNumber: '0123456789',
                accountName: 'A Member',
                reason: 'School fees',
            });
        }

        it('REFUSES A PENDING MEMBER, AND SAYS WHY', async () => {
            const res = await request('pending');

            // Asserting the MESSAGE, not just failure: this door throws
            // "You are not a member of any cooperative" for a missing row and
            // the debit refuses for other reasons, so a bare `success: false`
            // would pass for the wrong reason — the trap the first version of
            // the platform.ts block fell into.
            expect(res.success).toBe(false);
            expect(String(res.error)).toBe(REFUSAL);
        });

        it('and refuses a suspended one', async () => {
            expect(String((await request('suspended')).error)).toBe(REFUSAL);
        });

        it('and still admits an active member', async () => {
            // Vacuity guard. The CAS primitives are stubbed above, so reaching
            // past the guard is what this proves — not that the debit works.
            expect(String((await request('active')).error ?? '')).not.toBe(REFUSAL);
        });

        it('and a legacy "approved" one', async () => {
            expect(String((await request('approved')).error ?? '')).not.toBe(REFUSAL);
        });
    });

    describe('_loans_repayments.ts repayLoanFromSavingsAction', () => {
        async function repay(membershipStatus: string) {
            await withMember(membershipStatus);
            const { repayLoanFromSavingsAction } = await import('@/app/actions/cooperative/_loans_repayments');

            return (repayLoanFromSavingsAction as any)({
                userId: 'member-2',
                loanId: 'loan-1',
                installmentId: 'inst-1',
                amount: 10_000,
            });
        }

        it('REFUSES A PENDING MEMBER SPENDING SAVINGS ON A LOAN', async () => {
            const res = await repay('pending');

            expect(res.success).toBe(false);
            expect(String(res.error)).toBe(REFUSAL);
        });

        it('and still admits an active member, and a legacy "approved" one', async () => {
            expect(String((await repay('active')).error ?? '')).not.toBe(REFUSAL);
            expect(String((await repay('approved')).error ?? '')).not.toBe(REFUSAL);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#276 — the registration door the ratchet found, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    /**
     * The source ratchet proves the comparison is gone. It cannot prove the
     * CONSEQUENCE is gone, and the consequence is the whole finding: a legacy
     * member falling past that branch was written back to "pending" by the
     * `set(..., { merge: true })` under it and then sent to Paystack.
     *
     * So this executes the door and asserts on the STORED ROW, not on the
     * return value. Paystack is left unmocked deliberately — a member who
     * reaches it has already been demoted, and the assertions below fail on the
     * row before the call's outcome matters either way.
     */
    async function initiate(membershipStatus: string) {
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'legacy-1', email: 'legacy@e.test', roles: ['cooperative_member'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        // No paymentStatus: the legacy shape. A row carrying "completed" would
        // be caught by the branch below the one this is about, which is why the
        // defect was invisible for the members whose rows happened to have it.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-1', {
            userId: 'legacy-1',
            cooperativeId: 'coop-1',
            membershipStatus,
            savingsBalance: 500_000,
        });

        const { initiateCooperativePaymentAction } = await import('@/app/actions/cooperative/_coop_money');
        const res = await (initiateCooperativePaymentAction as any)('Member').catch((e: unknown) => ({
            success: false, error: String(e),
        }));

        return { res, row: store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-1') as any };
    }

    it('DOES NOT DEMOTE A LEGACY "approved" MEMBER BACK TO PENDING', async () => {
        const { row } = await initiate('approved');

        // The cost of the old comparison, stated as the row it left behind.
        expect(row.membershipStatus).toBe('approved');
    });

    it('and tells them they are already a member instead of charging them again', async () => {
        const { res } = await initiate('approved');

        expect(res.success).toBe(true);
        expect(String(res.data?.message)).toMatch(/already/i);
        expect(res.data?.paymentUrl).toBeNull();
    });

    it('an "active" member is still recognised, exactly as before', async () => {
        // Vacuity guard: this is the case that always worked, and it has to
        // keep working — the fix widens the branch, it does not move it.
        const { res, row } = await initiate('active');

        expect(row.membershipStatus).toBe('active');
        expect(res.success).toBe(true);
        expect(res.data?.paymentUrl).toBeNull();
    });

    it('AND A GENUINELY NEW MEMBER IS STILL SENT TO PAY', async () => {
        // The other vacuity guard, and the more important one: a branch that
        // admitted everybody would stop the cooperative collecting any
        // registration fee at all. "pending" must NOT short-circuit.
        const { res } = await initiate('pending');

        // Paystack is unmocked, so the call fails at the network — which is
        // itself the proof that the door did not short-circuit. What must not
        // happen is the "already a member" success above.
        expect(res.data?.paymentUrl ?? null).toBeNull();
        expect(String(res.data?.message ?? '')).not.toMatch(/already/i);
    });
});
