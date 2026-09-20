/**
 * @jest-environment node
 */

/**
 *   THE MONEY SIDE OF ONE PERSON HAVING TWO PROFILES.
 *
 *   The sweep that resolved a member's own records across every profile they
 *   own was left, deliberately, with the money paths last — because this is
 *   where widening a read can be WRONG, and the rule that decides it is not
 *   the one the other eight tranches used.
 *
 *   lib/wallet-lookup.ts states it: money moves at the LIVE id and nowhere
 *   else, so a BALANCE summed across profiles is a figure the person cannot
 *   spend. A LIST or a LIFETIME TOTAL is the opposite — nothing is paid out
 *   of it, and the sum is simply the true number.
 *
 *   So each site here had to be sorted into one of three piles, and this file
 *   holds a test for every pile:
 *
 *       widen        the wallet's own statement and stats, the payment
 *                    history — history, not spendable
 *       relocate     the two webhook fulfilments, which pick the row money
 *                    LANDS on: those go through the module that already
 *                    answers that question, live row first and deterministic
 *       leave        the two FinanceService balance derivations, which have
 *                    no callers at all — widening them would answer the
 *                    spendable-or-historical question in the dark
 *
 *   The academy case is the sharpest, and it is a defect THIS SWEEP CREATED.
 *   An earlier tranche widened academy/_payment.ts and could not see the
 *   webhook half that races it, because the tranche was scoped to
 *   src/app/actions. Two halves of one race with different ideas of which
 *   applications exist is exactly what that file's own comment warns against.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   The ids are a SORT ORDER, and they are load-bearing.
 *
 *   A lookup that reaches across a person's profiles with `limit(1)` and no
 *   ORDER BY takes an arbitrary one of their rows. A fixture cannot reproduce
 *   "arbitrary", so it pins the order and makes the arbitrary choice land on
 *   the WRONG row: the store returns rows sorted by document id, so `a-` sorts
 *   ahead of `b-` and a superseded profile is what such a lookup finds first.
 */
const OLD = 'a-superseded-profile';
const LIVE = 'b-live-profile';
const STRANGER = 'c-another-person';

let store: FakeDbHandle;

function actAs(id: string): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['user'], email: 'member@example.com', name: 'Ada Obi' } },
        error: null,
    }));
}

function seedPeople(): void {
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedPeople();
    actAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the wallet statement is a history, so it spans every profile', () => {
    const txn = (id: string, userId: string, over: Record<string, unknown> = {}) =>
        store.seed(COLLECTIONS.WALLET_TRANSACTIONS, id, {
            walletId: userId, userId, type: 'funding', status: 'completed',
            amount: 10_000, createdAt: new Date('2026-01-01'), ...over,
        });

    const statement = async () => {
        const { getWalletTransactionsAction } = await import('@/app/actions/wallet');
        return (await getWalletTransactionsAction({} as any)) as any;
    };

    it('THE test — a funding made under the OLD profile is in the statement', async () => {
        txn('t-old', OLD);

        const r = await statement();

        expect(r.data.transactions.map((t: any) => t.id)).toContain('t-old');
    });

    it("VACUITY CONTROL: and another person's funding never is", async () => {
        txn('t-x', STRANGER);

        const r = await statement();

        expect(r.data.transactions).toHaveLength(0);
    });

    it('and the lifetime stats count that funding too, so the two agree', async () => {
        //   The export-portfolio lesson: an aggregate counting fewer rows than
        //   the list beside it is a page disagreeing with itself.
        txn('t-old', OLD, { amount: 10_000 });
        txn('t-new', LIVE, { amount: 5_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 5_000, userId: LIVE });

        const { getWalletAction } = await import('@/app/actions/wallet');
        const r = (await getWalletAction()) as any;

        expect(r.data.stats.totalFunded).toBe(15_000);
    });

    it('and a withdrawal pending under the old profile is shown as pending', async () => {
        //   Its money was debited when it was requested, so this is not a
        //   claim about what the person can spend — it is money already gone
        //   and not yet paid out. Hiding it tells them it never happened.
        txn('t-w', OLD, { type: 'withdrawal', status: 'pending', amount: -3_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 0, userId: LIVE });

        const { getWalletAction } = await import('@/app/actions/wallet');
        const r = (await getWalletAction()) as any;

        expect(r.data.stats.pendingWithdrawals).toBe(3_000);
    });

    it('THE LINE THAT IS NOT CROSSED: the BALANCE is still the live row alone', async () => {
        //   The whole reason this tranche was held back. Summing a spendable
        //   balance across profiles shows money that checkout then refuses.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 50_000, userId: OLD });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 2_000, userId: LIVE });
        txn('t-old', OLD);

        const { getWalletAction } = await import('@/app/actions/wallet');
        const r = (await getWalletAction()) as any;

        expect(r.data.balance).toBe(2_000);
        //   ...while the history beside it did widen, so this is not simply a
        //   test of nothing having changed.
        expect(r.data.stats.totalFunded).toBe(10_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the payment history widens, and the gate in front of it does not', () => {
    const pay = (id: string, userId: string) =>
        store.seed(COLLECTIONS.PAYMENTS, id, {
            userId, amount: 5_000, purpose: 'course', status: 'completed',
        });

    const history = async (asked: string) => {
        const { getUserPaymentHistoryAction } = await import('@/app/actions/payments');
        return await getUserPaymentHistoryAction(asked);
    };

    it('THE test — a payment made under the OLD profile is in their history', async () => {
        pay('p-old', OLD);

        expect((await history(LIVE)).map((p: any) => p.id)).toContain('p-old');
    });

    it("VACUITY CONTROL: and another person's payment is not", async () => {
        pay('p-x', STRANGER);

        expect(await history(LIVE)).toHaveLength(0);
    });

    it('THE GATE IS UNCHANGED: a stranger still cannot ask about this person', async () => {
        //   The file's own comment records that this query's `userId` clause
        //   was once the vulnerability rather than the defence, because the id
        //   came from the caller. Widening the query must not soften that.
        pay('p-old', OLD);
        pay('p-live', LIVE);
        actAs(STRANGER);

        expect(await history(LIVE)).toHaveLength(0);
    });

    it('and a stranger cannot reach them through the superseded id either', async () => {
        pay('p-old', OLD);
        actAs(STRANGER);

        expect(await history(OLD)).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('THE DIVERGENCE THIS SWEEP CREATED: the academy webhook and the half it races', () => {
    const ACADEMY_FEE = 45_000;

    async function harness() {
        jest.resetModules();
        jest.doMock('@/lib/wallet-ledger', () => ({
            ...jest.requireActual<any>('@/lib/wallet-ledger'),
            claimPaymentOnce: async () => ({ claimed: true }),
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS: C } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        store.seed(C.USERS, LIVE, { email: 'member@example.com' });
        store.seed(C.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        return C as typeof COLLECTIONS;
    }

    const fulfil = async () => {
        const { processAcademyRegistration } = await import('@/infrastructure/payments/service');
        await processAcademyRegistration('ACAD-REF-1', ACADEMY_FEE, LIVE, 'registration');
    };

    it('THE test — a rejection under the old profile is not CLEARED on the user doc', async () => {
        /*
         *   THE ASSERTION IS THE ABSENT STATUS KEY, and getting to it took a
         *   mutation run. The obvious assertions — no `academy_participant`
         *   role, the application still `rejected` — both pass against the
         *   UNWIDENED handler, because a handler that finds no application
         *   grants no role and edits no application either. They are true of
         *   the defect and of the fix alike, which makes them worth nothing.
         *
         *   What actually separates the two is one line in the user payload:
         *
         *       ...(decidedAgainst ? {} : { status: appDoc ? "approved" : "pending" })
         *
         *   Widened, the handler sees the rejection, `decidedAgainst` is true,
         *   and NO status key is written — the decision stands. Narrow, it
         *   sees nothing, takes the no-application branch and writes
         *   `status: "pending"` onto the user document.
         *
         *   So the narrow read does not merely fail to block the applicant. It
         *   CLEARS THE REJECTION in the one place access control consults
         *   first — the handler's own comment says so: "writing pending would
         *   be its own reversal... Layer 2 of checkModuleAccess reads the user
         *   document first" — while the rejection stays visible on the
         *   application, where an admin would look and see nothing wrong.
         */
        const C = await harness();
        store.seed(C.ACADEMY_APPLICATIONS, 'app-old', {
            userId: OLD, status: 'rejected', submittedAt: new Date('2026-01-01'),
        });

        await fulfil();

        const academy = store.get(C.USERS, LIVE)?.serviceRegistrations?.academy;
        expect(academy).toBeTruthy();                    // the payment IS recorded
        expect(academy.paymentStatus).toBe('completed');
        expect(academy.status).toBeUndefined();          // and the decision stands
    });

    it('and the role and the application are both left as they were', async () => {
        //   True of the unwidened handler too, for its own reason — kept
        //   because these are the consequences a reader cares about, with the
        //   test above carrying the discrimination.
        const C = await harness();
        store.seed(C.ACADEMY_APPLICATIONS, 'app-old', {
            userId: OLD, status: 'rejected', submittedAt: new Date('2026-01-01'),
        });

        await fulfil();

        expect(store.get(C.ACADEMY_APPLICATIONS, 'app-old')?.status).toBe('rejected');
        expect(store.get(C.USERS, LIVE)?.roles ?? []).not.toContain('academy_participant');
    });

    it('VACUITY CONTROL: a PENDING application under the old profile is approved', async () => {
        //   The widening must not turn into a blanket refusal — paying the fee
        //   is what admits a new applicant, and that still has to work when
        //   their application sits under the other profile.
        const C = await harness();
        store.seed(C.ACADEMY_APPLICATIONS, 'app-old', {
            userId: OLD, status: 'pending', submittedAt: new Date('2026-01-01'),
        });

        await fulfil();

        expect(store.get(C.ACADEMY_APPLICATIONS, 'app-old')?.status).toBe('approved');
        expect(store.get(C.USERS, LIVE)?.roles ?? []).toContain('academy_participant');
    });

    it("VACUITY CONTROL: and another person's rejection does not block them", async () => {
        //   Their OWN pending application is seeded beside the stranger's
        //   rejection, so the approval is the variable under test. Without it
        //   the applicant has no application at all, the handler grants no
        //   role for that reason alone, and the assertion would pass whether
        //   or not the stranger's row leaked in — which is what the first
        //   version of this control did.
        const C = await harness();
        store.seed(C.USERS, STRANGER, { email: 'other@example.com' });
        store.seed(C.ACADEMY_APPLICATIONS, 'app-x', {
            userId: STRANGER, status: 'rejected', submittedAt: new Date('2026-06-01'),
        });
        store.seed(C.ACADEMY_APPLICATIONS, 'app-mine', {
            userId: OLD, status: 'pending', submittedAt: new Date('2026-01-01'),
        });

        await fulfil();

        expect(store.get(C.ACADEMY_APPLICATIONS, 'app-mine')?.status).toBe('approved');
        expect(store.get(C.USERS, LIVE)?.roles ?? []).toContain('academy_participant');
        expect(store.get(C.ACADEMY_APPLICATIONS, 'app-x')?.status).toBe('rejected');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ₦10,000 registration lands on the row that already exists', () => {
    async function harness() {
        jest.resetModules();
        jest.doMock('@/lib/wallet-ledger', () => ({
            ...jest.requireActual<any>('@/lib/wallet-ledger'),
            claimPaymentOnce: async () => ({ claimed: true }),
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS: C } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        store.seed(C.USERS, LIVE, { email: 'member@example.com' });
        store.seed(C.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
        store.seed(C.USERS, STRANGER, { email: 'other@example.com' });
        return C as typeof COLLECTIONS;
    }

    const fulfil = async (membershipId?: string) => {
        const { processCooperativeRegistration } = await import('@/infrastructure/payments/service');
        await processCooperativeRegistration('COOP-REF-1', 10_000, LIVE, 'Member', membershipId);
    };

    const memberRows = (C: typeof COLLECTIONS) => store.all(C.COOPERATIVE_MEMBERS);

    it('THE test — a registration row under the OLD profile is the one fulfilled', async () => {
        //   Otherwise a SECOND row is manufactured at doc(liveId) carrying a
        //   payment and nothing else, while their real registration — name,
        //   phone, date of birth, next of kin — stays pending and unpaid for
        //   ever. That is the blank-duplicate defect the lookup module's
        //   header describes in full.
        const C = await harness();
        store.seed(C.COOPERATIVE_MEMBERS, 'auto-generated-id', {
            userId: OLD, fullName: 'Ada Obi', membershipStatus: 'pending',
            registrationFee: 10_000,
        });

        await fulfil();

        expect(memberRows(C)).toHaveLength(1);
        expect(store.get(C.COOPERATIVE_MEMBERS, 'auto-generated-id')?.paymentStatus)
            .toBe('completed');
    });

    it('and a doc-id row under the old profile too, which the field read missed', async () => {
        const C = await harness();
        store.seed(C.COOPERATIVE_MEMBERS, OLD, {
            fullName: 'Ada Obi', membershipStatus: 'pending', registrationFee: 10_000,
        });

        await fulfil();

        expect(memberRows(C)).toHaveLength(1);
        expect(store.get(C.COOPERATIVE_MEMBERS, OLD)?.paymentStatus).toBe('completed');
    });

    it("and metadata naming the payer's own superseded row BEATS a blank live row", async () => {
        /*
         *   THE BLANK ROW HAS TO BE THERE, and a mutation run is what proved
         *   it. With only the metadata row seeded, this test passes against
         *   the `===` comparison too: step 1 refuses the row for carrying the
         *   payer's OLD id, and step 2's walk then finds that very same row by
         *   its `userId` field. Same outcome, nothing demonstrated.
         *
         *   Step 1 only earns its place when step 2 would answer DIFFERENTLY,
         *   which is the situation the resolver's header is written about:
         *   api/cooperatives/register puts the member's whole profile — name,
         *   phone, date of birth, next of kin, registrationFee — on an auto-id
         *   row and hands that id to Paystack, while a blank `doc(userId)` row
         *   may already exist beside it from the verify-payment defect.
         *
         *   Compared with `===`, the payment falls through to the walk, the
         *   walk prefers the live doc-id row, and the ₦10,000 lands on the
         *   BLANK one — "the row an admin opens says active, paid, and blank"
         *   — while the real registration stays pending and unpaid for ever.
         */
        const C = await harness();
        store.seed(C.COOPERATIVE_MEMBERS, 'metadata-row', {
            userId: OLD, fullName: 'Ada Obi', membershipStatus: 'pending',
            registrationFee: 10_000, phone: '08031111111',
        });
        //   The blank duplicate, under the live id, carrying nothing.
        store.seed(C.COOPERATIVE_MEMBERS, LIVE, { userId: LIVE });

        await fulfil('metadata-row');

        expect(store.get(C.COOPERATIVE_MEMBERS, 'metadata-row')?.paymentStatus)
            .toBe('completed');
        expect(store.get(C.COOPERATIVE_MEMBERS, LIVE)?.paymentStatus)
            .not.toBe('completed');
    });

    it('and with no blank row beside it, that same metadata row is still the one', async () => {
        const C = await harness();
        store.seed(C.COOPERATIVE_MEMBERS, 'metadata-row', {
            userId: OLD, fullName: 'Ada Obi', membershipStatus: 'pending',
        });

        await fulfil('metadata-row');

        expect(memberRows(C)).toHaveLength(1);
        expect(store.get(C.COOPERATIVE_MEMBERS, 'metadata-row')?.paymentStatus)
            .toBe('completed');
    });

    it("VACUITY CONTROL: metadata naming ANOTHER person's row is refused", async () => {
        //   `isSamePerson` must widen to the payer's own profiles and no
        //   further: two ids resolving to different live profiles are two
        //   people, and fulfilling there would mark a stranger paid.
        const C = await harness();
        store.seed(C.COOPERATIVE_MEMBERS, 'someone-elses-row', {
            userId: STRANGER, fullName: 'Other Person', membershipStatus: 'pending',
        });

        await fulfil('someone-elses-row');

        expect(store.get(C.COOPERATIVE_MEMBERS, 'someone-elses-row')?.paymentStatus)
            .not.toBe('completed');
    });

    it('VACUITY CONTROL: a payer with no row at all still gets one created', async () => {
        //   Legacy references carry no membershipId and a genuine new member
        //   has nothing to find. The fallback must survive the widening.
        const C = await harness();

        await fulfil();

        expect(store.get(C.COOPERATIVE_MEMBERS, LIVE)?.paymentStatus).toBe('completed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the two balance derivations are left alone, on purpose', () => {
    it('FinanceService still has no caller, which is what makes leaving them right', () => {
        //   The reasoning recorded at the top of finance.service.ts depends on
        //   this being true. If a caller ever appears, the spendable-or-
        //   historical question has to be answered there — and this test is
        //   what tells that person the question exists.
        const { execSync } = require('child_process');
        const hits = execSync(
            "grep -rn 'deriveUserBalance(\\|deriveMarketplaceWalletBalance(' src packages "
            + '--include=*.ts --include=*.tsx || true',
            { encoding: 'utf-8' },
        )
            .split('\n').filter(Boolean)
            .filter((l: string) => !/\(userId: string\)/.test(l))
            .filter((l: string) => !l.includes('__tests__'))
            .filter((l: string) => !l.startsWith('src/services/finance.service.ts:'));

        expect({ callers: hits }).toEqual({ callers: [] });
    });

    it('and the file says why, so the decision is not mistaken for an oversight', () => {
        const { readFileSync } = require('fs');
        const src: string = readFileSync('src/services/finance.service.ts', 'utf-8');

        expect(src).toMatch(/NOT WIDENED ACROSS A PERSON'S PROFILES, AND THAT IS A DECISION/);
        expect(src).toMatch(/wallet-lookup/);
    });
});
