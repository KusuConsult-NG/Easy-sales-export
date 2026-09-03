/**
 * @jest-environment node
 */

/**
 * The in-memory fake, checked against a real PostgreSQL.
 *
 * lib/testing/fake-db.ts is about to carry a lot of weight: behavioural tests
 * built on it will read and write documents and assert what the store holds
 * afterwards, and the coverage they earn is only worth having if the fake answers
 * the way the database does.
 *
 * A fake that is subtly WRONG is worse than a recorder. A recorder proves little
 * and admits it; a wrong fake proves things that are false. And the specific ways
 * this adapter surprises people are all in the query layer:
 *
 *   - `==` compares as TEXT. `raw_data->>'f'` is text, so `where("amount","==",900)`
 *     stringifies. `"900.00" == 900` is FALSE.
 *   - `>`/`<`/`>=`/`<=` compare as NUMBERS when the operand is a number — that is
 *     numericAware rewriting `->>` to `->…::numeric`. So the two families of
 *     operator do not agree with each other, by design.
 *   - `!=` does NOT match a document missing the key, because
 *     `raw_data->>'f' <> 'x'` is NULL, and NULL is not true.
 *   - `ORDER BY … DESC` is NULLS FIRST. A "most recent" sort on a key the writers
 *     never set therefore puts the keyless documents at the TOP. That is finding
 *     #49, thirty-four times over.
 *   - Ordering is TEXTUAL, so "10" sorts before "9".
 *
 * Every one of those is asserted here twice: once against Postgres, once against
 * the fake, and then the two answers are required to be equal. Where they cannot
 * agree, the divergence is declared in fake-db.ts's KNOWN_DIVERGENCES.
 *
 *     ./scripts/local-postgres.sh start
 *     LOCAL_PG_URL=postgres://postgres@127.0.0.1:55432/app npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Client } from 'pg';

/**
 * jest.config.pg.js deliberately does NOT load jest.setup.js — a test that opens
 * its own database connection must not have the adapter mocked out from under it.
 * So this file builds the mock adapter itself, from the same shared factory
 * jest.setup.js uses, and only for this module's registry. money-functions.test.ts
 * in the same config still talks to Postgres with no mock in sight.
 */
const RECORDERS = [
    'mockFirestoreCollection', 'mockFirestoreDoc', 'mockFirestoreGet', 'mockFirestoreSet',
    'mockFirestoreUpdate', 'mockFirestoreDelete', 'mockFirestoreAdd', 'mockFirestoreBatch',
    'mockFirestoreBatchUpdate', 'mockFirestoreBatchDelete', 'mockFirestoreBatchCommit',
    'mockFirestoreTxGet', 'mockFirestoreTxSet', 'mockFirestoreTxUpdate',
];

jest.mock('@/lib/supabase-db', () => {
     
    const { createMockDb, createCompatHelpers } = require('@/lib/testing/firestore-mock-db');
    const db = createMockDb();
    return { supabaseDb: db, getAdminDb: () => db, ...createCompatHelpers(db) };
});

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

let client: Client | null = null;

beforeAll(async () => {
    for (const name of RECORDERS) {
        (globalThis as Record<string, unknown>)[name] = jest.fn();
    }
    // add() hands its return value straight to the caller, which reads `.id`.
    (globalThis as Record<string, unknown>).mockFirestoreAdd =
        jest.fn(() => Promise.resolve({ id: 'mock-generated-id' }));

    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
});
afterAll(async () => { await client?.end().catch(() => {}); });

const COLLECTION = 'fakedb_contract';

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await client!.query(sql, params)).rows as T[];
}

beforeEach(async () => {
    if (!REQUESTED) return;
    await q(`delete from document_collections where collection_name = $1`, [COLLECTION]);
});

/** Put the same documents in Postgres and return them for the fake. */
async function seed(docs: Record<string, Record<string, unknown>>): Promise<void> {
    for (const [id, data] of Object.entries(docs)) {
        await q(
            `insert into document_collections (id, collection_name, raw_data)
             values ($1, $2, $3::jsonb)
             on conflict (id, collection_name) do update set raw_data = excluded.raw_data`,
            [id, COLLECTION, JSON.stringify({ id, ...data })],
        );
    }
}

// ─── the two implementations, side by side ───────────────────────────────────
//
// The fake's query engine is not exported — it is reached through the adapter
// surface, which is the point: this tests the thing the tests will use, not a
// private helper.

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

async function fromPostgres(
    filters: Array<[string, Op, unknown]>,
    order?: [string, 'asc' | 'desc'],
    limit?: number,
): Promise<string[]> {
    const where: string[] = [`collection_name = $1`];
    const params: unknown[] = [COLLECTION];

    for (const [field, op, value] of filters) {
        const text = `raw_data->>${literal(field)}`;
        const numeric = typeof value === 'number' && Number.isFinite(value);
        params.push(String(value));
        const p = `$${params.length}`;
        switch (op) {
            case '==': where.push(`${text} = ${p}`); break;
            case '!=': where.push(`${text} <> ${p}`); break;
            case '<': case '<=': case '>': case '>=': {
                const lhs = numeric ? `(raw_data->${literal(field)})::numeric` : text;
                const rhs = numeric ? `${p}::numeric` : p;
                where.push(`${lhs} ${op} ${rhs}`);
                break;
            }
            case 'in': {
                params.pop();
                const list = (value as unknown[]).map((v) => { params.push(String(v)); return `$${params.length}`; });
                where.push(`${text} in (${list.join(', ')})`);
                break;
            }
            case 'array-contains': {
                params.pop();
                params.push(JSON.stringify([value]));
                where.push(`raw_data->${literal(field)} @> $${params.length}::jsonb`);
                break;
            }
        }
    }

    /**
     * THE ADAPTER'S OWN DEFAULT ORDER, WHICH THIS OMITTED.
     *
     * supabase-db.ts:1689 ends every query build with
     *
     *     if (this._orderBy.length === 0) query = query.order('id');
     *
     * so an unordered query is never actually unordered in production — it
     * comes back by id. This helper issued raw SQL with no ORDER BY at all and
     * compared the fake against Postgres's heap order, which is not a query
     * the adapter can ever send.
     *
     * With three or four seeded rows heap order usually coincides with id
     * order, so most comparisons here passed by luck; `{ t, f, s }` filtered to
     * { t, s } is a case where it does not, and it was the one failing test the
     * first time this suite was run against a real cluster. The fake was right
     * and the yardstick was wrong.
     *
     * That matters beyond one assertion: the point of this file is to be the
     * thing that certifies the fake the whole unit suite runs on. A yardstick
     * measuring a different query certifies nothing.
     *
     * FOUND TWICE, INDEPENDENTLY. The parallel audit reached the same line from
     * the same failing case — "pg returned insertion order [t,s], the fake id
     * order [s,t], and both were 'right' about different queries" — and tied it
     * to the pagination cursor the fallback exists for. Two audits converging on
     * one line, from one failure, is the strongest evidence either produced that
     * the fix is the right one.
     */
    const orderBy = order
        ? ` order by raw_data->>${literal(order[0])} ${order[1] === 'desc' ? 'desc' : 'asc'}`
        : ' order by id';
    const cap = limit !== undefined ? ` limit ${Number(limit)}` : '';

    return (await q<{ id: string }>(
        `select id from document_collections where ${where.join(' and ')}${orderBy}${cap}`, params,
    )).map((r) => r.id);
}

/** Single-quoted SQL literal for an identifier used inside ->>. */
function literal(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
}

async function fromFake(
    docs: Record<string, Record<string, unknown>>,
    filters: Array<[string, Op, unknown]>,
    order?: [string, 'asc' | 'desc'],
    limit?: number,
): Promise<string[]> {
    // Imported lazily and reinstalled per call so each comparison starts clean.
    const { installFakeDb } = await import('@/lib/testing/fake-db');
    installFakeDb({ [COLLECTION]: docs });

    const { supabaseDb } = await import('@/lib/supabase-db');
    let query: any = supabaseDb.collection(COLLECTION);
    for (const [field, op, value] of filters) query = query.where(field, op, value);
    if (order) query = query.orderBy(order[0], order[1]);
    if (limit !== undefined) query = query.limit(limit);

    const snap = await query.get();
    return snap.docs.map((d: { id: string }) => d.id);
}

/**
 * Run one query both ways and require the same ids in the same order.
 *
 * Returns the answer so a test can additionally assert WHAT it is — agreeing on
 * the wrong answer would otherwise pass.
 */
async function both(
    docs: Record<string, Record<string, unknown>>,
    filters: Array<[string, Op, unknown]>,
    order?: [string, 'asc' | 'desc'],
    limit?: number,
): Promise<string[]> {
    await seed(docs);
    const pg = await fromPostgres(filters, order, limit);
    const fake = await fromFake(docs, filters, order, limit);
    expect(fake).toEqual(pg);
    return pg;
}

// ─────────────────────────────────────────────────────────────────────────────

dbDescribe('the harness is talking to a real database', () => {
    it('with the app schema', async () => {
        const [{ n }] = await q<{ n: string }>(
            `select count(*)::text as n from information_schema.tables
              where table_schema = 'public' and table_name = 'document_collections'`);
        expect(Number(n)).toBe(1);
    });
});

dbDescribe('an unordered query is not unordered', () => {
    it('COMES BACK BY ID, WHICH IS WHAT THE ADAPTER ASKS FOR', async () => {
        /**
         * The regression test for the yardstick itself.
         *
         * Ids are seeded in an order that is deliberately NOT their sorted
         * order, so heap order and id order cannot coincide. Before
         * fromPostgres was given the adapter's `order by id`, this compared the
         * fake against Postgres's arbitrary heap order and the two disagreed —
         * which read as "the fake is wrong" when the fake was right.
         */
        const ids = await both({
            zulu: { kind: 'x' },
            alpha: { kind: 'x' },
            mike: { kind: 'x' },
        }, [['kind', '==', 'x']]);

        expect(ids).toEqual(['alpha', 'mike', 'zulu']);
    });

    it('AND THAT DECIDES WHICH ROWS A LIMIT KEEPS', async () => {
        // The consequence, which is the reason this is worth a test rather
        // than a comment: with no orderBy, `.limit(n)` does not take "the first
        // n written" or "the newest n" — it takes the n lowest ids. Every
        // `.limit(1)` dedup check in this codebase resolves that way.
        const ids = await both({
            zulu: { kind: 'y' },
            alpha: { kind: 'y' },
            mike: { kind: 'y' },
        }, [['kind', '==', 'y']], undefined, 2);

        expect(ids).toEqual(['alpha', 'mike']);
    });
});

dbDescribe('equality compares as TEXT', () => {
    it('so a number and its decimal spelling are NOT equal', async () => {
        // The trap. An action storing 900 and a query asking for "900.00" — or the
        // reverse — finds nothing, and nothing errors.
        const docs = {
            a: { amount: 900 },
            b: { amount: '900.00' },
            c: { amount: '900' },
        };
        const ids = await both(docs, [['amount', '==', 900]]);
        expect(ids.sort()).toEqual(['a', 'c']);
    });

    it('and a boolean matches its text spelling', async () => {
        const docs = { t: { active: true }, f: { active: false }, s: { active: 'true' } };
        const ids = await both(docs, [['active', '==', true]]);
        expect(ids.sort()).toEqual(['s', 't']);
    });
});

dbDescribe('the ordering operators compare as NUMBERS', () => {
    it('so 90000 IS greater than 900, which text comparison denies', async () => {
        // lib/supabase-db.ts records finding this the hard way: the text answer
        // put 90000 below 900 because "9" < "9" then "0" < "0" then "0" < "0"
        // and then "0" < nothing. numericAware exists for this.
        const docs = {
            small: { amount: 900 },
            large: { amount: 90000 },
            mid: { amount: 1500 },
        };
        const ids = await both(docs, [['amount', '>', 1000]]);
        expect(ids.sort()).toEqual(['large', 'mid']);
    });

    it('but ONE row holding the value as a JSON string makes the whole query ERROR', async () => {
        // Found by writing this file, and it is not what I expected. I wrote the
        // assertion as "a string value simply does not match" and Postgres said:
        //
        //     error: cannot cast jsonb string to type numeric
        //
        // `numericAware` rewrites `raw_data->>'amount'` to `raw_data->'amount'`
        // and casts THAT — the jsonb value, not its text form — because the
        // adapter's own comment records that PostgREST ignored the cast on the
        // `->>` form and silently returned the text answer. Casting jsonb honours
        // the cast, and raises on any value that is a JSON string.
        //
        // So this is not a wrong answer, it is a FAILED REQUEST, and one row is
        // enough. A catalogue query that has worked for months starts erroring
        // the moment a single product's quantity is stored as "12" instead of 12 —
        // a legacy import, a repair script, a hand edit in the Supabase console,
        // or one writer that forgets Number(). Every other row being correct does
        // not help: the cast is evaluated per row.
        //
        // Latent rather than live today: the five numeric-operand call sites are
        // availableQuantity (3) and amountDisbursed (2); every availableQuantity
        // writer goes through parseInt/Number, and amountDisbursed has no writer
        // at all. src/__tests__/unit/numeric-filter-fields-are-coerced.test.ts is
        // what keeps that true.
        await seed({ a: { amount: 2000 }, b: { amount: '500' } });

        await expect(fromPostgres([['amount', '>=', 1000]]))
            .rejects.toThrow(/cannot cast jsonb string to type numeric/);

        // And with every row holding a real number, the same query is fine — so
        // the failure is about the DATA, not the query.
        await q(`delete from document_collections where collection_name = $1 and id = 'b'`, [COLLECTION]);
        expect(await fromPostgres([['amount', '>=', 1000]])).toEqual(['a']);
    });

    it('a non-numeric string errors the same way, not "no match"', async () => {
        await seed({ a: { amount: 'lots' }, b: { amount: 2000 } });
        await expect(fromPostgres([['amount', '>', 1000]]))
            .rejects.toThrow(/cannot cast jsonb string to type numeric/);
    });

    it('and the fake DIVERGES here — it answers instead of failing', async () => {
        // Declared, not hidden. The fake compares in JavaScript, where
        // Number("500") is 500, so it returns an answer where production returns
        // an error. A test built on the fake therefore cannot discover this class
        // of outage, which is why it is in KNOWN_DIVERGENCES and why the
        // assertions above talk to Postgres directly.
        const docs = { a: { amount: 2000 }, b: { amount: '500' } };
        expect(await fromFake(docs, [['amount', '>=', 1000]])).toEqual(['a']);

        const { KNOWN_DIVERGENCES } = await import('@/lib/testing/fake-db');
        expect(KNOWN_DIVERGENCES.some((d) => /cast/i.test(d.why))).toBe(true);
    });
});

dbDescribe('a missing key', () => {
    it('does not match !=, because NULL <> x is not true', async () => {
        // The one that reads backwards. "status is not cancelled" excludes a
        // document with no status at all — so a query written to be permissive
        // silently drops rows.
        const docs = {
            open: { status: 'open' },
            cancelled: { status: 'cancelled' },
            keyless: { note: 'no status here' },
        };
        const ids = await both(docs, [['status', '!=', 'cancelled']]);
        expect(ids).toEqual(['open']);
    });

    it('nor ==, nor in, nor any ordering comparison', async () => {
        const docs = { has: { status: 'open' }, keyless: {} };
        expect(await both(docs, [['status', '==', 'open']])).toEqual(['has']);
        expect(await both(docs, [['status', 'in', ['open', 'closed']]])).toEqual(['has']);
        expect(await both(docs, [['status', '>', 'a']])).toEqual(['has']);
    });
});

dbDescribe('DESCENDING order puts the documents MISSING the key FIRST', () => {
    it('which is finding #49, thirty-four sorts over', async () => {
        // `ORDER BY expr DESC` is NULLS FIRST in Postgres. So a "most recent"
        // list ordered on a key the writers never set does not merely fail to
        // sort — it puts every keyless document above every dated one, and the
        // newest record is nowhere near the top.
        const docs = {
            older: { createdAt: '2026-01-01T00:00:00.000Z' },
            newer: { createdAt: '2026-06-01T00:00:00.000Z' },
            keyless: { note: 'written by a path that never set createdAt' },
        };
        const ids = await both(docs, [], ['createdAt', 'desc']);
        expect(ids[0]).toBe('keyless');
        expect(ids).toEqual(['keyless', 'newer', 'older']);
    });

    it('and ASCENDING puts them LAST', async () => {
        const docs = {
            older: { createdAt: '2026-01-01T00:00:00.000Z' },
            newer: { createdAt: '2026-06-01T00:00:00.000Z' },
            keyless: {},
        };
        const ids = await both(docs, [], ['createdAt', 'asc']);
        expect(ids).toEqual(['older', 'newer', 'keyless']);
    });

    it('with a limit, so the keyless ones consume the whole page', async () => {
        // The sharp version: `.orderBy(k, "desc").limit(2)` on a collection where
        // most documents lack k returns nothing but keyless documents.
        const docs = {
            dated: { createdAt: '2026-06-01T00:00:00.000Z' },
            k1: {}, k2: {}, k3: {},
        };
        const ids = await both(docs, [], ['createdAt', 'desc'], 2);
        expect(ids).not.toContain('dated');
        expect(ids).toHaveLength(2);
    });
});

dbDescribe('ordering is TEXTUAL', () => {
    it('so "10" sorts before "9"', async () => {
        // Nothing casts in an orderBy. A numeric field ordered this way is
        // ordered lexically, and a page of "top by amount" is wrong.
        const docs = { nine: { amount: 9 }, ten: { amount: 10 }, two: { amount: 2 } };
        const ids = await both(docs, [], ['amount', 'asc']);
        expect(ids).toEqual(['ten', 'two', 'nine']);
    });

    it('and ISO timestamps sort correctly, which is why this mostly goes unnoticed', async () => {
        // ISO-8601 is designed to sort lexically. Most orderBy keys here are
        // timestamps, so the textual comparison is right for them — and that is
        // exactly why the numeric cases stay hidden.
        const docs = {
            jan: { at: '2026-01-15T10:00:00.000Z' },
            feb: { at: '2026-02-01T09:00:00.000Z' },
            dec: { at: '2025-12-31T23:59:59.000Z' },
        };
        expect(await both(docs, [], ['at', 'asc'])).toEqual(['dec', 'jan', 'feb']);
    });
});

dbDescribe('in, and array-contains', () => {
    it('in compares as text, like ==', async () => {
        const docs = { a: { status: 'open' }, b: { status: 'closed' }, c: { status: 'draft' } };
        const ids = await both(docs, [['status', 'in', ['open', 'closed']]]);
        expect(ids.sort()).toEqual(['a', 'b']);
    });

    it('array-contains matches an element of a JSONB array', async () => {
        const docs = {
            admin: { roles: ['user', 'admin'] },
            plain: { roles: ['user'] },
            none: { roles: [] },
            scalar: { roles: 'admin' },
        };
        const ids = await both(docs, [['roles', 'array-contains', 'admin']]);
        expect(ids).toEqual(['admin']);
    });
});

dbDescribe('several filters combine with AND', () => {
    it('across the text and numeric families at once', async () => {
        const docs = {
            match: { status: 'open', amount: 5000 },
            wrongStatus: { status: 'closed', amount: 5000 },
            tooSmall: { status: 'open', amount: 100 },
            keyless: { status: 'open' },
        };
        const ids = await both(docs, [['status', '==', 'open'], ['amount', '>=', 1000]]);
        expect(ids).toEqual(['match']);
    });
});

dbDescribe('nested fields', () => {
    it('are addressed by a dotted path, both sides', async () => {
        const docs = {
            registered: { serviceRegistrations: { cooperatives: { status: 'active' } } },
            pending: { serviceRegistrations: { cooperatives: { status: 'pending' } } },
            absent: { serviceRegistrations: {} },
        };
        await seed(docs);

        const pg = (await q<{ id: string }>(
            `select id from document_collections
              where collection_name = $1
                and raw_data->'serviceRegistrations'->'cooperatives'->>'status' = 'active'`,
            [COLLECTION])).map((r) => r.id);

        const fake = await fromFake(docs, [['serviceRegistrations.cooperatives.status', '==', 'active']]);
        expect(fake).toEqual(pg);
        expect(pg).toEqual(['registered']);
    });
});

dbDescribe('the answers are not trivially equal', () => {
    it('the comparison would catch a fake that filtered nothing', async () => {
        // Vacuity guard for the whole file. Every `both()` above compares two
        // lists; if the fake ignored its filters, this is the shape that would
        // catch it — and it must actually catch it, or the comparisons prove
        // nothing.
        const docs = { a: { status: 'open' }, b: { status: 'closed' } };
        await seed(docs);

        const filtered = await fromFake(docs, [['status', '==', 'open']]);
        const unfiltered = await fromFake(docs, []);

        expect(filtered).toEqual(['a']);
        expect(unfiltered.sort()).toEqual(['a', 'b']);
        expect(filtered).not.toEqual(unfiltered);
    });

    it('and a fake that ignored order would be caught too', async () => {
        const docs = { a: { at: '2026-01-01' }, b: { at: '2026-06-01' } };
        await seed(docs);
        expect(await fromFake(docs, [], ['at', 'asc'])).toEqual(['a', 'b']);
        expect(await fromFake(docs, [], ['at', 'desc'])).toEqual(['b', 'a']);
    });
});

dbDescribe('the declared divergences', () => {
    it('are a real list with a reason each', async () => {
        // A fake's honest boundary is part of its contract. An empty list here
        // would claim the fake matches Postgres in every respect, which is false
        // and would be believed.
        const { KNOWN_DIVERGENCES } = await import('@/lib/testing/fake-db');
        expect(KNOWN_DIVERGENCES.length).toBeGreaterThanOrEqual(4);
        for (const d of KNOWN_DIVERGENCES) {
            expect(d.area.length).toBeGreaterThan(5);
            expect(d.why.length).toBeGreaterThan(60);
        }
    });
});
