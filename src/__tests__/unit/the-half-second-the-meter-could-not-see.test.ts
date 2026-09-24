/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the marketplace stats one next."
 *
 *       [slow-action] getMarketplaceStatsAction took 554ms — 0 reads 0ms
 *                     (slowest 0ms), 554ms unmeasured
 *
 *   Four times in one log — 554, 496, 504, 488ms — always about half a second,
 *   and EVERY MILLISECOND OF IT UNMEASURED. The action makes two count
 *   queries and the meter saw neither.
 *
 * ── A HOLE THE SIZE OF THE ADMIN DASHBOARD ──────────────────────────────────
 *
 *   #281 wrapped `SupabaseDocumentReference.get` and `SupabaseQuery.get` so
 *   every read lands in the tally. `count()` and `aggregate()` return their
 *   OWN inline objects with their own `get`, and those wrappers never touched
 *   them. So:
 *
 *       138 `.count()` call sites and 10 `.aggregate()` sites went unseen
 *
 *   analytics.service.ts — the whole admin dashboard — is built almost
 *   entirely out of them, so its timings reported 0 reads too. This is the
 *   same failure as #285's: an action that could not be seen reads as an
 *   action that is fine, and means nobody looked.
 *
 *   THE REPORT IS THE DEFECT, NOT THE LATENCY. Two counts against products and
 *   users are not obviously wrong; a meter that says they cost nothing is.
 *   Until the line says what those 554ms are, there is nothing to fix and no
 *   way to tell whether fixing it worked.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   This does not make the action faster. It makes the action MEASURABLE, and
 *   the next log will say whether those counts are two slow round trips or one
 *   slow one — which is the question the old line could not even pose.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/*
 *   THE REAL ADAPTER, over a stubbed PostgREST client. fake-db replaces
 *   supabase-db wholesale, so a test built on it would never execute the
 *   `count()` under repair — it would assert against a stand-in and pass
 *   whatever this file does.
 */
const calls: string[] = [];

jest.mock('@/lib/supabase', () => {
    const thenable = (rows: any[], count: number) => {
        const q: any = {
            eq: () => q,
            in: () => q,
            gte: () => q, lte: () => q, gt: () => q, lt: () => q,
            order: () => q,
            range: (from: number) => Promise.resolve({ data: from === 0 ? rows : [], error: null, count }),
            then: (resolve: any) => resolve({ data: rows, error: null, count, status: 200 }),
        };
        return q;
    };
    return {
        supabaseAdmin: {
            from: (table: string) => ({
                select: (_projection: string, opts?: any) => {
                    calls.push(opts?.head ? `count:${table}` : `select:${table}`);
                    return thenable([{ raw_data: { amount: 5 } }], 7);
                },
            }),
        },
        supabase: {},
    };
});

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const meter = () => import('@/lib/round-trip-meter');
/*
 *   requireActual, because jest.setup.js mocks `@/lib/supabase-db` globally
 *   with a call recorder. A plain import would hand back that stand-in, and
 *   every assertion here would be about the stand-in rather than the adapter
 *   under repair.
 */
const adapter = async () => jest.requireActual('@/lib/supabase-db') as any;

beforeEach(() => {
    jest.resetModules();
    calls.length = 0;
});

describe('the half second the meter could not see', () => {
    it('THE CONTROL — an ordinary query IS counted, which is what #281 fixed', async () => {
        /*
         *   Without this, a broken harness that records nothing would make
         *   every assertion below pass for the wrong reason: "count() is
         *   measured" is only meaningful next to "and so is a plain get()".
         */
        const { newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();
        const { supabaseDb } = await adapter();

        const scope = newRoundTripScope();
        await runInRoundTripScope(scope, async () =>
            supabaseDb.collection('products').where('status', '==', 'active').get());

        expect(scopeTally(scope).reads).toBe(1);
    });

    it('A COUNT QUERY IS COUNTED — it was not, and that was the whole 554ms', async () => {
        const { newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();
        const { supabaseDb } = await adapter();

        const scope = newRoundTripScope();
        await runInRoundTripScope(scope, async () =>
            supabaseDb.collection('products').where('status', '==', 'active').count().get());

        //   It really was a count query, not a select the stub let through.
        //   `products` lives in document_collections — see getTableName.
        expect(calls.some((c) => c.startsWith('count:'))).toBe(true);
        expect(scopeTally(scope).reads).toBe(1);
    });

    it('AND SO IS AN AGGREGATE, for the same reason', async () => {
        const { newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();
        const { supabaseDb } = await adapter();
        const { AggregateField } = jest.requireActual('@/lib/firestore-compat') as any;

        const scope = newRoundTripScope();
        await runInRoundTripScope(scope, async () =>
            (supabaseDb.collection('orders') as any)
                .aggregate({ total: AggregateField.sum('amount') }).get());

        expect(scopeTally(scope).reads).toBe(1);
    });

    it('TWO COUNTS READ AS TWO, which is what the stats action makes', async () => {
        //   getMarketplaceStatsAction's actual shape: two counts in a
        //   Promise.all. The log said 0; it should say 2.
        const { newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();
        const { supabaseDb } = await adapter();

        const scope = newRoundTripScope();
        await runInRoundTripScope(scope, async () => Promise.all([
            supabaseDb.collection('products').where('status', '==', 'active').count().get(),
            supabaseDb.collection('users').where('sellerVerificationStatus', '==', 'approved').count().get(),
        ]));

        expect(scopeTally(scope).reads).toBe(2);
    });

    it('and the ANSWER is handed back untouched — measuring must not change it', async () => {
        /*
         *   The rule every wrapper in this file follows: the value returns
         *   untouched, a throw propagates untouched, and the recorder swallows
         *   its own errors. A meter that could alter a count would be worse
         *   than no meter on a dashboard people make decisions from.
         */
        const { newRoundTripScope, runInRoundTripScope } = await meter();
        const { supabaseDb } = await adapter();

        const scope = newRoundTripScope();
        const snap: any = await runInRoundTripScope(scope, async () =>
            supabaseDb.collection('products').count().get());

        expect(snap.data().count).toBe(7);
    });

    it('and a FAILING count still throws, and is still counted', async () => {
        //   Time spent failing is time the person waited. A wrapper that only
        //   records the happy path hides exactly the slow case worth seeing.
        const { newRoundTripScope, runInRoundTripScope, scopeTally } = await meter();
        jest.doMock('@/lib/supabase', () => ({
            supabaseAdmin: {
                from: () => ({
                    select: () => ({
                        eq: function (this: any) { return this; },
                        then: (resolve: any) => resolve({ data: null, error: { message: 'boom' }, status: 500 }),
                    }),
                }),
            },
            supabase: {},
        }));
        const { supabaseDb } = jest.requireActual('@/lib/supabase-db') as any;

        const scope = newRoundTripScope();
        await runInRoundTripScope(scope, async () => {
            await expect(supabaseDb.collection('products').count().get()).rejects.toThrow();
        });

        expect(scopeTally(scope).reads).toBe(1);
    });
});
