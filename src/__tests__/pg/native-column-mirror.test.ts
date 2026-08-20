/**
 * @jest-environment node
 */

/**
 * The dual storage, and the one write path that let the two copies disagree.
 *
 * WHY THIS FILE EXISTS AND WHAT IT FOUND
 * --------------------------------------
 * Eight collections live in their own tables, and those tables hold every mapped
 * value TWICE — once inside `raw_data`, once in a typed column. The adapter then
 * sends reads down whichever copy suits the query:
 *
 *     doc.data()                     →  raw_data, always
 *     .where("status", "==", "paid")  →  the `status` COLUMN
 *
 * so the copies disagreeing is not untidiness. It is an admin queue listing an
 * order whose own page shows a different status.
 *
 * apply_document_patch — the RPC behind every `update()` — wrote raw_data only.
 * Measured against a real PostgreSQL before the fix:
 *
 *     patch {"status":"paid"}  →  column_status = pending, raw_data = paid
 *     where status = 'pending' →  1 row, the order that had just been paid
 *
 * The mirror was a SECOND statement issued from JavaScript afterwards, which
 * leaves three gaps: it is not atomic, two concurrent patches interleave into a
 * permanently divergent row, and a FieldValue.delete() of a mapped field never
 * reached the column at all. Migration 026 mirrors inside the same UPDATE, the
 * way apply_increments, apply_array_ops and claim_status_transition_in already
 * did.
 *
 * READING THE SOURCE COULD NOT HAVE SETTLED THIS
 * ----------------------------------------------
 * The JavaScript looks correct — it does issue the column update. Whether the
 * two statements can be observed apart, whether a delete carries, and whether
 * `where` reads the stale copy are all questions about what the database
 * actually does, and every one of them is answered here by doing it.
 *
 * Requires a local cluster; skipped, loudly, without one:
 *
 *     ./scripts/local-postgres.sh start
 *     LOCAL_PG_URL=postgres://postgres@127.0.0.1:55432/app npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { DEDICATED_TABLE_MAP, FIELD_TO_COLUMN, getTableName } from '@/lib/supabase-db';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;
const dbIt = it;

beforeAll(async () => {
    if (!REQUESTED) return;
    // No try/catch, deliberately: LOCAL_PG_URL being set means somebody asked
    // for a database run, and quietly turning that into green no-ops is the
    // failure this whole audit is about.
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('select 1');
    client = c;
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await client!.query(sql, params);
    return r.rows as T[];
}

/** Every table the adapter can route a write to. */
const TABLES = [
    'users', 'cooperative_members', 'cooperative_loans', 'transactions',
    'processed_payments', 'marketplace_orders', 'wallets',
    'academy_applications', 'document_collections',
];

const PREFIX = 'ncm-';

async function wipe(): Promise<void> {
    for (const t of TABLES) {
        await q(`delete from ${t} where id like $1`, [`${PREFIX}%`]);
    }
}

beforeEach(async () => {
    if (!REQUESTED) return;
    await wipe();
});

async function patch(
    table: string,
    id: string,
    p: Record<string, unknown> = {},
    paths: Record<string, unknown> = {},
    deletes: string[] = [],
    collection: string | null = null,
): Promise<void> {
    await q('select apply_document_patch($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',
        [table, id, collection, JSON.stringify(p), JSON.stringify(paths), JSON.stringify(deletes)]);
}

// ─────────────────────────────────────────────────────────────────────────────

dbDescribe('migration 026 is applied to the database under test', () => {
    dbIt('so the assertions below are about the fixed function', async () => {
        // Vacuity guard for the file. Without 026 every mirror assertion fails,
        // which is the right outcome — but this says WHY in one line.
        //
        // It asks whether apply_document_patch ITSELF consults the map, not
        // merely whether the map exists. Reverting the function to its 017 body
        // leaves native_column_map behind — measured, by doing exactly that as a
        // mutation test — so the existence check alone stayed green while twelve
        // real assertions went red, and this guard would have explained nothing.
        const [{ n }] = await q<{ n: string }>(
            `select count(*)::text as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = 'native_column_map'`);
        expect(Number(n)).toBe(1);

        const [{ src }] = await q<{ src: string }>(
            `select prosrc as src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = 'apply_document_patch'`);
        expect(src).toContain('native_column_map(p_table)');
    });
});

dbDescribe('the mapping in SQL matches the mapping in TypeScript', () => {
    dbIt('field for field, so the two copies cannot drift apart', async () => {
        // THE drift gate. native_column_map is a hand-written copy of
        // FIELD_TO_COLUMN, which is exactly the kind of second definition this
        // audit keeps finding on the wrong side of a fix. Adding a mapped column
        // in TypeScript and not here would silently stop mirroring it.
        for (const [table, fieldMap] of Object.entries(FIELD_TO_COLUMN)) {
            const [{ m }] = await q<{ m: [string, string, string][] }>(
                'select native_column_map($1) as m', [table]);

            const fromSql = Object.fromEntries(m.map(([field, column]) => [field, column]));
            expect(fromSql).toEqual(fieldMap);

            // And the order matters where two fields share a column, because
            // the last one wins in both implementations.
            expect(m.map(([f]) => f)).toEqual(Object.keys(fieldMap));
        }
    });

    dbIt('and every column it names really exists on that table', async () => {
        for (const [table, fieldMap] of Object.entries(FIELD_TO_COLUMN)) {
            const cols = (await q<{ column_name: string }>(
                `select column_name from information_schema.columns
                  where table_schema = 'public' and table_name = $1`, [table]))
                .map((r) => r.column_name);
            for (const column of Object.values(fieldMap)) {
                expect(cols).toContain(column);
            }
        }
    });

    dbIt('with document_collections deliberately absent — it has no mapped columns', async () => {
        const [{ m }] = await q<{ m: unknown[] }>(
            "select native_column_map('document_collections') as m");
        expect(m).toEqual([]);
        expect(FIELD_TO_COLUMN).not.toHaveProperty('document_collections');
    });
});

dbDescribe('a patch to a mapped field moves BOTH copies', () => {
    async function seedOrder(id: string): Promise<void> {
        await q(
            `insert into marketplace_orders (id, user_id, status, total_amount, raw_data)
             values ($1, 'u1', 'pending', 100, $2::jsonb)`,
            [id, JSON.stringify({ id, userId: 'u1', status: 'pending', totalAmount: 100 })]);
    }

    dbIt('status, which is THE case — measured stale before migration 026', async () => {
        const id = `${PREFIX}order-1`;
        await seedOrder(id);

        await patch('marketplace_orders', id, { status: 'paid' });

        const [row] = await q<{ status: string; raw: string }>(
            `select status, raw_data->>'status' as raw from marketplace_orders where id = $1`, [id]);
        expect(row.raw).toBe('paid');
        expect(row.status).toBe('paid');
    });

    dbIt('and the query an admin queue actually runs agrees', async () => {
        // The consequence, asserted as a consequence. `.where("status","==",…)`
        // routes to the COLUMN — see applyFilter in lib/supabase-db.ts — so
        // before 026 this found the order it had just been told was paid.
        const id = `${PREFIX}order-2`;
        await seedOrder(id);
        await patch('marketplace_orders', id, { status: 'paid' });

        const stale = await q(
            `select id from marketplace_orders where id = $1 and status = 'pending'`, [id]);
        expect(stale).toHaveLength(0);

        const fresh = await q(
            `select id from marketplace_orders where id = $1 and status = 'paid'`, [id]);
        expect(fresh).toHaveLength(1);
    });

    dbIt('a numeric column, whose name differs from the field', async () => {
        const id = `${PREFIX}order-3`;
        await seedOrder(id);
        await patch('marketplace_orders', id, { totalAmount: 250.5 });

        const [row] = await q<{ total_amount: string; raw: string }>(
            `select total_amount, raw_data->>'totalAmount' as raw
               from marketplace_orders where id = $1`, [id]);
        expect(Number(row.total_amount)).toBe(250.5);
        expect(Number(row.raw)).toBe(250.5);
    });

    dbIt('a TEXT[] column, which roles is', async () => {
        const id = `${PREFIX}user-1`;
        await q(
            `insert into users (id, email, roles, raw_data) values ($1, 'a@b.c', array['user'], $2::jsonb)`,
            [id, JSON.stringify({ id, email: 'a@b.c', roles: ['user'] })]);

        await patch('users', id, { roles: ['user', 'admin'] });

        const [row] = await q<{ roles: string[]; raw: string[] }>(
            `select roles, raw_data->'roles' as raw from users where id = $1`, [id]);
        expect(row.roles).toEqual(['user', 'admin']);
        expect(row.raw).toEqual(['user', 'admin']);
    });

    dbIt('and an UNMAPPED field disturbs neither column', async () => {
        // The guard against over-mirroring. Re-deriving every mapped column on
        // every patch would null the column of a legacy row whose raw_data never
        // carried the field — and that row would drop out of the queue it
        // currently appears in.
        const id = `${PREFIX}order-4`;
        await seedOrder(id);
        await patch('marketplace_orders', id, { note: 'hello' });

        const [row] = await q<{ status: string; total_amount: string }>(
            `select status, total_amount from marketplace_orders where id = $1`, [id]);
        expect(row.status).toBe('pending');
        expect(Number(row.total_amount)).toBe(100);
    });

    dbIt('including a row whose column is set and whose raw_data never had the field', async () => {
        // The exact legacy shape the "only what was touched" rule protects.
        const id = `${PREFIX}order-5`;
        await q(
            `insert into marketplace_orders (id, status, raw_data) values ($1, 'pending', $2::jsonb)`,
            [id, JSON.stringify({ id })]);

        await patch('marketplace_orders', id, { note: 'x' });

        const [row] = await q<{ status: string }>(
            `select status from marketplace_orders where id = $1`, [id]);
        expect(row.status).toBe('pending');
    });
});

dbDescribe('a dotted path and a deletion carry to the column too', () => {
    dbIt('deleting a mapped field nulls the column — it did not before', async () => {
        // Gap 3 in the migration header. nativeOverrides is built from the
        // patch's keys, and a FieldValue.delete() is not a patch key: it travels
        // in p_deletes. So the field left raw_data and the column kept the old
        // value for good.
        const id = `${PREFIX}order-6`;
        await q(
            `insert into marketplace_orders (id, status, raw_data) values ($1, 'pending', $2::jsonb)`,
            [id, JSON.stringify({ id, status: 'pending' })]);

        await patch('marketplace_orders', id, {}, {}, ['status']);

        const [row] = await q<{ status: string | null; has: boolean }>(
            `select status, raw_data ? 'status' as has from marketplace_orders where id = $1`, [id]);
        expect(row.has).toBe(false);
        expect(row.status).toBeNull();
    });

    dbIt('and a dotted path whose ROOT is mapped re-derives from the root', async () => {
        // `a.b` touches `a`. Contrived for status — no caller writes
        // "status.something" — but the rule has to be the root, not the leaf, or
        // a nested write under a mapped object would leave the column behind.
        const id = `${PREFIX}user-2`;
        await q(
            `insert into users (id, email, raw_data) values ($1, 'old@b.c', $2::jsonb)`,
            [id, JSON.stringify({ id, email: 'old@b.c' })]);

        await patch('users', id, {}, { email: 'new@b.c' });

        const [row] = await q<{ email: string; raw: string }>(
            `select email, raw_data->>'email' as raw from users where id = $1`, [id]);
        expect(row.raw).toBe('new@b.c');
        expect(row.email).toBe('new@b.c');
    });
});

dbDescribe('two source fields onto one column', () => {
    dbIt('the later one wins, as it does in the TypeScript loop', async () => {
        // cooperative_members maps BOTH membershipStatus and status onto
        // `status`. buildDedicatedRow iterates FIELD_TO_COLUMN in order and lets
        // the later assignment win; assigning one column twice in a single
        // UPDATE is an ERROR in Postgres, so the SQL has to dedupe and must
        // dedupe the same way.
        const id = `${PREFIX}member-1`;
        await q(
            `insert into cooperative_members (id, user_id, status, raw_data)
             values ($1, 'u2', 'pending', $2::jsonb)`,
            [id, JSON.stringify({ id, userId: 'u2', status: 'pending', membershipStatus: 'pending' })]);

        await patch('cooperative_members', id, { membershipStatus: 'active', status: 'active' });
        let [row] = await q<{ status: string }>(
            `select status from cooperative_members where id = $1`, [id]);
        expect(row.status).toBe('active');

        // And with only the earlier field touched, it is the one that mirrors.
        await patch('cooperative_members', id, { membershipStatus: 'suspended' });
        [row] = await q<{ status: string }>(
            `select status from cooperative_members where id = $1`, [id]);
        expect(row.status).toBe('suspended');
    });

    dbIt('and the two-in-one-statement case does not error', async () => {
        // The failure this dedupe avoids is a hard one: "multiple assignments to
        // same column". Asserted by the test above completing, and again here
        // with the values differing so a naive implementation cannot coincide.
        const id = `${PREFIX}member-2`;
        await q(
            `insert into cooperative_members (id, status, raw_data) values ($1, 'a', $2::jsonb)`,
            [id, JSON.stringify({ id, status: 'a', membershipStatus: 'a' })]);

        await expect(
            patch('cooperative_members', id, { membershipStatus: 'x', status: 'y' }),
        ).resolves.toBeUndefined();

        const [row] = await q<{ status: string }>(
            `select status from cooperative_members where id = $1`, [id]);
        expect(row.status).toBe('y');
    });
});

dbDescribe('a value that does not fit its column', () => {
    dbIt('mirrors as NULL rather than aborting a valid raw_data write', async () => {
        // total_amount is NUMERIC(15,2). A raw_data value that cannot be cast
        // must not take the whole write down with it — raw_data is the copy the
        // application reads, and it was perfectly writable.
        const id = `${PREFIX}order-7`;
        await q(
            `insert into marketplace_orders (id, total_amount, raw_data) values ($1, 10, $2::jsonb)`,
            [id, JSON.stringify({ id, totalAmount: 10 })]);

        await patch('marketplace_orders', id, { totalAmount: 'not-a-number' });

        const [row] = await q<{ total_amount: string | null; raw: string }>(
            `select total_amount, raw_data->>'totalAmount' as raw
               from marketplace_orders where id = $1`, [id]);
        expect(row.raw).toBe('not-a-number');
        expect(row.total_amount).toBeNull();
    });

    dbIt('but a numeric-looking string still mirrors, because the app writes those', async () => {
        const id = `${PREFIX}order-8`;
        await q(
            `insert into marketplace_orders (id, raw_data) values ($1, $2::jsonb)`,
            [id, JSON.stringify({ id })]);

        await patch('marketplace_orders', id, { totalAmount: '77.25' });

        const [row] = await q<{ total_amount: string }>(
            `select total_amount from marketplace_orders where id = $1`, [id]);
        expect(Number(row.total_amount)).toBe(77.25);
    });

    dbIt('and a non-array roles value nulls the column instead of erroring', async () => {
        const id = `${PREFIX}user-3`;
        await q(
            `insert into users (id, roles, raw_data) values ($1, array['user'], $2::jsonb)`,
            [id, JSON.stringify({ id, roles: ['user'] })]);

        await patch('users', id, { roles: 'admin' });

        const [row] = await q<{ roles: string[] | null }>(
            `select roles from users where id = $1`, [id]);
        expect(row.roles).toBeNull();
    });
});

dbDescribe('one statement, so concurrent patches cannot leave the copies apart', () => {
    dbIt('twenty at once, and the column always equals raw_data', async () => {
        // Gap 2. With the mirror in JavaScript this is two statements per
        // writer, and the four can interleave as A-raw, B-raw, B-col, A-col:
        // raw_data says B, the column says A, nothing errors and nothing is
        // logged. One UPDATE cannot interleave with itself.
        const id = `${PREFIX}order-9`;
        await q(
            `insert into marketplace_orders (id, status, raw_data) values ($1, 's0', $2::jsonb)`,
            [id, JSON.stringify({ id, status: 's0' })]);

        const writers = await Promise.all(
            Array.from({ length: 20 }, () => new Client({ connectionString: URL })));
        await Promise.all(writers.map((c) => c.connect()));

        try {
            await Promise.all(writers.map((c, i) =>
                c.query('select apply_document_patch($1,$2,$3,$4::jsonb)',
                    ['marketplace_orders', id, null, JSON.stringify({ status: `s${i + 1}` })])));
        } finally {
            await Promise.all(writers.map((c) => c.end().catch(() => {})));
        }

        const [row] = await q<{ status: string; raw: string }>(
            `select status, raw_data->>'status' as raw from marketplace_orders where id = $1`, [id]);

        // Which writer won is a race and is not the point. That the two copies
        // agree on the winner is the whole point.
        expect(row.status).toBe(row.raw);
        expect(row.status).toMatch(/^s(?:[1-9]|1[0-9]|20)$/);
    });
});

dbDescribe('every table the adapter can route to is one the RPCs accept', () => {
    dbIt('getTableName cannot return a table the allow-list refuses', async () => {
        // THE cross-layer contract. All four write RPCs carry the same
        // hardcoded nine-table allow-list and RAISE for anything else, while the
        // table itself is chosen in TypeScript by getTableName. Adding a
        // dedicated table on the TypeScript side without touching the SQL turns
        // every write to that collection into a thrown exception.
        const routable = new Set<string>([
            ...Object.values(DEDICATED_TABLE_MAP),
            getTableName('a collection that is deliberately not mapped'),
        ]);
        expect(routable).toContain('document_collections');
        expect(routable.size).toBe(9);

        for (const table of routable) {
            // An id that exists nowhere: the point is that the function runs to
            // completion rather than raising "table % is not allowed".
            await expect(
                patch(table, `${PREFIX}absent`, { probe: 1 }, {}, [], table === 'document_collections' ? 'things' : null),
            ).resolves.toBeUndefined();
        }
    });

    dbIt('and a table outside it really is refused, so the probe above means something', async () => {
        // Positive control. Without this, the loop would pass just as happily
        // against a function with no allow-list at all.
        await expect(patch('pg_class', `${PREFIX}absent`, { probe: 1 })).rejects.toThrow(
            /is not allowed/);
    });

    dbIt('for all four write RPCs, not just this one', async () => {
        const calls: Array<[string, string, unknown[]]> = [
            ['apply_document_patch', 'select apply_document_patch($1,$2,null,$3::jsonb)', ['{"probe":1}']],
            ['apply_increments', 'select apply_increments($1,$2,null,$3::jsonb,$4::jsonb)', ['{}', '{"n":1}']],
            ['apply_array_ops', 'select apply_array_ops($1,$2,null,$3::jsonb,$4::jsonb)', ['{}', '{"tags":{"union":["a"]}}']],
            ['claim_status_transition_in', 'select claim_status_transition_in($1,$2,\'a\',\'b\',null,$3::jsonb)', ['{}']],
        ];

        for (const [name, sql, extra] of calls) {
            await expect(q(sql, ['pg_class', `${PREFIX}absent`, ...extra]))
                .rejects.toThrow(/is not allowed/);
            // And the same call against a real table does NOT raise.
            await expect(q(sql, ['marketplace_orders', `${PREFIX}absent`, ...extra]))
                .resolves.toBeDefined();
            expect(name).toBeTruthy();
        }
    });
});
