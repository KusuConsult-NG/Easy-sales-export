/**
 * @jest-environment node
 */

/**
 *   THE TWO `users` SCANS THAT TIMED OUT, AND THE PLAN THAT SAYS THEY DO NOT.
 *
 *   THE OWNER: "fix the users table statement timeouts."
 *
 *   Production logs report 57014 — statement_timeout — against `users` from
 *   three places. 044 and 045 dealt with module_registration_counts. These are
 *   the other two, and both are the same shape: a filter on a key inside
 *   `raw_data`, which is not a native column, so Postgres reads and detoasts
 *   every row in a 42,845-row, 106 MB table to evaluate it.
 *
 *     THE ADMIN SEARCH BOX   searchUserIdsByQuery fires up to SEVENTEEN
 *                            queries for one search. TWELVE are name prefix
 *                            ranges — four case variations across fullName,
 *                            firstName and lastName — and `users` had an
 *                            expression index for the phone half of that
 *                            helper and nothing at all for the name half.
 *
 *     THE GDPR PURGE         `deletedAt <= threshold AND gdprPurgedAt IS NULL`.
 *                            Both inside raw_data, neither indexed.
 *
 *   ── WHY THIS ASSERTS A PLAN AND NOT A DURATION ────────────────────────────
 *
 *   A millisecond threshold on shared CI hardware is a flake generator, and it
 *   would not even be measuring the right thing: what changed is that Postgres
 *   stopped reading the whole table, and "Index Scan" is the direct statement
 *   of that. The durations are in 047's header, measured once, with the buffer
 *   counts that actually explain them.
 *
 *   ── THE SEEDING IS THE HARD PART, AND THE FIRST ATTEMPT GOT IT WRONG ──────
 *
 *   Seeding fullName as 'Member ' || i makes the prefix 'Member 1' match
 *   11,120 of 40,000 rows. The planner then correctly prefers a sequential
 *   scan EVEN WITH THE INDEX, and the measurement says the index is useless.
 *   It is not: the data was wrong. Real names come from a pool, so a prefix
 *   matches a handful of rows out of many. These fixtures use twenty first
 *   names and twenty surnames — the distribution a membership actually has.
 *
 *   A benchmark whose distribution does not resemble the thing it models
 *   measures nothing, and it fails in the direction that looks like a
 *   negative result, which is the direction nobody double-checks.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

const TABLE = 'users_scan_probe';

let client: Client | null = null;

const FIRSTS = [
    'Adedayo', 'Samuel', 'Ibrahim', 'Aminat', 'Fatima',
    'Sanusi', 'Maryam', 'Obi', 'Ipaye', 'Ogungbuyi',
    'Chinedu', 'Ngozi', 'Yusuf', 'Blessing', 'Emeka',
    'Halima', 'Tunde', 'Grace', 'Musa', 'Folake',
];

const LASTS = [
    'Oluwo', 'Olawunmi', 'Abdulkareem', 'Ajibola', 'Almustapha',
    'Adenike', 'Muhammad', 'Chisomaga', 'Michael', 'Rhoda',
    'Okafor', 'Balogun', 'Eze', 'Danjuma', 'Nwosu',
    'Adeyemi', 'Bello', 'Okonkwo', 'Lawal', 'Uche',
];

/** Enough rows for the planner to prefer an index; small enough to seed fast. */
const ROWS = 8000;

beforeAll(async () => {
    const c = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    try {
        await c.connect();
    } catch {
        return;
    }
    client = c;

    await c.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await c.query(`
        CREATE TABLE ${TABLE} (
            id text PRIMARY KEY,
            raw_data jsonb
        )
    `);

    //   raw_data carries a filler payload so the column behaves like the real
    //   one — out of line, detoasted on every evaluation. Without it a
    //   sequential scan is cheap and the comparison is not the one production
    //   is making.
    await c.query(
        `INSERT INTO ${TABLE} (id, raw_data)
         SELECT 'u' || i,
                jsonb_build_object(
                    'firstName', ($1::text[])[(i % 20) + 1],
                    'lastName',  ($2::text[])[((i / 20) % 20) + 1],
                    'fullName',  ($1::text[])[(i % 20) + 1] || ' ' || ($2::text[])[((i / 20) % 20) + 1],
                    'filler',    repeat(md5(i::text), 30)
                )
                || CASE WHEN i % 800 = 0
                        THEN jsonb_build_object('deletedAt', '2026-01-01T00:00:00Z')
                        ELSE '{}'::jsonb END
         FROM generate_series(1, ${ROWS}) AS i`,
        [FIRSTS, LASTS],
    );

    await c.query(`ANALYZE ${TABLE}`);
}, 120_000);

afterAll(async () => {
    if (!client) return;
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.end();
});

/**
 * Does this query read the whole table, or reach it through an index?
 *
 *   "INDEX", NOT "Index Scan", AND THE DIFFERENCE IS NOT PEDANTRY. An earlier
 *   version of this helper asserted the literal node name and failed on a
 *   Bitmap Heap Scan — which IS an index-based plan. Postgres picks between a
 *   plain Index Scan and a bitmap by how many rows it expects: at 40,000 rows
 *   it chose Index Scan, at the 8,000 seeded here it chose bitmap. Both stop
 *   reading the whole table, which is the only thing 047 claims.
 *
 *   Pinning the node name would make this suite fail whenever the table size,
 *   the statistics or a Postgres version nudged that choice — a test that
 *   breaks on a correct plan teaches everybody to ignore it.
 */
async function scanKindFor(sql: string, params: unknown[] = []): Promise<'SEQ' | 'INDEX'> {
    const { rows } = await client!.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const plan = JSON.stringify(rows[0]['QUERY PLAN']);

    const usesIndex = plan.includes('"Index Scan"')
        || plan.includes('"Index Only Scan"')
        || plan.includes('"Bitmap Index Scan"');

    return usesIndex ? 'INDEX' : 'SEQ';
}

dbDescribe('#57014 — the admin search box stops reading the whole users table', () => {
    it('SEQUENTIALLY SCANS A NAME PREFIX WITHOUT THE INDEX', async () => {
        //   The state production is in. This is the control: if it already
        //   used an index the assertion below would prove nothing.
        const kind = await scanKindFor(
            `SELECT id FROM ${TABLE}
              WHERE raw_data->>'fullName' >= 'Adedayo Oluwo'
                AND raw_data->>'fullName' <  'Adedayo Oluwp'
              LIMIT 30`,
        );

        expect(kind).toBe('SEQ');
    });

    it('AND USES AN INDEX SCAN ONCE 047 IS APPLIED', async () => {
        await client!.query(
            `CREATE INDEX IF NOT EXISTS idx_${TABLE}_full_name
                 ON ${TABLE} ((raw_data ->> 'fullName'))`,
        );
        await client!.query(`ANALYZE ${TABLE}`);

        const kind = await scanKindFor(
            `SELECT id FROM ${TABLE}
              WHERE raw_data->>'fullName' >= 'Adedayo Oluwo'
                AND raw_data->>'fullName' <  'Adedayo Oluwp'
              LIMIT 30`,
        );

        expect(kind).toBe('INDEX');
    });

    it('and the range is what the adapter actually emits, not a LIKE', async () => {
        //   supabase-db builds `raw_data->>'field'` and the caller builds the
        //   upper bound with prefixUpperBound, so the predicate is a RANGE. A
        //   plain b-tree serves that on the default collation; `LIKE 'x%'`
        //   would have needed text_pattern_ops, and nothing emits LIKE.
        const kind = await scanKindFor(
            `SELECT id FROM ${TABLE} WHERE raw_data->>'fullName' LIKE 'Adedayo%' LIMIT 30`,
        );

        //   Recorded rather than required: this is the shape the index does
        //   NOT serve, which is why the helper must keep emitting a range.
        expect(kind).toBe('SEQ');
    });
});

dbDescribe('#57014 — the GDPR purge stops reading the whole users table', () => {
    const DUE = `SELECT id FROM ${TABLE}
                  WHERE raw_data->>'deletedAt' <= '2026-06-01T00:00:00Z'
                    AND raw_data->>'gdprPurgedAt' IS NULL
                  LIMIT 100`;

    it('SEQUENTIALLY SCANS FOR ROWS DUE TO PURGE WITHOUT THE INDEX', async () => {
        expect(await scanKindFor(DUE)).toBe('SEQ');
    });

    it('AND USES THE PARTIAL INDEX ONCE 047 IS APPLIED', async () => {
        await client!.query(
            `CREATE INDEX IF NOT EXISTS idx_${TABLE}_gdpr_purge_due
                 ON ${TABLE} ((raw_data ->> 'deletedAt'))
              WHERE raw_data ->> 'deletedAt' IS NOT NULL
                AND raw_data ->> 'gdprPurgedAt' IS NULL`,
        );
        await client!.query(`ANALYZE ${TABLE}`);

        expect(await scanKindFor(DUE)).toBe('INDEX');
    });

    it('and the planner proves `<=` implies NOT NULL, which is what makes it usable', async () => {
        //   The query never says `deletedAt IS NOT NULL`. The index is partial
        //   ON that condition, so it is only usable because Postgres can prove
        //   a strict operator excludes NULL. If that ever stopped holding the
        //   index would be silently ignored and the timeout would return, so
        //   it is asserted rather than assumed.
        const { rows } = await client!.query(
            `EXPLAIN (FORMAT JSON) ${DUE}`,
        );

        expect(JSON.stringify(rows[0]['QUERY PLAN'])).toContain(`idx_${TABLE}_gdpr_purge_due`);
    });

    it('and the partial index is a fraction of the table', async () => {
        //   Indexing on `gdprPurgedAt IS NULL` alone would cover nearly every
        //   row and save nothing — almost nobody has been purged. What is rare
        //   is being soft-deleted, and that is what the predicate selects on.
        const { rows } = await client!.query(
            `SELECT pg_relation_size('idx_${TABLE}_gdpr_purge_due') AS idx,
                    pg_relation_size('${TABLE}')                    AS tbl`,
        );

        expect(Number(rows[0].idx)).toBeLessThan(Number(rows[0].tbl) / 20);
    });
});
