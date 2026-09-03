/**
 * @jest-environment node
 */

/**
 * AN UNORDERED QUERY IS NOT UNORDERED, AND NOTHING CHECKED THAT.
 *
 * supabase-db.ts ends every query build with:
 *
 *     if (this._orderBy.length === 0) {
 *         query = query.order('id');
 *     }
 *
 * Two other things in this repository are built on that one line:
 *
 *   lib/testing/fake-db.ts     sorts an unordered result by id, and says so —
 *                              "BY ID, which is what an unordered query
 *                              actually returns" — quoting the adapter
 *   __tests__/pg/…-postgres    compares the fake against a real cluster, and
 *                              is the thing that certifies the fake the whole
 *                              unit suite runs on
 *
 * Neither exercises the adapter. Deleting those three lines from
 * supabase-db.ts left the entire real-Postgres suite green: the fake goes on
 * sorting by id because it does its own sorting, and the harness goes on
 * asking Postgres for `order by id` because it now spells that out itself.
 * Production would have changed — every `.limit(n)` without an `orderBy` would
 * start returning whatever the heap gave — and nothing would have failed.
 *
 * That is a load-bearing fact with two copies and no original, which is how
 * this codebase's recurring defect starts. This is the original.
 *
 * WHY THE FACT MATTERS
 * --------------------
 * `.limit(n)` with no `.orderBy()` does not mean "the first n written" or "the
 * newest n". It means the n lowest ids. Every dedup check in this codebase
 * that reads `.where(...).limit(1)` resolves that way, and the audit has
 * already found several places where WHICH row comes back decides the answer.
 */

// Imported for their types as much as their values: without a top-level
// import this file is a script rather than a module, and its `const
// supabaseDb` then collides at compile time with the identically named
// binding in supabase-db.test.ts next door. tsc catches that; jest does not.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const CALLS: Array<{ method: string; args: unknown[] }> = [];

jest.mock('@/lib/supabase', () => {
    const record = (method: string) => (...args: unknown[]) => {
        CALLS.push({ method, args });
        return chain;
    };
    const chain: any = {
        select: jest.fn(() => chain),
        eq: record('eq'),
        neq: record('neq'),
        lt: record('lt'),
        lte: record('lte'),
        gt: record('gt'),
        gte: record('gte'),
        in: record('in'),
        is: record('is'),
        not: jest.fn(() => chain),
        filter: jest.fn(() => chain),
        contains: jest.fn(() => chain),
        overlaps: jest.fn(() => chain),
        order: record('order'),
        limit: record('limit'),
        // Recorded, not just stubbed: the adapter paginates with range(from,
        // to) rather than limit(), so a test asserting on `limit` would be
        // asserting about a call it never makes.
        range: jest.fn((...args: unknown[]) => {
            CALLS.push({ method: 'range', args });
            return Promise.resolve({ data: [], error: null });
        }),
    };
    return { supabaseAdmin: { from: jest.fn(() => chain), rpc: jest.fn() } };
});

jest.mock('@/lib/cache-map', () => ({ invalidateCacheForCollection: jest.fn() }));

const { supabaseDb } =
    jest.requireActual<typeof import('@/lib/supabase-db')>('@/lib/supabase-db');

beforeEach(() => {
    CALLS.length = 0;
});

/** Every `.order(...)` the adapter asked PostgREST for, in order. */
function orders(): Array<{ column: unknown; opts: unknown }> {
    return CALLS.filter((c) => c.method === 'order').map((c) => ({ column: c.args[0], opts: c.args[1] }));
}

describe('a query with no orderBy', () => {
    it('IS ORDERED BY ID', async () => {
        // The line the fake and the Postgres harness are both built on.
        await supabaseDb.collection('users').where('email', '==', 'a@example.com').get();

        expect(orders()).toEqual([{ column: 'id', opts: undefined }]);
    });

    it('including when a limit is applied, which is what makes the limit deterministic', async () => {
        // `.limit(1)` is the shape of every dedup check in this codebase. What
        // it returns is decided by this ordering and nothing else.
        await supabaseDb.collection('users').where('phone', '==', '+2348000000000').limit(1).get();

        expect(orders()).toEqual([{ column: 'id', opts: undefined }]);
        // range(0, 0) is one row — the adapter's spelling of limit(1).
        expect(CALLS.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 0]]);
    });

    it('and on a plain unfiltered read', async () => {
        await supabaseDb.collection('cooperative_members').get();

        expect(orders()).toEqual([{ column: 'id', opts: undefined }]);
    });
});

describe('a query that asks for an order', () => {
    it('gets that order and NOT the id fallback', async () => {
        // The fallback must not be additive: appending id after the caller's
        // key would change nothing about which rows come back, but appending
        // it BEFORE would silently override the sort the caller asked for.
        await supabaseDb.collection('users').orderBy('createdAt', 'desc').get();

        // `created_at`, not `createdAt`: users is a dedicated table and the
        // adapter maps a camelCase order key onto the real column. Asserting
        // the camelCase name would have pinned a query the adapter never sends.
        expect(orders()).toEqual([{ column: 'created_at', opts: { ascending: false } }]);
    });

    it('and an ascending order is passed through as ascending', async () => {
        await supabaseDb.collection('users').orderBy('createdAt', 'asc').get();

        expect(orders()).toEqual([{ column: 'created_at', opts: { ascending: true } }]);
    });

    it('and a two-key order keeps both, in the caller\'s order', async () => {
        await supabaseDb.collection('users')
            .orderBy('status', 'asc')
            .orderBy('createdAt', 'desc')
            .get();

        // Two spellings in one query, which is the adapter working correctly:
        // `created_at` is a real column on this table, `status` is not, so the
        // second is ordered through the JSONB document.
        //
        // Worth pinning rather than glossing: a JSONB order key is compared as
        // TEXT. That is the same trap the numeric-filter work documented from
        // the other side — `.orderBy` on a numeric JSONB field sorts 90000
        // below 900 — and this assertion is where a reader can see which keys
        // take that path.
        expect(orders()).toEqual([
            { column: 'raw_data->>"status"', opts: { ascending: true } },
            { column: 'created_at', opts: { ascending: false } },
        ]);
    });
});
