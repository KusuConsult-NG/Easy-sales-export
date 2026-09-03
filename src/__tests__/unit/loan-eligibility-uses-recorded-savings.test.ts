/**
 * @jest-environment node
 */

/**
 *   #345 SECURITY: THE SAVINGS A LOAN WAS ASSESSED AGAINST CAME FROM THE
 *        BROWSER, AND THE MEMBER WAS NEVER LOOKED UP AT ALL.
 *
 *        submitLoanApplicationAction is a "use server" export. Its form
 *        carried `contributionAmount`, and that figure — nothing else — was
 *        the input to every rule that decides how much a member may borrow:
 *
 *            const actualTier   = calculateUserTier(formData.contributionAmount);
 *            const maxLoanAmount = formData.contributionAmount * tierInfo.maxLoanMultiplier;
 *            const eligibility  = isEligibleForLoan(formData.contributionAmount, ...);
 *
 *        A server action's arguments are a request body. So a member with ₦0
 *        saved — or somebody who had never joined a cooperative — could post
 *        `contributionAmount: 50_000_000` and clear all three: the ₦5,000
 *        minimum, the 0.5× cap and the eligibility check. A pending
 *        application for ₦25m was filed against nothing.
 *
 *        The action then WROTE that number back as `contributionAmount` on the
 *        application, so the admin queue an approver works from showed the
 *        applicant's own claim in the column that says how much security
 *        stands behind the loan.
 *
 *        Approval is a separate, claimed admin operation, so no money moved on
 *        its own — this is the queue being fillable with applications the rules
 *        forbid, and an approver being shown a figure the applicant chose.
 *
 *        WHAT MAKES THIS THE SIBLING-DOORS SHAPE AGAIN (#339, #83, #38)
 *        --------------------------------------------------------------
 *        There are THREE doors into a cooperative loan, and all three differed:
 *
 *          _loans_applications.ts   savings from the FORM, no membership read
 *          api/cooperative/apply-loan   savings from the row — found by DOC ID
 *          _coop_money.ts               savings from the row — found by the
 *                                       `userId` FIELD
 *
 *        Only the first is a security hole. The other two are a correctness
 *        hole in the opposite direction: COOPERATIVE_MEMBERS holds BOTH row
 *        shapes — most writers key by the user id, joinCooperativeAction uses
 *        an auto-generated id with `userId` as a field, and
 *        getCooperativeApplicationAction contains a self-heal for rows that
 *        have the id and not the field, which is proof both exist. So each
 *        door refused a set of genuine members the others admitted, telling
 *        them to join a cooperative they already belong to.
 *
 *        All three now call findCooperativeMemberRow (both lookups, cheapest
 *        first) and readCooperativeBalance (both field names, per #-balance).
 *
 *        AND THE SUITE COULD NOT SEE ANY OF IT. Every submission test in
 *        coop-loan-applications-behaviour.test.ts passed WITHOUT SEEDING A
 *        MEMBERSHIP ROW — nine of them broke the moment the action started
 *        looking one up. A test that files a loan for a non-member and calls it
 *        success is the #335 trap: a fixture no writer produces.
 *
 *        THE INTEREST RATE ON THE REVIEW SCREEN WAS A DIFFERENT NUMBER.
 *        LoanApplicationWizard's confirmation panel printed a hardcoded
 *        "2.0%" between two figures computed from getTierInterestRate(tier),
 *        which returns DEFAULT_MONTHLY_INTEREST_RATE = 10 — ten percent per
 *        MONTH, which is also what the server records on the application. The
 *        applicant confirmed a monthly rate five times lower than the one they
 *        were being lent at, on the last screen before submitting.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const MEMBER = 'member-1';
const SAVINGS = 100_000;

let store: FakeDbHandle;

function actAs(id: string): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['user'], email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

async function submit() {
    return (await import('@/app/actions/cooperative/_loans_applications'))
        .submitLoanApplicationAction;
}

function form(overrides: Record<string, unknown> = {}) {
    return {
        userId: MEMBER,
        userEmail: 'member@example.com',
        fullName: 'Ada Obi',
        amount: 40_000,
        purpose: 'Stock for the shop',
        durationMonths: 6,
        contributionAmount: SAVINGS,
        tier: 'Member' as const,
        guarantorName: 'Chidi Eze',
        guarantorPhone: '08031111111',
        ...overrides,
    };
}

function filed(): Record<string, unknown>[] {
    return store.all(COLLECTIONS.LOAN_APPLICATIONS).map(([, d]) => d);
}

/** A membership row keyed the way most writers key it. */
function seedMember(data: Record<string, unknown> = {}) {
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
        userId: MEMBER, savingsBalance: SAVINGS, membershipStatus: 'active', ...data,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#345 — the loan is assessed against the savings the cooperative holds', () => {
    it('A CLAIMED CONTRIBUTION BUYS NOTHING — the ceiling comes off the member row', async () => {
        // THE test. ₦10,000 saved, ₦5,000,000 claimed, ₦1,000,000 requested.
        // Before the fix all three rules read the claim and this was filed.
        seedMember({ savingsBalance: 10_000 });

        const result = await (await submit())(
            form({ contributionAmount: 5_000_000, amount: 1_000_000 }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/exceeds your limit/i);
        expect(filed()).toHaveLength(0);
    });

    it('and the ceiling really is half the RECORDED savings, either side of the line', async () => {
        // Vacuity guard on the test above: it must be the savings that moved
        // the ceiling, not the request simply being large.
        const { COOPERATIVE_TIERS } = await import('@/lib/cooperative-tiers');
        seedMember({ savingsBalance: 200_000 });
        const ceiling = 200_000 * COOPERATIVE_TIERS.Member.maxLoanMultiplier;

        const submitLoan = await submit();

        expect((await submitLoan(form({ contributionAmount: 1, amount: ceiling + 1 }))).success)
            .toBe(false);
        expect((await submitLoan(form({ contributionAmount: 1, amount: ceiling }))).success)
            .toBe(true);
        expect(filed()).toHaveLength(1);
    });

    it('the minimum-contribution floor runs on the recorded figure too', async () => {
        // ₦4,000 saved. ₦2,000 is within the 0.5× cap, so the cap passes and
        // isEligibleForLoan's ₦5,000 floor is what must refuse this. Reading
        // the claim, both passed.
        seedMember({ savingsBalance: 4_000 });

        const result = await (await submit())(
            form({ contributionAmount: 500_000, amount: 2_000 }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/minimum contribution/i);
        expect(filed()).toHaveLength(0);
    });

    it('SOMEBODY WHO IS NOT A MEMBER AT ALL IS REFUSED', async () => {
        // No membership row. This used to file, because the action never
        // looked. Every submission test in the sibling suite was this shape.
        const result = await (await submit())(form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be a cooperative member/i);
        expect(filed()).toHaveLength(0);
    });

    it('and the record carries the savings the rules ran on, with the claim beside it', async () => {
        // The admin queue reads `contributionAmount` as the security behind
        // the loan. It must be the cooperative's figure. The applicant's is
        // kept — not discarded — so a mismatch is visible on the record.
        seedMember({ savingsBalance: 80_000 });

        const result = await (await submit())(
            form({ contributionAmount: 9_999_999, amount: 40_000 }));

        expect(result.success).toBe(true);
        const [app] = filed();
        expect(app.contributionAmount).toBe(80_000);
        expect(app.claimedContributionAmount).toBe(9_999_999);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#345 — and the member is found however their row is keyed', () => {
    it('A ROW WITH AN AUTO-GENERATED ID IS FOUND BY ITS userId FIELD', async () => {
        // joinCooperativeAction writes exactly this: `membershipsRef.doc()`.
        // A doc-id read misses it, and the miss reads as "not a member".
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'auto-generated-abc123', {
            userId: MEMBER, savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        const result = await (await submit())(form({ amount: 40_000 }));

        expect(result.success).toBe(true);
        expect(filed()).toHaveLength(1);
    });

    it('and a row keyed by the user id with NO userId field is found too', async () => {
        // The other half. getCooperativeApplicationAction heals exactly this
        // shape on the fly, which is how we know such rows exist.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            savingsBalance: SAVINGS, membershipStatus: 'active',
        });

        expect((await (await submit())(form({ amount: 40_000 }))).success).toBe(true);
    });

    it('while ANOTHER member’s row does not stand in for a missing one', async () => {
        // The lookup's fallback is a query. A query that filtered on nothing
        // would return the first row in the collection and admit anybody.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'somebody-else', {
            userId: 'somebody-else', savingsBalance: 5_000_000, membershipStatus: 'active',
        });

        const result = await (await submit())(form());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/must be a cooperative member/i);
        expect(filed()).toHaveLength(0);
    });

    it('and savings held under the LEGACY `balance` field still count', async () => {
        // lib/cooperative-member-balance.ts: nested legacy member documents key
        // the same money `balance`. Reading `savingsBalance` alone scored such
        // a member at zero and refused every loan they were entitled to.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER, balance: 100_000, membershipStatus: 'active',
        });

        const result = await (await submit())(form({ amount: 40_000 }));

        expect(result.success).toBe(true);
        expect(filed()[0].contributionAmount).toBe(100_000);
    });

    it('a non-numeric balance reads as zero rather than NaN', async () => {
        // NaN passes no comparison, so it fails closed here — but it would be
        // written onto the application as NaN. readCooperativeBalance floors it.
        seedMember({ savingsBalance: 'lots' });

        const result = await (await submit())(form({ amount: 40_000 }));

        expect(result.success).toBe(false);
        expect(filed()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#345 — the ratchet: no loan door takes its savings from the caller', () => {
    const DOORS = [
        'src/app/actions/cooperative/_loans_applications.ts',
        'src/app/actions/cooperative/_coop_money.ts',
        'src/app/api/cooperative/apply-loan/route.ts',
    ];

    it.each(DOORS)('%s feeds isEligibleForLoan a figure read from the database', (file) => {
        const code = source(file);

        // The call exists, and its first argument is the resolved balance —
        // never a field off the request.
        expect(code).toMatch(/isEligibleForLoan\(\s*(savingsBalance|totalSavings)\s*,/);
        expect(code).not.toMatch(/isEligibleForLoan\(\s*(formData|body|data|parsed)\./);
    });

    it.each(DOORS)('%s resolves the member through the shared lookup', (file) => {
        const code = source(file);

        expect(code).toContain('findCooperativeMemberRow(');
        expect(code).toContain('readCooperativeBalance(');
    });

    it('and the submitting action no longer computes anything from the claimed figure', () => {
        const code = source('src/app/actions/cooperative/_loans_applications.ts');

        expect(code).not.toContain('calculateUserTier(formData.contributionAmount)');
        expect(code).not.toContain('formData.contributionAmount * tierInfo.maxLoanMultiplier');
        // It is still recorded — under a name that says whose figure it is.
        expect(code).toContain('claimedContributionAmount: formData.contributionAmount');
    });

    it('the shared lookup does NOT adopt a membership on an email match', () => {
        // Matching a membership on a free-text email is a CLAIM — #36. A
        // balance read must not perform one, or the fix to one hole opens
        // another.
        const lookup = source('src/lib/cooperative-member-lookup.ts');

        expect(lookup).not.toContain('email');
        expect(lookup).toContain('.doc(userId)');
        expect(lookup).toContain('where("userId", "==", userId)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#345 — the review screen shows the rate the loan is written at', () => {
    it('THE HARDCODED 2.0% IS GONE', async () => {
        const wizard = source('src/components/LoanApplicationWizard.tsx');

        expect(wizard).not.toContain('2.0%');
        expect(wizard).toContain('{getTierInterestRate(tier)}%');
    });

    it('and the rate it now renders is the one the server records', async () => {
        // Both sides of the claim, measured rather than asserted: the screen
        // calls getTierInterestRate, and so does the action that writes the
        // application. A change to one reaches both.
        const { getTierInterestRate, DEFAULT_MONTHLY_INTEREST_RATE } =
            await import('@/lib/cooperative-tiers');
        expect(getTierInterestRate('Member')).toBe(DEFAULT_MONTHLY_INTEREST_RATE);
        expect(DEFAULT_MONTHLY_INTEREST_RATE).not.toBe(2);

        seedMember();
        await (await submit())(form({ amount: 40_000 }));

        expect(filed()[0].interestRate).toBe(getTierInterestRate('Member'));
    });
});
