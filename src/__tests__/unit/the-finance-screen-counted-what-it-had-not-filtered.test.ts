/**
 * @jest-environment node
 */

/**
 *   #516 THE FINANCE SCREEN COUNTED PAYMENTS IT HAD NOT FILTERED, AND READ THE
 *        WHOLE TABLE TO DO IT.
 *
 *   src/services/ is a directory this audit had never opened. Re-deriving what
 *   is genuinely unexamined — 998 source files, 203 with real logic that NO test
 *   imports — put analytics.service.ts at the top by a wide margin: 54KB, and it
 *   is what the admin dashboard and the finance screen are made of. The numbers
 *   the owner uses to understand the business had no test behind them.
 *
 * ── THE LIST WAS NOT FILTERED TO THE THING IT WAS LABELLED ──────────────────
 *
 *   getFinancialOverview built `recentTransactions` from
 *
 *       db.collection(PROCESSED_PAYMENTS).orderBy("processedAt","desc").get()
 *
 *   — no status filter, and NO LIMIT. admin/finance/page.tsx puts that array
 *   straight into React state and renders it under the tab labelled SUCCESSFUL.
 *   So a pending or failed row appeared to an admin as a successful payment.
 *
 *   Every other read of PROCESSED_PAYMENTS in this file is bounded. This one
 *   loaded the collection, mapped it, and sorted it in memory — and #465 already
 *   measured what that costs on a grown collection here: `canceling statement
 *   due to statement timeout`.
 *
 * ── AND THEN THE LIST REDEFINED THE COUNT ───────────────────────────────────
 *
 *       if (recentTransactions.length > totalSuccessfulCount) {
 *           totalSuccessfulCount = recentTransactions.length;
 *       }
 *
 *   `totalSuccessfulCount` is taken from Paystack and cross-checked against a
 *   COUNT(*) of completed rows. This overwrote it with the length of the
 *   unfiltered list whenever that was longer — so "Successful payments", the
 *   number on the dashboard card, quietly became "rows in processed_payments
 *   with a positive amount, of any status".
 *
 *   That matters here specifically. This platform's processed_payments table
 *   holds twelve rows whose references match no generator in this codebase and
 *   which arrived by import rather than through Paystack. A count that grows to
 *   include whatever is in the table is exactly the wrong instrument for
 *   noticing that.
 *
 * ── A FAILED READ WAS RENDERED AS ZERO NAIRA ────────────────────────────────
 *
 *   Four aggregates are read through Promise.allSettled and every rejection
 *   became `0`: escrow volume, loans disbursed, pending payouts, and the failed
 *   -payments list, whose catch said `// Silently skip`. A timed-out query
 *   reached the admin as ₦0 with the same confidence as a measured figure.
 *
 *   THE RULE WAS ALREADY STATED TWICE IN THIS FILE. getPlatformHealthMetrics
 *   returns `revenueAvailable` with the note "Returning 0 here is what made an
 *   outage indistinguishable from a day with no sales — the figure was rendered
 *   with the same confidence as a real one", and getDashboardStats carries the
 *   same flag. getFinancialOverview is the third method in the same class, and
 *   it did not follow the rule its siblings state.
 *
 *   `unavailable: string[]` generalises it — one boolean per number does not
 *   scale to four — and is the same shape #514 gave the public seller endpoint,
 *   so the platform has one way of saying "unknown" rather than two. The finance
 *   page shows a banner naming them, because the person reading the number is
 *   the person who needs to know it is not one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the status filter removed from the list         KILLED
 *     the bound removed from the list                 KILLED
 *     the count redefined from the list again         KILLED
 *     a failed aggregate reported as a real zero      KILLED
 *     the silent skip restored on failed payments     KILLED
 *     reword this header                              SURVIVED, as intended
 *
 *   THE COUNT-REDEFINITION MUTANT SURVIVED THE FIRST RUN, and the survival was
 *   correct: once the list is filtered to completed and bounded, it is a subset
 *   of what the COUNT counts, so `list.length > count` can never fire and
 *   deleting the line changes nothing. Chasing that told me where it DOES fire —
 *   when the COUNT itself fails and there is no Paystack key, `count` stays 0
 *   and the page size becomes the platform's lifetime total. That path is now
 *   named in `unavailable` and covered, and the mutant dies. The line was worth
 *   removing; it was not worth claiming a kill I had not got.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;
const ESCROW = COLLECTIONS.ESCROW_TRANSACTIONS;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    // No Paystack key: the service falls back to the database, which is the
    // path this finding is about and the only one a test can exercise honestly.
    delete process.env.PAYSTACK_SECRET_KEY;
});

function seedPayment(id: string, over: Record<string, unknown> = {}): void {
    store.seed(PAYMENTS, id, {
        amount: 10_000,
        status: 'completed',
        reference: `PAY-${id}`,
        processedAt: new Date(Date.now() - Number(id.replace(/\D/g, '') || 0) * 1000).toISOString(),
        ...over,
    });
}

const overview = async () => {
    const { AnalyticsService } = await import('@/services/analytics.service');
    return (await new AnalyticsService().getFinancialOverview()) as any;
};

/** Make one collection's reads throw, leaving every other read working. */
function breakCollection(name: string): void {
    const g = globalThis as any;
    const real = g.mockFirestoreGet.getMockImplementation();
    g.mockFirestoreGet.mockImplementation((...args: any[]) => {
        if (g.__firestoreAccess?.collection === name) {
            return Promise.reject(new Error('canceling statement due to statement timeout'));
        }
        return real(...args);
    });
}

const code = () => stripComments(
    readFileSync('src/services/analytics.service.ts', 'utf-8'),
    { label: 'analytics.service.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#516 — the successful tab lists successful payments', () => {
    it('A PENDING PAYMENT IS NOT LISTED AS A SUCCESSFUL ONE', async () => {
        //   THE test. The query had no status filter and the screen renders the
        //   result under the tab labelled SUCCESSFUL.
        seedPayment('p1', { status: 'completed' });
        seedPayment('p2', { status: 'pending' });

        const res = await overview();

        expect(res.recentTransactions.map((t: any) => t.id)).toEqual(['p1']);
    });

    it('AND NEITHER IS A FAILED ONE', async () => {
        seedPayment('p1', { status: 'completed' });
        seedPayment('p2', { status: 'failed' });

        expect((await overview()).recentTransactions.map((t: any) => t.id)).toEqual(['p1']);
    });

    it('AND THE COUNT IS NOT REDEFINED BY THE LIST', async () => {
        //   `if (recentTransactions.length > totalSuccessfulCount)` overwrote a
        //   COUNT(*) of completed rows with the length of the unfiltered list.
        //   Two completed rows and three non-completed ones: the old form
        //   reported 5, the count says 2.
        seedPayment('p1');
        seedPayment('p2');
        seedPayment('p3', { status: 'pending' });
        seedPayment('p4', { status: 'abandoned' });
        seedPayment('p5', { status: 'failed' });

        expect((await overview()).totalSuccessfulCount).toBe(2);
    });

    it('AND A FAILED COUNT IS NOT REPLACED BY THE PAGE SIZE', async () => {
        //   The case the removed fallback papered over, and the one that makes
        //   removing it load-bearing: with the count query failing and no
        //   Paystack key, `totalSuccessfulCount` stayed 0 and the old
        //   `if (list.length > count) count = list.length` reported the size of
        //   one page as the platform's lifetime total.
        //
        //   Only the COUNT is broken, not the collection — the list read must
        //   still work, or this would prove nothing.
        seedPayment('p1');
        seedPayment('p2');
        const g = globalThis as any;
        const real = g.mockFirestoreGet.getMockImplementation();
        g.mockFirestoreGet.mockImplementation((...args: any[]) => {
            const d = g.__firestoreAccess;
            if (d?.kind === 'count' && d?.collection === PAYMENTS) {
                return Promise.reject(new Error('canceling statement due to statement timeout'));
            }
            return real(...args);
        });

        const res = await overview();

        expect(res.recentTransactions).toHaveLength(2);
        expect(res.totalSuccessfulCount).toBe(0);
        expect(res.unavailable).toContain('totalSuccessfulCount');
    });

    it('and the list is bounded', () => {
        //   Behavioural coverage of a 200-row bound means seeding 201 payments
        //   on every run. The rule is pinned instead and the reason stated: an
        //   unbounded read of the collection every payment lands in is what #465
        //   measured timing out.
        expect(code()).toContain('.limit(RECENT_TRANSACTION_LIMIT)');
        expect(code()).toMatch(/const RECENT_TRANSACTION_LIMIT = 200/);
    });

    it('and it still returns the payments that exist', async () => {
        //   The vacuity guard: filtering to nothing would satisfy every
        //   assertion above.
        seedPayment('p1', { amount: 25_000 });

        const res = await overview();
        expect(res.recentTransactions).toHaveLength(1);
        expect(res.recentTransactions[0]).toMatchObject({ id: 'p1', amount: 25_000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#516 — a failed read is not zero naira', () => {
    it('A TIMED-OUT ESCROW AGGREGATE IS NAMED, NOT REPORTED AS ₦0', async () => {
        //   THE test for the other half. `fulfilled ? total : 0` rendered an
        //   outage as a quiet day, on the screen where money is reconciled.
        seedPayment('p1');
        breakCollection(ESCROW);

        const res = await overview();

        expect(res.unavailable).toContain('totalEscrowVolume');
    });

    it('AND A WORKING READ IS NOT NAMED', async () => {
        //   The control. A fix that always reported everything unavailable would
        //   satisfy the assertion above and tell an admin nothing.
        seedPayment('p1');
        store.seed(ESCROW, 'e1', { amount: 50_000, status: 'released' });

        const res = await overview();

        expect(res.unavailable).toEqual([]);
        expect(res.totalEscrowVolume).toBe(50_000);
    });

    it('and the failed-payments read no longer skips silently', () => {
        //   The catch said `// Silently skip`, so a throw rendered the failed and
        //   abandoned tabs as empty — "no failed payments".
        expect(code()).not.toContain('Silently skip');
        expect(code()).toContain('unavailable.push("failedTransactions")');
    });

    it('and every rejection path names itself rather than logging only', () => {
        const body = code();
        for (const name of [
            'totalEscrowVolume', 'totalLoansDisbursed',
            'pendingPayoutAmount', 'recentTransactions', 'failedTransactions',
        ]) {
            expect(body).toContain(`unavailable.push("${name}")`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#516 — the screen shows the distinction', () => {
    const page = () => stripComments(
        readFileSync('src/app/admin/finance/page.tsx', 'utf-8'),
        { label: 'admin/finance/page.tsx' },
    );

    it('IT NAMES THE FIGURES IT COULD NOT READ', () => {
        //   Pinned on source, and the reason stated: this is a client component
        //   whose data arrives from a server action, so rendering it here would
        //   assert on the mock rather than the page. The behaviour is asserted
        //   on the service above; this pins that the page reads the distinction
        //   the service now draws, which is the half a change could drop.
        const src = page();

        expect(src).toContain('res.unavailable');
        expect(src).toMatch(/could not be read/);
        expect(src).toMatch(/not because there was no activity/);
    });

    it('AND SAYS THE LIST IS A PAGE, NOT THE TOTAL', () => {
        //   The count and the list are different sizes now, deliberately. A
        //   screen showing 200 rows beside "1,482 confirmed payments" must not
        //   read as a contradiction.
        expect(page()).toMatch(/showing the \$\{transactions\.length\} most recent/);
    });
});
