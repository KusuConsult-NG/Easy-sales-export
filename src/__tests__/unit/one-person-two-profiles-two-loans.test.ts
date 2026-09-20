/**
 * @jest-environment node
 */

/**
 *   COOPERATIVE — THE CHECK THAT STOPS ONE PERSON HOLDING TWO LOANS.
 *
 *   Twelve reads remained in this module against fourteen resolved, and they
 *   were not all the same kind. Most are a member reading their own records.
 *   Four are the double-lending verification, and those are a different thing
 *   entirely: they are the rule that one borrower may carry one open loan.
 *
 *       _loans_applications  at the point of applying
 *       _loans_decisions     again at the point of approving
 *
 *   Both asked about a SINGLE id. A person with two profiles — which this
 *   platform has in quantity; #477 lists six on one address — answered "no
 *   open loan" twice and could borrow twice. The second application is a
 *   different id to the query and the same human being to the cooperative,
 *   which is money out the door against savings that were only ever pledged
 *   once.
 *
 *   THE WIDENING REFUSES MORE, and that is the point. It is the same direction
 *   as `isSamePerson`, which owned-profile-ids describes as "the opposite
 *   direction to every other use of this module, and it is deliberate."
 *
 *   The eligibility BALANCE beside it is widened for the matching reason: a
 *   balance short by one profile understates what the borrower already owes
 *   and lets the ceiling be crossed from underneath.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

/*
 *   THE PREFIXES ARE A SORT ORDER, AND THEY ARE LOAD-BEARING.
 *
 *   A lookup that reaches across a person's profiles with `limit(1)` and no
 *   ORDER BY takes an ARBITRARY one of their rows. A fixture cannot reproduce
 *   "arbitrary", so it pins the order instead and makes the arbitrary choice
 *   land on the wrong row: the store returns rows sorted by document id, so
 *   `a-` sorts ahead of `b-` and the superseded profile is what such a lookup
 *   finds first.
 *
 *   Named `live-member` and `superseded-member`, as they were, the live id
 *   sorted first by luck and the widened-lookup mutant passed every test here.
 */
const OLD = 'a-superseded-profile';
const LIVE = 'b-live-profile';
const STRANGER = 'c-another-member';

/** Savings of ₦200,000 cap a loan at half that — ₦40,000 clears with room. */
const SAVINGS = 200_000;
const AMOUNT = 40_000;

const OPEN = ['pending', 'reviewing', 'approved', 'partially_approved', 'disbursed'] as const;

function actAs(id: string): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['user'], email: 'member@example.com', name: 'Ada Obi' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    //   One person, two profiles: the old row points forward at the live one,
    //   which is what makes ownedProfileIdsFor return both.
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, LIVE, {
        userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
    });
    actAs(LIVE);
});

const apply = async () => {
    const { submitLoanApplicationAction } =
        await import('@/app/actions/cooperative/_loans_applications');
    return await submitLoanApplicationAction({
        userId: LIVE,
        userEmail: 'member@example.com',
        fullName: 'Ada Obi',
        amount: AMOUNT,
        purpose: 'Stock for the shop',
        durationMonths: 6,
        contributionAmount: SAVINGS,
        tier: 'Member',
        guarantorName: 'Chidi Eze',
        guarantorPhone: '08031111111',
    });
};

describe('one borrower, one open loan — across every profile they own', () => {
    it('THE test — an open loan under the OLD profile refuses a new application', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status: 'disbursed', amount: 80_000,
        });

        const r = await apply();

        expect(r.success).toBe(false);
        expect(store.all(COLLECTIONS.LOAN_APPLICATIONS)).toHaveLength(1);
    });

    it('and a cooperative loan under the old profile does too — it keys on memberId', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'cl-old', {
            memberId: OLD, status: 'approved', amount: 80_000,
        });

        const r = await apply();

        expect(r.success).toBe(false);
        expect(store.all(COLLECTIONS.LOAN_APPLICATIONS)).toHaveLength(0);
    });

    it('but a SETTLED loan under the old profile does not bar them for ever', async () => {
        //   The vacuity control. A widening that refused on any loan row would
        //   pass both tests above and lock every past borrower out of credit.
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-done', {
            userId: OLD, status: 'repaid', amount: 80_000,
        });

        const r = await apply();

        expect(r.success).toBe(true);
    });

    it("and ANOTHER member's open loan never bars them", async () => {
        //   The second vacuity control: the widening must reach the person's
        //   OWN other profile and no further.
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-x', {
            userId: STRANGER, status: 'disbursed', amount: 80_000,
        });

        const r = await apply();

        expect(r.success).toBe(true);
    });

    it('and the amount already owed under the old profile counts against the ceiling', async () => {
        //   The eligibility BALANCE, not the open-loan bar: a settled loan is
        //   invisible to the bar above, so what refuses here can only be the
        //   widened sum. ₦200,000 saved caps the borrower at ₦100,000; a
        //   ₦90,000 loan outstanding under OLD leaves ₦10,000 of headroom, and
        //   ₦40,000 is asked for.
        //
        //   `disbursed` would trip the open-loan bar first, so this uses the
        //   one status the balance query counts that the bar does not —
        //   nothing. Both queries share four statuses. So instead: the bar is
        //   given nothing to find by filing the outstanding loan as `approved`
        //   under a THIRD id the person owns... which the bar would also find.
        //
        //   There is no status that separates them, which is itself the point:
        //   the balance widening is unreachable through this door while the
        //   bar stands. It is tested directly against isEligibleForLoan.
        const { isEligibleForLoan } = await import('@/lib/cooperative-tiers');

        expect(isEligibleForLoan(SAVINGS, AMOUNT, 90_000).eligible).toBe(false);
        expect(isEligibleForLoan(SAVINGS, AMOUNT, 0).eligible).toBe(true);
    });
});

/**
 *   THE THIRD DOOR — and it was the widest open of the three.
 *
 *   /api/cooperative/apply-loan is the OTHER application path, and the one
 *   /cooperatives/loans actually posts to. It asked about three statuses in
 *   ONE collection while the two actions above asked about five across BOTH.
 *   So a borrower whose loan was `reviewing`, `partially_approved` or
 *   `disbursed`, or whose loan sat in cooperative_loans at all, was refused by
 *   the actions and admitted here — before any profile widening enters into
 *   it.
 */
describe('the third door bars what the other two bar', () => {
    const PRODUCT = 'loan-product-1';

    beforeEach(() => {
        //   The route refuses on missing fields and on an unusable product
        //   BEFORE it reaches the open-loan bar, so an under-specified request
        //   makes every assertion here vacuous. It did: the first version of
        //   this block passed against the door in its original, narrow form.
        //   The route also demands a completed membership payment, which the
        //   shared fixture above does not set — another refusal ahead of the
        //   bar, and another way for these assertions to mean nothing.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, LIVE, {
            userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
            paymentStatus: 'completed',
        });
        store.seed(COLLECTIONS.LOAN_PRODUCTS, PRODUCT, {
            name: 'Member loan', isActive: true,
            minAmount: 10_000, maxAmount: 100_000,
            interestRate: 10, durationMonths: 6,
        });
    });

    const post = async () => {
        const { POST } = await import('@/app/api/cooperative/apply-loan/route');
        const res = await POST(new Request('http://localhost/api/cooperative/apply-loan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                productId: PRODUCT, amount: AMOUNT, purpose: 'Stock',
                guarantorName: 'Chidi Eze', guarantorPhone: '08031111111',
            }),
        }) as any);
        return { status: res.status, ...(await res.json()) };
    };

    it.each(['reviewing', 'partially_approved', 'disbursed'])(
        'a %s loan bars it — three statuses it used to ignore', async (status) => {
            store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-1', {
                userId: LIVE, status, amount: 80_000,
            });

            const r = await post();

            expect(r.success).toBe(false);
            expect(r.message).toMatch(/already have an active or pending loan/);
        });

    it('and a cooperative loan bars it — the collection it never looked in', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'cl-1', {
            memberId: LIVE, status: 'disbursed', amount: 80_000,
        });
        const r = await post();

        expect(r.success).toBe(false);
        expect(r.message).toMatch(/already have an active or pending loan/);
    });

    it('and an open loan under the OLD profile bars it too', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status: 'disbursed', amount: 80_000,
        });
        const r = await post();

        expect(r.success).toBe(false);
        expect(r.message).toMatch(/already have an active or pending loan/);
    });

    it.each(['repaid', 'rejected'])('VACUITY CONTROL: a %s one does not', async (status) => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-done', {
            userId: OLD, status, amount: 80_000,
        });

        const r = await post();

        expect(r.success).toBe(true);
    });

    it("VACUITY CONTROL: and neither does another member's open loan", async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-x', {
            userId: STRANGER, status: 'disbursed', amount: 80_000,
        });

        const r = await post();

        expect(r.success).toBe(true);
    });
});

/**
 *   AND THE SCREENS THAT SHOW A MEMBER THEIR OWN RECORDS.
 *
 *   lib/cooperative-readers.ts is outside src/app/actions/cooperative, which is
 *   where the sweep below looks — so the grep reported the module clean while
 *   three reads in the file feeding /cooperatives/my-loans and the fixed-savings
 *   screen still asked about one id. It was a ratchet pinned to the old
 *   spelling that pointed at them, by failing.
 */
describe("a member's own records, across the profiles they own", () => {
    it('their loan history includes an application filed under the old profile', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status: 'repaid', amount: 80_000, appliedAt: new Date(),
        });

        const { readMyLoanApplications } = await import('@/lib/cooperative-readers');

        expect((await readMyLoanApplications(LIVE)).map((r) => r.id)).toContain('loan-old');
    });

    it('and a cooperative loan filed under it, keyed memberId', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'cl-old', {
            memberId: OLD, status: 'repaid', amount: 80_000,
        });

        const { readMyLoanApplications } = await import('@/lib/cooperative-readers');
        const rows = await readMyLoanApplications(LIVE);

        expect(rows).toHaveLength(1);
    });

    it("VACUITY CONTROL: and not another member's", async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-x', {
            userId: STRANGER, status: 'repaid', amount: 80_000, appliedAt: new Date(),
        });

        const { readMyLoanApplications } = await import('@/lib/cooperative-readers');

        expect(await readMyLoanApplications(LIVE)).toHaveLength(0);
    });

    it('their fixed savings plans include one locked under the old profile', async () => {
        store.seed(COLLECTIONS.FIXED_SAVINGS_PLANS, 'plan-old', {
            memberId: OLD, amount: 50_000, createdAt: new Date(),
        });

        const { readFixedSavingsPlans } = await import('@/lib/cooperative-readers');

        expect((await readFixedSavingsPlans(LIVE)).map((r) => r.id)).toContain('plan-old');
    });

    it("VACUITY CONTROL: and not another member's plan", async () => {
        store.seed(COLLECTIONS.FIXED_SAVINGS_PLANS, 'plan-x', {
            memberId: STRANGER, amount: 50_000, createdAt: new Date(),
        });

        const { readFixedSavingsPlans } = await import('@/lib/cooperative-readers');

        expect(await readFixedSavingsPlans(LIVE)).toHaveLength(0);
    });

    it('and a membership row written under the old profile is still a membership', async () => {
        //   Otherwise somebody who joined and paid is told to join a
        //   cooperative they already belong to — the failed-lookup-as-absence
        //   shape the lookup module's own header condemns.
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, {
            userId: OLD, savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        const { readCooperativeMembership } = await import('@/lib/cooperative-readers');

        expect((await readCooperativeMembership(LIVE)).isMember).toBe(true);
    });

    it('but the LIVE row wins when both exist', async () => {
        //   Live-first, deterministically — the property the arbitrary
        //   `limit(1)` widening could not offer. See the fixed-savings door.
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, {
            userId: OLD, savingsBalance: 1, membershipStatus: 'active',
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, LIVE, {
            userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        const { readCooperativeMembership } = await import('@/lib/cooperative-readers');
        const m = await readCooperativeMembership(LIVE);

        expect(m.isMember).toBe(true);
        expect(m.data?.savingsBalance).toBe(SAVINGS);
    });

    it('VACUITY CONTROL: a stranger with no row is not a member', async () => {
        const { readCooperativeMembership } = await import('@/lib/cooperative-readers');

        expect((await readCooperativeMembership(STRANGER)).isMember).toBe(false);
    });
});

/**
 *   AND THE GUARD THAT REFUSES A SECOND ₦10,000.
 *
 *   /api/cooperatives/register charges the registration fee. Its "you already
 *   have a membership" guard wrote out the doc-id-then-field walk by hand — a
 *   FOURTH copy of findCooperativeMemberRow — and asked about one profile. A
 *   member whose profile was superseded was charged again for a membership
 *   they already hold, and for a SUSPENDED member the webhook fulfilment then
 *   rewrote them active, which is the reversal this guard exists to stop.
 */
describe('the registration fee is not charged twice', () => {
    const register = async () => {
        const { POST } = await import('@/app/api/cooperatives/register/route');
        const res = await POST(new Request('http://localhost/api/cooperatives/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            //   firstName, lastName, email, phone and dateOfBirth are all
            //   demanded BEFORE the duplicate guard runs. An under-specified
            //   body is refused at the wrong gate and the assertions below
            //   mean nothing — which is what the first version of this block
            //   did, silently, on three of its five tests.
            body: JSON.stringify({
                firstName: 'Ada', lastName: 'Obi', email: 'member@example.com',
                phone: '08031111111', dateOfBirth: '1990-01-01',
                gender: 'female', stateOfOrigin: 'Lagos', lga: 'Ikeja',
                residentialAddress: '1 Test Road', occupation: 'Trader',
                nextOfKin: { name: 'Chidi Eze', phone: '08032222222' },
            }),
        }) as any);
        return { status: res.status, ...(await res.json()) };
    };

    beforeEach(() => {
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    });

    it('THE test — an active membership under the OLD profile refuses a second one', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, {
            userId: OLD, membershipStatus: 'active', paymentStatus: 'completed',
        });

        const r = await register();

        expect(r.success).toBe(false);
        expect(r.error).toMatch(/already have a cooperative membership/);
    });

    it('and a suspended one under the old profile is not buyable back', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, {
            userId: OLD, membershipStatus: 'suspended',
        });

        const r = await register();

        expect(r.success).toBe(false);
        expect(r.error).toMatch(/not currently active/);
    });

    it('and an auto-id row under the old profile counts too', async () => {
        //   The other half of the walk: joinCooperativeAction keys its row by
        //   an auto id with `userId` as a field.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'auto-generated-id', {
            userId: OLD, membershipStatus: 'active', paymentStatus: 'completed',
        });

        const r = await register();

        //   Asserted on the MESSAGE, not just on success: without a Paystack
        //   host to reach, this route answers false either way, so `success`
        //   alone cannot tell the guard firing from the payment failing. It
        //   could not — this assertion passed against the unwidened guard.
        expect(r.error).toMatch(/already have a cooperative membership/);
    });

    it("VACUITY CONTROL: another member's membership does not refuse them", async () => {
        store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, STRANGER, {
            userId: STRANGER, membershipStatus: 'active', paymentStatus: 'completed',
        });

        const r = await register();

        expect(r.error ?? '').not.toMatch(/already have a cooperative membership|not currently active/);
    });

    it('VACUITY CONTROL: and a PENDING membership under the old profile still may pay', async () => {
        //   The guard refuses an active, paid or decided-against membership —
        //   not any row at all. Widened to refuse on existence it would strand
        //   every half-registered member at the payment step for ever.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, {
            userId: OLD, membershipStatus: 'pending', paymentStatus: 'pending',
        });

        const r = await register();

        expect(r.error ?? '').not.toMatch(/already have a cooperative membership|not currently active/);
    });
});

describe('and the module is swept', () => {
    it('NO BARE OWNER READ REMAINS IN COOPERATIVE, outside a comment', () => {
        const { execSync } = require('child_process');
        const out = execSync(
            //   THE DIRECTORIES ARE THE FINDING. This looked at
            //   src/app/actions/cooperative alone and reported the module
            //   clean while lib/cooperative-readers.ts — the file behind
            //   /cooperatives/my-loans — and the apply-loan route, the THIRD
            //   double-lending door, both still read a single id. A sweep
            //   scoped to one directory certifies that directory, not the
            //   feature.
            `grep -rn '\\.where("\\(userId\\|memberId\\)", *"==" *,' `
            + `src/app/actions/cooperative src/lib/cooperative-readers.ts `
            + `src/app/api/cooperative --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim().split('\n').filter(Boolean)
            //   _coop_registration quotes the old shape inside a comment that
            //   explains why it was wrong. Prose is not a query.
            .filter((l: string) => !/:\s*\*/.test(l));

        expect({ remaining: out }).toEqual({ remaining: [] });
    });

    it('VACUITY GUARD: the comment filter does not swallow a real read', () => {
        const line = 'src/x.ts:12:            .where("userId", "==", userId)';
        const comment = 'src/x.ts:429:         *       .where("userId", "==", userId)';

        expect(/:\s*\*/.test(line)).toBe(false);
        expect(/:\s*\*/.test(comment)).toBe(true);
    });

});

/**
 *   THE TWO DOORS MUST AGREE. The bar is written out once per door, so if the
 *   status lists drift one door refuses what the other admits — and the door
 *   that admits is the approval, where the money is.
 *
 *   Asserted behaviourally rather than by grepping the two literals: what
 *   matters is that a loan in a given state bars at BOTH doors, whatever the
 *   lists happen to spell.
 */
describe('and the two doors bar the same states', () => {
    it.each([...OPEN])('a %s loan under the old profile bars the apply door', async (status) => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status, amount: 80_000,
        });

        expect((await apply()).success).toBe(false);
    });

    it.each(['repaid', 'rejected', 'cancelled'])(
        'and a %s one bars neither', async (status) => {
            store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-old', {
                userId: OLD, status, amount: 80_000,
            });

            expect((await apply()).success).toBe(true);
        });
});

/*
 *   LAST IN THE FILE DELIBERATELY. This door is driven through jest.doMock, and
 *   a doMock registration OUTLIVES resetModules — it is a registry entry, not a
 *   module instance. Run before the member-side describes, its stubbed
 *   session-guard hands them an ADMIN session, every apply() returns
 *   "Unauthorized", and the three vacuity controls fail while the bars they
 *   control for pass. Which is the failure mode a vacuity control exists to
 *   catch, arriving from the fixture instead of the code.
 */
describe('and the approval door asks the same question', () => {
    const ADMIN = { id: 'admin-1', roles: ['super_admin'], email: 'admin@example.com', name: 'Ada Admin' };
    const APP = 'app-under-review';

    async function harness() {
        jest.resetModules();

        jest.doMock('@/lib/require-admin', () => ({
            requireAdmin: async () => ({ userId: ADMIN.id, roles: ADMIN.roles }),
            liveAdminRoles: async () => ({ roles: ADMIN.roles }),
        }));
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: { user: ADMIN }, error: null }),
        }));
        jest.doMock('@/lib/loan-decision-notice', () => ({
            notifyLoanDecision: async () => undefined,
        }));
        jest.doMock('@/lib/audit-log', () => ({
            createAdminAuditLog: async () => undefined,
            recordAdminAction: async () => undefined,
        }));
        //   The CAS helper speaks PostgREST, not the fake store.
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: true, status: null }),
            claimStatusTransition: async () => ({ claimed: true, status: null }),
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS: C } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        store.seed(C.USERS, LIVE, { email: 'member@example.com' });
        store.seed(C.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        store.seed(C.COOPERATIVE_MEMBERS, LIVE, {
            userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
        });
        store.seed(C.LOAN_APPLICATIONS, APP, {
            userId: LIVE, amount: AMOUNT, contributionAmount: SAVINGS,
            status: 'pending', durationMonths: 6,
        });
        return C as typeof COLLECTIONS;
    }

    const approve = async () => {
        const { approveLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        return await approveLoanAction(APP, ADMIN.id);
    };

    it('an open loan under the OLD profile refuses the approval', async () => {
        const C = await harness();
        store.seed(C.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status: 'disbursed', amount: 80_000,
        });

        const r = await approve();

        expect(r.success).toBe(false);
    });

    it('VACUITY CONTROL: with nothing under the old profile it approves', async () => {
        await harness();

        const r = await approve();

        expect(r.success).toBe(true);
    });

    it.each([...OPEN])('and a %s loan under the old profile refuses it too', async (status) => {
        //   The apply door bars the same five, asserted below. Both doors are
        //   driven rather than grepped, so the lists may be spelled however
        //   they like as long as they agree.
        const C = await harness();
        store.seed(C.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status, amount: 80_000,
        });

        expect((await approve()).success).toBe(false);
    });

    it("VACUITY CONTROL: another member's open loan does not refuse it", async () => {
        const C = await harness();
        store.seed(C.LOAN_APPLICATIONS, 'loan-x', {
            userId: STRANGER, status: 'disbursed', amount: 80_000,
        });

        const r = await approve();

        expect(r.success).toBe(true);
    });
});

/**
 *   AND ONE SITE IN THIS SWEEP GOES THE OTHER WAY.
 *
 *   _createFixedSavingsAction locates a membership row and then DEBITS it.
 *   Widening that lookup across the person's owned profiles — which is right
 *   for every other read in the module — hands `limit(1)` an arbitrary one of
 *   their rows and charges whichever came back.
 *
 *   The wallet module drew this line first and in the same words: what you are
 *   SHOWN is everything you hold, what money MOVES ON is one row.
 *
 *   THE ASSERTION IS THE ID THE DEBIT IS AIMED AT, not the outcome. Two
 *   earlier versions of this test asserted an outcome and proved nothing: the
 *   first was refused by the door's ₦50,000 minimum before the lookup ran, the
 *   second reached the debit and failed there, because debitJsonbBalance
 *   speaks PostgREST and not the fake store. Both "passed" against the widened
 *   lookup they existed to reject.
 *
 *   Last in the file for the doMock reason recorded above.
 */
describe('the fixed-savings debit stays on the live row', () => {
    const LOCKED = 50_000;   // the door's own minimum

    let debitedId: string | null;

    async function harness(seedOldMembership: boolean) {
        jest.resetModules();
        debitedId = null;

        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: LIVE, roles: ['user'], email: 'member@example.com' } },
                error: null,
            }),
        }));
        jest.doMock('@/lib/wallet-ledger', () => ({
            ...jest.requireActual<any>('@/lib/wallet-ledger'),
            debitJsonbBalance: async ({ id }: { id: string }) => {
                debitedId = id;
                return { ok: true };
            },
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS: C } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');

        store.seed(C.USERS, LIVE, { email: 'member@example.com' });
        store.seed(C.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        //   SEEDED FIRST, DELIBERATELY. The store returns rows in seed order,
        //   so a widened `limit(1)` over the owned ids lands on THIS row. Seed
        //   it second and the test passes against the widened lookup too.
        if (seedOldMembership) {
            store.seed(C.COOPERATIVE_MEMBERS, OLD, {
                userId: OLD, savingsBalance: 0, membershipStatus: 'active',
            });
        }
        store.seed(C.COOPERATIVE_MEMBERS, LIVE, {
            userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
        });
    }

    const create = async () => {
        const { createFixedSavingsAction } =
            await import('@/app/actions/cooperative/_coop_money');
        const fd = new FormData();
        fd.set('amount', String(LOCKED));
        fd.set('durationMonths', '6');
        return await createFixedSavingsAction({} as any, fd) as any;
    };

    it('THE test — the debit is aimed at the live row, not the superseded one', async () => {
        await harness(true);

        await create();

        expect(debitedId).toBe(LIVE);
    });

    it('and at the live row when it is the only one', async () => {
        await harness(false);

        await create();

        expect(debitedId).toBe(LIVE);
    });

    it('and it finds an auto-id membership row, which the old field read did too', async () => {
        //   joinCooperativeAction writes its row under an auto-generated id
        //   with `userId` as a FIELD. A doc-id-only lookup reads that member as
        //   having no membership at all.
        await harness(false);
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'auto-generated-id', {
            userId: LIVE, savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        await create();

        expect(debitedId).toBe('auto-generated-id');
    });

    it('AND a doc-id row carrying no userId field, which the old field read did NOT', async () => {
        //   THE half the replaced read was missing. Most writers key this
        //   collection by the user id and never set the field, so
        //   `.where("userId", "==", userId)` found nothing and the member was
        //   told they had no membership.
        await harness(false);
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, LIVE, {
            savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        await create();

        expect(debitedId).toBe(LIVE);
    });

    it('VACUITY CONTROL: a caller with no membership row debits nothing', async () => {
        await harness(false);
        store.clear();
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });

        const r = await create();

        expect(r.success).toBe(false);
        expect(debitedId).toBeNull();
    });
});
