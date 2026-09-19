/**
 * @jest-environment node
 */

/**
 *   #904 (SECOND CAUSE) — THE SUPERSESSION POINTER, READ THE OTHER WAY.
 *
 *   A seller's own screens now ask which profile ids point AT them, so a
 *   listing filed under a profile they no longer sign in as is theirs again.
 *   Every reader before this walked `_migratedTo` forward, by primary key.
 *   Backward it is a WHERE on a JSONB path, and this database has already paid
 *   for that once — 033's header, on the other pointer field:
 *
 *       "that field lives inside raw_data with no index, and #465 measured what
 *        querying it costs — `canceling statement due to statement timeout`."
 *
 *   Migration 042 is the same index on `_migratedTo`. This suite is what says
 *   042 does what it claims, asked of a real planner rather than read off the
 *   SQL — on enough rows that a sequential scan is not simply the cheaper plan.
 *
 *   THE PAIR MATTERS AS MUCH AS EITHER HALF. `resolveOwnedUserIds` queries BOTH
 *   pointer fields on every level, because a row links itself by `_migratedTo`
 *   (the #724 tool, user-migration.ts) or by `supabaseAuthId` alone. After 033
 *   one of the two was an index scan. A suite that checked only the new index
 *   would not notice the screen still doing a full scan per load.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-postgres.sh start
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:55432/app npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { dbDescribe, restDescribe, assertRestReachable } from '@/lib/testing/pg-harness';
import { supabaseDb } from '@/lib/supabase-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { filterByOwner } from '@/lib/owned-profile-ids';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

/** Every row this suite writes is tagged, so cleanup cannot reach a real one. */
const TAG = 'pg904b';

const MIGRATION_042 = 'supabase/migrations/042_users_migrated_to_index.sql';

const sql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/**
 * The migration's STATEMENTS, with its `--` prose removed.
 *
 * 042 explains at length why it does NOT use CONCURRENTLY, so an assertion
 * that the file does not contain those words matches that sentence and fails a
 * correct migration — the trap #651 recorded.
 */
const statements = (file: string) =>
    sql(file).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

async function clearProbeRows(): Promise<void> {
    await client!.query('delete from public.users where id like $1', [`${TAG}-%`]);
    //   #673 A DELETE DOES NOT TELL THE PLANNER. This suite inserts 50,000 rows
    //   and ANALYZEs; leaving the statistics behind would hand the next suite a
    //   table the planner believes is fifty thousand rows larger than it is.
    await client!.query('analyze public.users');
}

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();

    await c.query(sql(MIGRATION_042));

    /*
     *   THE SHAPE #489 MEASURED ON: 50,000 profiles, a tenth of them carrying
     *   the pointer. Fewer rows and the planner would choose a sequential scan
     *   whatever indexes exist, and "it used the index" would be a statement
     *   about the row count rather than about the index.
     */
    await c.query(
        `insert into public.users (id, email, raw_data)
         select $1 || g, $1 || g || '@e.com',
                case when g % 10 = 0
                     then jsonb_build_object('_migratedTo', $1 || (g + 1),
                                             'supabaseAuthId', $1 || (g + 1))
                     else jsonb_build_object('supabaseAuthId', $1 || g) end
           from generate_series(1, 50000) g
         on conflict (id) do nothing`,
        [`${TAG}-u`],
    );
    await c.query('analyze public.users');
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** How the planner says it will answer the backward lookup on `field`. */
async function planFor(field: string): Promise<string> {
    const { rows } = await client!.query(
        `explain select id from public.users where raw_data->>'${field}' = $1`,
        [`${TAG}-u4001`],
    );
    return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#904 — 042 makes the backward pointer search a keyed lookup', () => {
    it('THE NEW HALF: `_migratedTo` uses an index, not a scan', async () => {
        const plan = await planFor('_migratedTo');

        expect(plan).toContain('idx_users_migrated_to');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it('AND THE HALF 033 ALREADY DID — both, or the screen still scans', async () => {
        const plan = await planFor('supabaseAuthId');

        expect(plan).toContain('idx_users_supabase_auth_id');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it('AND THE MEASUREMENT IS NOT VACUOUS — without it, this is a scan', async () => {
        /*
         *   The control that gives the assertion above its meaning. Dropped and
         *   rebuilt inside one test so the suite leaves the schema as it found
         *   it.
         */
        await client!.query('drop index if exists idx_users_migrated_to');
        try {
            expect(await planFor('_migratedTo')).toContain('Seq Scan');
        } finally {
            await client!.query(sql(MIGRATION_042));
        }
        expect(await planFor('_migratedTo')).toContain('idx_users_migrated_to');
    }, 300_000);

    it('AND THE INDEX IS VALID — one that exists is not one that works', async () => {
        const { rows } = await client!.query(
            `select i.indisvalid
               from pg_class c join pg_index i on i.indexrelid = c.oid
              where c.relname = 'idx_users_migrated_to'`,
        );
        expect(rows).toEqual([{ indisvalid: true }]);
    }, 300_000);

    it('AND IT INDEXES ONLY THE ROWS THAT CARRY THE POINTER', async () => {
        //   A btree does not index NULLs, which is what keeps the cost
        //   proportional to the superseded rows rather than to every profile.
        //   Claimed in the migration's header; asked here.
        const { rows } = await client!.query(
            `select count(*)::int as carrying from public.users
              where id like $1 and raw_data ? '_migratedTo'`,
            [`${TAG}-%`],
        );
        expect(rows[0].carrying).toBe(5000);

        const { rows: size } = await client!.query(
            `select pg_relation_size('idx_users_migrated_to') as bytes`,
        );
        //   Far below what indexing all 50,000 would cost — the claim, not a
        //   fixed number, because page packing is not a promise.
        expect(Number(size[0].bytes)).toBeLessThan(1_500_000);
    }, 300_000);

    it('AND THE FILE APPLIES INSIDE A TRANSACTION — #469, which cost a whole migration', async () => {
        /*
         *   027's header records the last time: a CONCURRENTLY migration "could
         *   not be applied by the SQL Editor ... AND IT SAT UNAPPLIED". The
         *   Editor always opens a transaction and CONCURRENTLY cannot run in
         *   one, so applicability is a property of the migration and is
         *   asserted like one.
         */
        let refusal: string | null = null;
        await client!.query('begin');
        try {
            await client!.query(sql(MIGRATION_042));
        } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
        } finally {
            await client!.query('rollback');
        }

        //   Asserted, not merely "did not throw": a test whose only outcome is
        //   an absent exception passes when its own setup is skipped.
        expect(refusal).toBeNull();
        expect(statements(MIGRATION_042)).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        //   …and the prose is not empty, so the strip cannot pass by deleting everything.
        expect(statements(MIGRATION_042)).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }, 300_000);

    it('AND RE-RUNNING IT CHANGES NOTHING', async () => {
        await client!.query(sql(MIGRATION_042));
        await client!.query(sql(MIGRATION_042));

        const { rows } = await client!.query(
            `select count(*)::int as n from pg_class where relname = 'idx_users_migrated_to'`,
        );
        expect(rows[0].n).toBe(1);
    }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * AND THE WIDENED FILTER, THROUGH THE ADAPTER THE SCREENS ACTUALLY USE.
 *
 * Everything above is SQL. `filterByOwner` emits `.where(field, "in", [...])`
 * on a JSONB path, and that travels through lib/supabase-db.ts to PostgREST —
 * a layer neither the unit suites (which mock it) nor the SQL above can reach.
 *
 * #651 is the finding that this directory mixed the two requirements under one
 * config and, as a result, the adapter suites had never run. This one says so
 * in its own gate: without PostgREST it skips, loudly, rather than passing.
 */
restDescribe('#904 — the widened owner filter, through the real adapter', () => {
    beforeAll(assertRestReachable);

    const COLL = COLLECTIONS.LAND_LISTINGS;
    const LIVE = `${TAG}-live`;
    const OLD = `${TAG}-superseded`;
    const OTHER = `${TAG}-stranger`;

    /**
     *   #673 A DELETE DOES NOT TELL THE PLANNER. document_collections is SHARED
     *   by every untyped collection, so leaving this suite's rows in the
     *   statistics hands the next suite a table the planner misjudges — and the
     *   pg directory is full of suites whose whole claim is a query plan.
     */
    const clearListings = async () => {
        await client!.query(
            `delete from public.document_collections where id like $1`, [`${TAG}-l%`]);
        await client!.query('analyze public.document_collections');
    };

    beforeAll(async () => {
        await clearListings();
        await client!.query(
            `insert into public.document_collections (id, collection_name, raw_data)
             values ($1,$4,$5::jsonb), ($2,$4,$6::jsonb), ($3,$4,$7::jsonb)`,
            [
                `${TAG}-l-old`, `${TAG}-l-live`, `${TAG}-l-other`, COLL,
                JSON.stringify({ id: `${TAG}-l-old`, ownerId: OLD }),
                JSON.stringify({ id: `${TAG}-l-live`, ownerId: LIVE }),
                JSON.stringify({ id: `${TAG}-l-other`, ownerId: OTHER }),
            ],
        );
    }, 300_000);

    afterAll(async () => {
        await clearListings().catch(() => {});
    }, 300_000);

    const idsFrom = async (owners: string[]) => {
        const snap = await filterByOwner(
            supabaseDb.collection(COLL) as any, 'ownerId', owners,
        ).get();
        return (snap.docs as any[]).map((d) => d.id).filter((id: string) => id.startsWith(TAG)).sort();
    };

    it('ONE ID STILL READS EXACTLY ITS OWN ROWS — the unchanged common case', async () => {
        expect(await idsFrom([LIVE])).toEqual([`${TAG}-l-live`]);
    }, 300_000);

    it('THE REPORTED CASE: two ids read BOTH, through a real `in`', async () => {
        //   The whole widening, end to end: an `in` over a JSONB path, built by
        //   filterByOwner, translated by the adapter, answered by PostgREST.
        expect(await idsFrom([LIVE, OLD]))
            .toEqual([`${TAG}-l-live`, `${TAG}-l-old`]);
    }, 300_000);

    it('AND IT DOES NOT BECOME "EVERY ROW" — the control', async () => {
        /*
         *   An adapter that dropped an unsupported filter would return the
         *   whole collection, and both assertions above would still look right
         *   on a table holding only this suite's rows. The stranger's listing
         *   is what tells those two apart.
         */
        expect(await idsFrom([LIVE, OLD])).not.toContain(`${TAG}-l-other`);
        expect(await idsFrom([OTHER])).toEqual([`${TAG}-l-other`]);
    }, 300_000);
});
