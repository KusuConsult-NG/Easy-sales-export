/**
 * @jest-environment node
 */

/**
 *   #455 THE AGGREGATE FETCHED EVERY MATCHING DOCUMENT IN FULL TO ADD UP ONE
 *   NUMBER THAT LIVES IN ITS OWN COLUMN.
 *
 *   SupabaseQuery.aggregate() ran `select('raw_data')` and paged the whole
 *   collection into JavaScript, 1,000 rows at a time, then summed a single
 *   field out of each document.
 *
 *   The admin financial overview does exactly that over processed_payments
 *   where status == completed — so drawing one tile transferred every completed
 *   payment on the platform, entire. It is one of NINE aggregate call sites, and
 *   the cost grows with the platform forever.
 *
 *   `amount` is a NATIVE COLUMN on processed_payments, transactions and
 *   cooperative_loans. Selecting the column moves one number per row instead of
 *   a document.
 *
 *   MEASURED AGAINST A REAL POSTGRES + POSTGREST, 1,500 rows carrying a 2 KB
 *   document each — modest by the standards of a live payments table:
 *
 *       before   150000 in 81ms, 65ms, 61ms
 *       after    150000 in 33ms, 12ms, 11ms
 *
 *   Same total, less than half the time, and the gap widens with both row count
 *   and document size. The first A/B I ran reported `total=0` for the "before"
 *   case, which was MY MUTATION being inconsistent — I changed the projection
 *   without changing the read — not the original behaviour. Re-measured against
 *   the committed original, which is what the numbers above are.
 *
 *   WHY THIS TEST RUNS AGAINST A REAL DATABASE
 *
 *   The question is not whether the JavaScript adds up correctly; it is whether
 *   a narrowed PostgREST projection returns the same rows and the same number.
 *   That is a question about what the database does, and reading the source
 *   cannot settle it — the same reason native-column-mirror.test.ts exists.
 *
 *   Requires a local cluster; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 *
 *   AND AUDITING THE INSTRUMENT TURNED UP A SECOND THING
 *
 *   The first full run of this suite failed six times with
 *
 *       [supabase-db] aggregate processedPayments: TypeError: fetch failed
 *
 *   which reads exactly like a broken query. It was not. next/jest sets
 *   NODE_ENV=test, so the `.env.development.local` that up.sh writes is never
 *   loaded, the admin client fell back to PLACEHOLDER_SUPABASE_URL, and the real
 *   cause — `getaddrinfo ENOTFOUND placeholder.supabase.co` — was two `cause`
 *   levels down inside the wrapped error. This is the FIRST pg suite to talk to
 *   PostgREST, so it is the first to hit it; every future one would have.
 *
 *   Fixed in scripts/local-stack/jest-env.js, and one test below asserts the
 *   client really is pointed at loopback, so the suite can never again pass or
 *   fail for a reason that has nothing to do with the aggregate.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     nativeFor always null — full revert       KILLED
 *     the read ignores the plan, uses raw_data  KILLED
 *     count-only projects raw_data again        KILLED (only after the fix below)
 *     one document field no longer forces
 *       raw_data — partial narrowing            KILLED
 *     reword this header                        SURVIVED, as intended
 *
 *   THE THIRD ONE SURVIVED THE FIRST TIME AND THAT CHANGED THE CODE. Counting
 *   rows works whatever the rows contain, so no database test could tell a count
 *   that pulled whole documents from one that did not — and pulling documents to
 *   count them is the same defect this finding is about. The projection choice
 *   became a real function, aggregateProjection(), tested directly. A fifth
 *   mutant (dropping a `fields.length > 0` guard) survived as genuinely
 *   equivalent — the empty case returned before the guard was read — so the dead
 *   condition was removed rather than left with a test written around it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { supabaseDb as db, aggregateProjection } from '@/lib/supabase-db';
import { AggregateField } from '@/lib/firestore-compat';
import { COLLECTIONS } from '@/lib/types/firestore';
import { NATIVE_COLUMNS, FIELD_TO_COLUMN } from '@/lib/supabase-table-map';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('select 1');
    client = c;
});

afterAll(async () => { await client?.end().catch(() => {}); });

const PREFIX = 'agg-';

async function q(sql: string, params: unknown[] = []) {
    return (await client!.query(sql, params)).rows;
}

async function wipe() {
    for (const t of ['processed_payments', 'document_collections']) {
        await q(`delete from ${t} where id like $1`, [`${PREFIX}%`]);
    }
}

beforeEach(async () => { if (REQUESTED) await wipe(); });

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#455 — the aggregate sums the column, and gets the same answer', () => {
    it('SUMS A NATIVE COLUMN CORRECTLY', async () => {
        // The document carries a DIFFERENT number from the column on purpose.
        // If the aggregate silently fell back to raw_data this would be 999000,
        // and a test that seeded them equal could not tell the two apart.
        for (let i = 1; i <= 5; i += 1) {
            await q(
                `insert into processed_payments (id, user_id, amount, reference, raw_data, created_at, updated_at)
                 values ($1,$2,$3,$4,$5, now(), now())`,
                [`${PREFIX}${i}`, 'u1', 100, `ref-${i}`,
                 JSON.stringify({ amount: 999, status: 'completed' })],
            );
        }

        // Scoped to this test's own rows. Summing the whole table would make
        // the assertion depend on whatever else is in the database — my first
        // run failed at 150500 because a benchmark's rows were still there,
        // and a test that can be broken by unrelated data is a test that gets
        // ignored.
        const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where('userId', '==', 'u1')
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(500);   // the COLUMN, 5 x 100
    });

    it('and honours a filter, rather than summing the whole table', async () => {
        for (const [id, amount] of [[`${PREFIX}a`, 100], [`${PREFIX}b`, 250]] as const) {
            await q(
                `insert into processed_payments (id, user_id, amount, reference, raw_data, created_at, updated_at)
                 values ($1,$2,$3,$4,$5, now(), now())`,
                [id, id === `${PREFIX}a` ? 'keep' : 'drop', amount, `r-${id}`,
                 JSON.stringify({ amount, status: 'completed' })],
            );
        }

        const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where('userId', '==', 'keep')
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(100);
    });

    it('AND PAGES PAST 1,000 ROWS — the cap that once silently under-reported', async () => {
        // The paging loop predates this change and must survive it: a single
        // PostgREST page is 1,000 rows, and reading only the first made every
        // financial total wrong the moment a collection outgrew it.
        await q(
            `insert into processed_payments (id, user_id, amount, reference, raw_data, created_at, updated_at)
             select $1 || g, 'bulk', 10, 'r-' || g,
                    jsonb_build_object('amount', 10, 'status', 'completed'), now(), now()
             from generate_series(1, 1200) g`,
            [PREFIX],
        );

        const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where('userId', '==', 'bulk')
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(12000);   // 1200 x 10, not 1000 x 10
    });

    it('and counts rows without needing any column at all', async () => {
        await q(
            `insert into processed_payments (id, user_id, amount, reference, raw_data, created_at, updated_at)
             select $1 || g, 'c', 5, 'r-' || g, jsonb_build_object('amount', 5), now(), now()
             from generate_series(1, 7) g`,
            [PREFIX],
        );

        const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where('userId', '==', 'c')
            .aggregate({ n: AggregateField.count() }).get();

        expect(snap.data().n).toBe(7);
    });

    it('FALLS BACK TO raw_data for a field with no native column', async () => {
        // The narrowing must not break the collections it does not apply to.
        // document_collections has no typed columns, so the document is the
        // only place the number is.
        for (let i = 1; i <= 3; i += 1) {
            await q(
                `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
                 values ($1, 'export_investments', $2, now(), now())`,
                [`${PREFIX}inv-${i}`, JSON.stringify({ units: 4 })],
            );
        }

        const snap = await db.collection('export_investments')
            .aggregate({ total: AggregateField.sum('units') }).get();

        expect(snap.data().total).toBe(12);
    });

    it('and an empty collection sums to 0, not NaN', async () => {
        const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where('userId', '==', 'nobody-at-all')
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#455 — the narrowing only applies where a native column exists', () => {
    it('amount IS native on the three tables the money aggregates read', () => {
        // The premise. If this stops holding, the projection silently widens
        // back to raw_data and the tests above still pass — so it is asserted
        // rather than assumed.
        for (const table of ['processed_payments', 'transactions', 'cooperative_loans']) {
            const column = FIELD_TO_COLUMN[table]?.amount;
            expect({ table, column }).toEqual({ table, column: 'amount' });
            expect(NATIVE_COLUMNS[table]).toContain('amount');
        }
    });

    it('and document_collections has no native columns to narrow to', () => {
        expect(NATIVE_COLUMNS['document_collections']).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#455 — the projection the aggregate asks for', () => {
    // The choice is NOT observable from outside: the caller gets the same total
    // whichever projection was used, so the database tests above cannot tell a
    // narrowed select from a wide one. That is why it is a function.

    it('NARROWS TO THE COLUMN when every summed field has one', () => {
        expect(aggregateProjection('processed_payments', ['amount']))
            .toEqual({ projection: 'amount', columnFor: { amount: 'amount' } });
    });

    it('AND FALLS BACK TO raw_data when ANY field does not', () => {
        // All-or-nothing on purpose: selecting a column that does not exist
        // fails the query outright rather than degrading, so one document-only
        // field takes the whole aggregate back to raw_data.
        expect(aggregateProjection('processed_payments', ['amount', 'somethingOnlyInTheDocument']))
            .toEqual({
                projection: 'raw_data',
                columnFor: { amount: null, somethingOnlyInTheDocument: null },
            });
    });

    it('AND COUNTS WITHOUT PULLING DOCUMENTS — the case that survived a mutant', () => {
        // A count needs no field at all. This asked for `raw_data` until a
        // mutation test showed the empty-field case had no defined answer:
        // every database test passed either way, because counting rows works
        // whatever the rows contain. Pulling documents to count them is the
        // same defect as pulling them to add one number.
        expect(aggregateProjection('processed_payments', []))
            .toEqual({ projection: 'id', columnFor: {} });
    });

    it('and never narrows document_collections, where nothing is typed', () => {
        expect(aggregateProjection('document_collections', ['units']))
            .toEqual({ projection: 'raw_data', columnFor: { units: null } });
    });

    it('and asks for each column ONCE when two fields share one', () => {
        const plan = aggregateProjection('processed_payments', ['amount', 'amount']);

        expect(plan.projection).toBe('amount');
    });

    it('and a field with no mapping at all is a document field, not a crash', () => {
        expect(aggregateProjection('processed_payments', ['neverHeardOfIt']).projection)
            .toBe('raw_data');
        expect(aggregateProjection('a_table_that_does_not_exist', ['amount']).projection)
            .toBe('raw_data');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#455 — the instrument itself', () => {
    it('THE SUITE IS POINTED AT LOOPBACK, NOT A PLACEHOLDER AND NOT PRODUCTION', () => {
        // Two failures this catches, and they look nothing alike:
        //
        //   the placeholder — every read fails with `fetch failed` and the
        //   error names the collection, so it reads as a broken query;
        //
        //   a real remote URL — the reads SUCCEED, and a suite that deletes
        //   rows by prefix runs against somebody's data.
        //
        // Only meaningful when the suite is actually running.
        if (!REQUESTED) return;

        const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        expect(url).not.toContain('placeholder');
        expect(new global.URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost|\[::1\])$/);
        expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').not.toBe('');
    });
});
