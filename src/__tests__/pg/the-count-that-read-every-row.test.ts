/**
 * @jest-environment node
 */

/**
 *   #960 THE COUNT BEHIND "TOTAL USERS — UNAVAILABLE", AND THE PLAN THAT SAYS
 *        IT NO LONGER READS THE WHOLE TABLE.
 *
 *   THE OWNER, from the live admin dashboard: "we fixed this and its repeating".
 *
 *       Total Users      Unavailable   Could not be read — retry shortly
 *       Active Users     1,034         Logged in recently
 *       Total Revenue    Unavailable   Could not reach Paystack or the database
 *       Pending Escrows  3             Requires attention
 *
 *   It is repeating, and the-two-user-scans-that-timed-out already describes the
 *   shape exactly: a filter on a key inside `raw_data`, which is not a native
 *   column, so Postgres reads and detoasts every row of a 42,845-row, 106 MB
 *   table to evaluate it. Production logs 57014 — statement_timeout — against
 *   `users`.
 *
 *   That finding fixed three such sites. lib/user-population.ts countLivePeople
 *   has two more, and unlike the admin search box or the GDPR purge they run on
 *   EVERY admin dashboard load:
 *
 *       query.count().get()                                     -- read 1
 *       query.where("deleted", "==", true).count().get()         -- read 2
 *       query.where("_migratedTo", "!=", "")
 *            .select("_migratedTo", "deleted").all().get()       -- read 3
 *
 *   #747 and #804 added reads 2 and 3 while building the tombstone subtraction,
 *   AFTER the timeout finding shipped. Nothing was wrong with either change; the
 *   indexes simply never followed, and the earlier fix's own record explains why
 *   nobody noticed — lib/migration-manifest: "NOTHING APPLIES THESE MIGRATIONS
 *   TO PRODUCTION … CI runs them against a throwaway cluster, so every suite is
 *   green against a database that has all of them."
 *
 * ── WHY THIS ASSERTS A PLAN AND NOT A DURATION ──────────────────────────────
 *
 *   the-two-user-scans-that-timed-out settled this and the reasoning is
 *   unchanged: "A millisecond threshold on shared CI hardware is a flake
 *   generator, and it would not even be measuring the right thing: what changed
 *   is that Postgres stopped reading the whole table, and 'Index Scan' is the
 *   direct statement." A test that fails on a correct plan teaches everybody to
 *   ignore it.
 *
 *   The timings that motivated 053 are in its header, measured on a 42,845-row
 *   seed with every prior migration applied: read 2 went 39.8 ms Seq Scan ->
 *   1.0 ms Index Only Scan, read 3 went 33.9 ms Seq Scan -> 0.6 ms Bitmap Index
 *   Scan. Those are recorded there, where a number can age without breaking a
 *   build.
 *
 * ── THE PART THAT IS NOT OBVIOUS, AND IS THEREFORE WORTH A TEST ─────────────
 *
 *   042 ALREADY INDEXES `_migratedTo`, and read 3 was scanning anyway. The index
 *   is not partial, and Postgres will not use a plain btree to satisfy `<>`
 *   against a scalar — walking the whole index is no cheaper than walking the
 *   table. A PARTIAL index IS used, because `<>` is strict and so
 *   `raw_data->>'_migratedTo' <> ''` implies `IS NOT NULL`, which is the index's
 *   predicate; Postgres proves the implication and uses it.
 *
 *   That is a fact about the planner rather than about this codebase, so it is
 *   asserted against a real one. The negative control below builds the
 *   NON-partial index alone and shows the scan, so "the partial one is doing the
 *   work" is measured rather than assumed.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

const TABLE = 'live_people_count_probe';

/** Enough rows for the planner to prefer an index; small enough to seed fast. */
const ROWS = 8000;
/** One row in fifty is erased, one in three hundred carries a pointer. */
const ERASED_EVERY = 50;
const POINTING_EVERY = 300;

let client: Client | null = null;

beforeAll(async () => {
    const c = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    try {
        await c.connect();
    } catch {
        return;
    }
    client = c;

    await c.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await c.query(`CREATE TABLE ${TABLE} (id text PRIMARY KEY, raw_data jsonb)`);

    /*
     *   The filler payload is the point, not decoration. Without it `raw_data`
     *   stays small, a sequential scan is cheap, and the planner may prefer one
     *   even with a perfectly good index — so the comparison would not be the
     *   one production is making. 106 MB over 42,845 rows is ~2.5 KB a row.
     */
    await c.query(
        `INSERT INTO ${TABLE} (id, raw_data)
         SELECT 'u' || i,
                jsonb_build_object(
                    'id', 'u' || i,
                    'email', 'u' || i || '@example.com',
                    'roles', jsonb_build_array('general_user'),
                    'bio', repeat('x', 2000)
                )
                || CASE WHEN i % $1 = 0
                        THEN jsonb_build_object('deleted', true) ELSE '{}'::jsonb END
                || CASE WHEN i % $2 = 0
                        THEN jsonb_build_object('_migratedTo', 'u' || (i + 1)) ELSE '{}'::jsonb END
         FROM generate_series(1, $3) i`,
        [ERASED_EVERY, POINTING_EVERY, ROWS],
    );
    await c.query(`ANALYZE ${TABLE}`);
}, 180000);

afterAll(async () => {
    if (!client) return;
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.end();
});

/** The plan for one query, as one string. */
async function plan(sql: string): Promise<string> {
    const res = await client!.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    return res.rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
}

const dropIndexes = async () => {
    for (const name of [
        `${TABLE}_deleted_true`, `${TABLE}_migrated_present`, `${TABLE}_migrated_full`,
    ]) {
        await client!.query(`DROP INDEX IF EXISTS ${name}`);
    }
    await client!.query(`ANALYZE ${TABLE}`);
};

/*
 *   The two queries EXACTLY as lib/supabase-db.ts emits them for
 *   countLivePeople's calls. applyJsonbFilter:
 *
 *       case '==':  return query.eq(jsonPath, String(value));
 *       case '!=':  return query.neq(jsonPath, String(value));
 *
 *   so `true` becomes the TEXT 'true' and `""` becomes ''. A partial index is
 *   used only when the query's predicate implies the index's, so these literals
 *   are the whole reason the indexes work — which is why they are written here
 *   rather than paraphrased.
 */
const ERASED_COUNT = `SELECT count(*) FROM ${TABLE} WHERE raw_data->>'deleted' = 'true'`;
const POINTING_READ =
    `SELECT raw_data->>'_migratedTo', raw_data->>'deleted' `
    + `FROM ${TABLE} WHERE raw_data->>'_migratedTo' <> ''`;

dbDescribe('#960 — the two reads that scanned the whole users table', () => {
    it('THE DEFECT: both read every row when nothing indexes them', async () => {
        await dropIndexes();

        expect(await plan(ERASED_COUNT)).toMatch(/Seq Scan/);
        expect(await plan(POINTING_READ)).toMatch(/Seq Scan/);
    }, 120000);

    it('NEITHER INDEX ALONE FIXES THE POINTER READ — both are load-bearing', async () => {
        /*
         *   THE MEASUREMENT THAT CORRECTED THIS FINDING. 053's first draft said
         *   042's non-partial index was redundant now; running it said otherwise,
         *   and the three states are asserted here so nobody removes either one
         *   on the reasoning that first draft used.
         *
         *     partial only    Seq Scan   — the index CAN answer the query and the
         *                                  planner will not choose it. With it
         *                                  alone the estimate was rows=7,960
         *                                  against an actual 26: a bare JSONB
         *                                  expression carries no statistics, so
         *                                  `<> ''` looks like it matches almost
         *                                  everything.
         *     042 only        Seq Scan   — a plain btree cannot serve `<>` against
         *                                  a scalar any more cheaply than the
         *                                  table can.
         *     both            Index Scan — 042 supplies the selectivity estimate
         *                                  (051's header: "an expression index
         *                                  carries statistics a bare JSONB
         *                                  expression does not"), the partial one
         *                                  supplies the access path.
         *
         *   Dropping 042 would return this read to a sequential scan while
         *   leaving behind an index that looks like it should have prevented one,
         *   which is the worst of the three states because it looks fixed.
         */
        const partial = () => client!.query(
            `CREATE INDEX ${TABLE}_migrated_present ON ${TABLE} ((raw_data->>'_migratedTo'))
             WHERE raw_data->>'_migratedTo' IS NOT NULL`);
        const full = () => client!.query(
            `CREATE INDEX ${TABLE}_migrated_full ON ${TABLE} ((raw_data->>'_migratedTo'))`);

        await dropIndexes();
        await partial();
        await client!.query(`ANALYZE ${TABLE}`);
        expect(await plan(POINTING_READ)).toMatch(/Seq Scan/);

        await dropIndexes();
        await full();
        await client!.query(`ANALYZE ${TABLE}`);
        expect(await plan(POINTING_READ)).toMatch(/Seq Scan/);

        await dropIndexes();
        await partial();
        await full();
        await client!.query(`ANALYZE ${TABLE}`);
        const both = await plan(POINTING_READ);
        //   `<> ''` is strict, so it implies the partial index's IS NOT NULL.
        //   This asserts Postgres proves that AND picks it, which together are
        //   the load-bearing claim.
        expect(both).toMatch(new RegExp(`Index Scan using ${TABLE}_migrated_present|Bitmap Index Scan on ${TABLE}_migrated_present`));
        expect(both).not.toMatch(/Seq Scan/);
    }, 180000);

    it('THE FIX, in the production shape: both reads become index reads', async () => {
        await dropIndexes();
        //   Byte-for-byte the predicates in 053, plus 042's index, which is what
        //   the real `users` table has.
        await client!.query(
            `CREATE INDEX ${TABLE}_deleted_true ON ${TABLE} ((raw_data->>'deleted'))
             WHERE raw_data->>'deleted' = 'true'`);
        await client!.query(
            `CREATE INDEX ${TABLE}_migrated_present ON ${TABLE} ((raw_data->>'_migratedTo'))
             WHERE raw_data->>'_migratedTo' IS NOT NULL`);
        await client!.query(
            `CREATE INDEX ${TABLE}_migrated_full ON ${TABLE} ((raw_data->>'_migratedTo'))`);
        await client!.query(`ANALYZE ${TABLE}`);

        const erased = await plan(ERASED_COUNT);
        expect(erased).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
        expect(erased).not.toMatch(/Seq Scan/);

        const pointing = await plan(POINTING_READ);
        expect(pointing).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
        expect(pointing).not.toMatch(/Seq Scan/);
    }, 120000);

    it('AND THEY STILL RETURN THE RIGHT ROWS, which a plan does not check', async () => {
        /*
         *   A plan assertion can pass over a wrong answer: a partial index whose
         *   predicate is narrower than the query's would be used and would miss
         *   rows. So the counts are checked against the seeded distribution, with
         *   the indexes in place.
         */
        const erased = await client!.query(ERASED_COUNT);
        expect(Number(erased.rows[0].count)).toBe(Math.floor(ROWS / ERASED_EVERY));

        const pointing = await client!.query(POINTING_READ);
        expect(pointing.rowCount).toBe(Math.floor(ROWS / POINTING_EVERY));
    }, 120000);

    it('READ 1 IS LEFT ALONE, and this records why rather than leaving it unexplained', async () => {
        /*
         *   `count(*)` with no predicate scans, and no index makes an exact count
         *   of a whole table cheaper than reading its row headers. It is also the
         *   CHEAP one of the three: count(*) needs no column value, so it never
         *   detoasts raw_data — which is the entire cost of the other two.
         *
         *   Asserted so that "read 1 still scans" is a recorded decision instead
         *   of an oversight somebody later tries to fix with a fourth index.
         */
        expect(await plan(`SELECT count(*) FROM ${TABLE}`)).toMatch(/Seq Scan|Index Only Scan/);
    }, 120000);
});
