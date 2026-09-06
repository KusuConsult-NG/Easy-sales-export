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
 *   `amount` is a NATIVE COLUMN on processed_payments and transactions.
 *   Selecting the column moves one number per row instead of a document.
 *
 *   AND THE OTHER SEVEN CALL SITES HAVE NO SUCH COLUMN. escrow_transactions,
 *   loan_applications, cooperative_withdrawals, wave_withdrawals and the wave
 *   shipment totals all live in `document_collections`, the untyped catch-all.
 *   Fixing the two tables that happen to be typed and calling it done would have
 *   been a fix that reached two of nine doors — the shape of defect this audit
 *   keeps finding, including in my own earlier work.
 *
 *   PostgREST can project a JSON path, so those seven narrow too:
 *   `select=agg0:raw_data->>amount` returns one text value per row.
 *
 *   MEASURED AGAINST A REAL POSTGRES + POSTGREST, 1,500 rows carrying a 2 KB
 *   document each — modest by the standards of a live payments table:
 *
 *       native column   before 81ms, 65ms, 61ms   after 33ms, 12ms, 11ms
 *       JSON path       before 133ms, 73ms, 58ms  after 80ms, 14ms, 14ms
 *
 *   Same total (150000) every time, and the gap widens with both row count and
 *   document size. The first A/B I ran reported `total=0` for the "before" case,
 *   which was MY MUTATION being inconsistent — I changed the projection without
 *   changing the read — not the original behaviour. Both pairs above were
 *   re-measured against the committed code they replace.
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
 *     count-only projects raw_data again        KILLED (only after a fix, below)
 *     partial narrowing — one bad field allowed KILLED
 *     document fields go back to whole raw_data KILLED
 *     the safe-key guard rejects nothing        KILLED
 *     the safe-key guard rejects everything     KILLED
 *     aliases stop being positional (all agg0)  KILLED
 *     a null value counts as zero again         KILLED (only after a fix, below)
 *     reword this header                        SURVIVED, as intended
 *
 *   TWO SURVIVED A ROUND FIRST, AND BOTH CHANGED SOMETHING.
 *
 *     The COUNT mutant survived because counting rows works whatever the rows
 *     contain, so no database test could tell a count that pulled whole
 *     documents from one that did not — and pulling documents to count them is
 *     the same defect this finding is about. The projection choice became a real
 *     function, aggregateProjection(), tested directly.
 *
 *     The NULL mutant survived because the test named for it could not see it. A
 *     row with no figure adds 0 to a sum and one to a row count either way; the
 *     only place the difference shows is an AVERAGE. The test asserted a sum and
 *     a count and was called "not counted as zero", which was a claim it could
 *     not support. It asserts the average now.
 *
 *   A further mutant survived as genuinely equivalent — a dead `fields.length >
 *   0` guard, since the empty case returned before it was read — so the dead
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

/**
 * Every assertion below is scoped to rows this suite wrote.
 *
 * It bit twice. First a benchmark's leftovers made a total read 150500; then a
 * pre-existing escrow_transactions row made one read 2100 instead of 100.
 * document_collections is SHARED by every untyped collection, so "sum this
 * collection" is a question about whatever else happens to be in the database. A
 * test that unrelated data can break is a test that gets ignored.
 */
const TAG = 'agg-455-own-rows';

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

    it('SUMS A DOCUMENT FIELD THROUGH A JSON PATH — the other seven call sites', async () => {
        // escrow_transactions, loan_applications, cooperative_withdrawals,
        // wave_withdrawals and the wave shipment totals ALL live in
        // document_collections, where there is no column to narrow to. Fixing
        // only the two typed tables would have been a fix that reached two of
        // nine call sites — the shape of defect this audit keeps finding.
        for (let i = 1; i <= 4; i += 1) {
            await q(
                `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
                 values ($1, 'escrow_transactions', $2, now(), now())`,
                [`${PREFIX}esc-${i}`, JSON.stringify({ amount: 25, tag: TAG, note: 'x'.repeat(500) })],
            );
        }

        const snap = await db.collection('escrow_transactions')
            .where('tag', '==', TAG)
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(100);
    });

    it('AND A ROW MISSING THE FIELD IS SKIPPED, NOT COUNTED AS ZERO', async () => {
        // `->>` returns SQL NULL for an absent key, and Number(null) is 0 — a
        // row holding no figure must not land in an average's denominator.
        await q(
            `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
             values ($1, 'escrow_transactions', $2, now(), now()),
                    ($3, 'escrow_transactions', $4, now(), now())`,
            [`${PREFIX}esc-a`, JSON.stringify({ amount: 40, tag: TAG }),
             `${PREFIX}esc-b`, JSON.stringify({ somethingElse: true, tag: TAG })],
        );

        const snap = await db.collection('escrow_transactions')
            .where('tag', '==', TAG)
            .aggregate({
                total: AggregateField.sum('amount'),
                n: AggregateField.count(),
                // THE AVERAGE IS THE ONLY PLACE THIS IS VISIBLE, and leaving it
                // out is how a mutant that put nulls back at zero survived a
                // round: the sum is 40 either way, and the count is the row
                // count either way. Two rows, one figure — the average of the
                // figures present is 40, not 20.
                mean: AggregateField.average('amount'),
            }).get();

        expect(snap.data()).toEqual({ total: 40, n: 2, mean: 40 });
    });

    it('and a decimal document figure keeps its kobo', async () => {
        // The JSON path returns TEXT. "1234.56" must not arrive as 1234.
        await q(
            `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
             values ($1, 'escrow_transactions', $2, now(), now())`,
            [`${PREFIX}esc-d`, JSON.stringify({ amount: 1234.56, tag: TAG })],
        );

        const snap = await db.collection('escrow_transactions')
            .where('tag', '==', TAG)
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBeCloseTo(1234.56, 2);
    });

    it('and the collection filter still holds — one collection, not the table', async () => {
        // document_collections is shared by every untyped collection. A
        // narrowed projection must not lose the collection_name filter, or an
        // escrow total would quietly include loan applications.
        await q(
            `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
             values ($1, 'escrow_transactions', $2, now(), now()),
                    ($3, 'loan_applications',   $4, now(), now())`,
            [`${PREFIX}mix-a`, JSON.stringify({ amount: 11, tag: TAG }),
             `${PREFIX}mix-b`, JSON.stringify({ amount: 9999, tag: TAG })],
        );

        const snap = await db.collection('escrow_transactions')
            .where('tag', '==', TAG)
            .aggregate({ total: AggregateField.sum('amount') }).get();

        expect(snap.data().total).toBe(11);
    });

    it('and a document field still sums when it is the only place it lives', async () => {
        // The narrowing must not break the collections it does not apply to.
        // document_collections has no typed columns, so the document is the
        // only place the number is.
        for (let i = 1; i <= 3; i += 1) {
            await q(
                `insert into document_collections (id, collection_name, raw_data, created_at, updated_at)
                 values ($1, 'export_investments', $2, now(), now())`,
                [`${PREFIX}inv-${i}`, JSON.stringify({ units: 4, tag: TAG })],
            );
        }

        const snap = await db.collection('export_investments')
            .where('tag', '==', TAG)
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

    it('AND NARROWS A DOCUMENT FIELD TO A JSON PATH — the other seven call sites', () => {
        // Without this the fix reaches processed_payments and transactions and
        // NOTHING ELSE, because every other aggregate is over the untyped
        // document_collections table.
        expect(aggregateProjection('document_collections', ['amount']))
            .toEqual({ projection: 'agg0:raw_data->>amount', columnFor: { amount: 'agg0' } });
    });

    it('and MIXES a native column with a JSON path in one select', () => {
        // Verified against the real PostgREST: select=amount,agg1:raw_data->>fee
        // returns {"amount":5.00,"agg0":"9"}.
        expect(aggregateProjection('processed_payments', ['amount', 'fee']))
            .toEqual({
                projection: 'amount,agg1:raw_data->>fee',
                columnFor: { amount: 'amount', fee: 'agg1' },
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

    it('AND A FIELD IT CANNOT NAME SAFELY TAKES THE WHOLE PLAN TO raw_data', () => {
        // The select grammar gives meaning to , : ( ) . - > and quotes. A field
        // carrying one of them would change the query rather than name a key,
        // and half a narrowing is not a narrowing — a select is one string.
        for (const unsafe of ['a,b', 'a:b', 'a.b', 'a->b', 'a(b)', '"a"', '2legit', '']) {
            expect({ unsafe, projection: aggregateProjection('document_collections', [unsafe]).projection })
                .toEqual({ unsafe, projection: 'raw_data' });
        }

        // and ONE bad field is enough, even beside a good one.
        expect(aggregateProjection('processed_payments', ['amount', 'a,b']))
            .toEqual({ projection: 'raw_data', columnFor: { amount: null, 'a,b': null } });
    });

    it('POSITIVE CONTROL: an ordinary camelCase field is NOT treated as unsafe', () => {
        // Without this, a guard that rejected everything would pass the test
        // above and silently undo the whole finding.
        expect(aggregateProjection('document_collections', ['amountDisbursed']).projection)
            .toBe('agg0:raw_data->>amountDisbursed');
    });

    it('and asks for each column ONCE when two fields share one', () => {
        expect(aggregateProjection('processed_payments', ['amount', 'amount']).projection)
            .toBe('amount');
    });

    it('and every real aggregate call site in the app narrows to something', () => {
        // The vacuity guard, and the point of the whole finding: nine call
        // sites, none of them still pulling whole documents.
        const SITES: Array<[string, string[]]> = [
            ['processed_payments', ['amount']],
            ['transactions', ['amount']],
            ['document_collections', ['amount']],            // escrow, loans, withdrawals
            ['document_collections', ['amountDisbursed']],   // wave compliance
        ];

        for (const [table, fields] of SITES) {
            expect({ table, fields, projection: aggregateProjection(table, fields).projection })
                .not.toEqual({ table, fields, projection: 'raw_data' });
        }
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
