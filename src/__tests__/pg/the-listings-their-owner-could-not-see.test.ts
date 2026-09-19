/**
 * @jest-environment node
 */

/**
 *   #904 THE LISTINGS THAT WERE THERE AND THAT NOBODY COULD REACH.
 *
 *   THE OWNER, twice, across two sessions:
 *
 *       "when they click on my properties nothing is shown"
 *       "My properties are not listed under my property tab"
 *
 * ── THE KEY THE ROW WAS FILED UNDER ─────────────────────────────────────────
 *
 *   /api/farm-nation/create-listing originally wrote the seller onto the
 *   listing as `userId`. Every reader asks for `ownerId`:
 *
 *       land-actions.ts   .where('ownerId', '==', session.user.id)
 *
 *   The route's own note records what that cost: "a listing created here was
 *   invisible to its own owner, never entered the verification queue, and
 *   therefore could never become verified and appear in the marketplace. It
 *   existed and nothing could see it."
 *
 *   THE WRITER WAS FIXED AND THE ROWS WERE NOT. That route writes `ownerId`
 *   today, which helps every listing made after the fix and none of the ones
 *   the owner is looking for. Migration 040 is the other half, and this suite
 *   is what says 040 does what it claims — run against a real PostgreSQL,
 *   because a migration verified by reading it is not verified.
 *
 * ── AND THE INDEX, WHICH IS A SEPARATE FINDING ──────────────────────────────
 *
 *   022 indexed `status` and `userId` on document_collections — "the two that
 *   cover most of the application". Neither is what a seller's own two screens
 *   filter on: My Properties asks for `ownerId` and the seller's product list
 *   asks for `sellerId`, and both collections are generic, so both were
 *   sequential scans of the entire table.
 *
 *   That is 039's finding, not a new one: an unindexed `raw_data->...` filter
 *   is not WRONG, it just grows with the whole table instead of with the
 *   seller's own rows — and a query that eventually times out reaches the
 *   seller as an empty screen, indistinguishable from owning nothing.
 *
 *   MEASURED HERE RATHER THAN ASSERTED: the planner is asked, on enough rows
 *   that a sequential scan is not simply the cheaper plan.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       npm run stack:up
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { dbDescribe as sharedDbDescribe } from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';
const dbDescribe = sharedDbDescribe;

let client: Client | null = null;

/** Every row this suite writes is tagged, so cleanup cannot reach a real one. */
const TAG = 'pg904';
const SELLER = `${TAG}-seller-A`;

const MIGRATION_040 = 'supabase/migrations/040_land_listing_owner_id_backfill.sql';
const MIGRATION_041 = 'supabase/migrations/041_owner_and_seller_expression_indexes.sql';

const sql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/**
 * The migration's STATEMENTS, with its `--` prose removed.
 *
 *   These files explain themselves at length, and 041's explanation is largely
 *   about why it does NOT use CREATE INDEX CONCURRENTLY. An assertion that the
 *   file does not contain those words matched that sentence and failed a
 *   correct migration — the trap #651 recorded, where a YAML comment satisfied
 *   an assertion about the step beneath it.
 */
const statements = (file: string) =>
    sql(file).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

async function clearProbeRows(): Promise<void> {
    await client!.query(
        'delete from public.document_collections where id like $1', [`${TAG}-%`],
    );
    /*
     *   #673 A DELETE DOES NOT TELL THE PLANNER. This suite inserts 20,000 rows
     *   and ANALYZEs so the planner test below is asked a real question; leaving
     *   those statistics behind after removing the rows would hand the NEXT
     *   suite a table the planner believes is twenty thousand rows larger than
     *   it is, and its plan assertions would be answering about this one.
     */
    await client!.query('analyze public.document_collections');
}

/** The listings My Properties would show this seller. */
async function visibleTo(owner: string): Promise<string[]> {
    const { rows } = await client!.query(
        `select id from public.document_collections
          where collection_name = 'land_listings'
            and raw_data->>'ownerId' = $1
          order by id`,
        [owner],
    );
    return rows.map((r) => r.id as string);
}

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    //   A previous interrupted run may have left them.
    await clearProbeRows();
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#904 — 040 gives a seller back the listings filed under the old key', () => {
    beforeEach(async () => {
        await clearProbeRows();
        await client!.query(
            `insert into public.document_collections (id, collection_name, raw_data)
             values
               ($1, 'land_listings',    $7),
               ($2, 'land_listings',    $8),
               ($3, 'land_listings',    $9),
               ($4, 'land_listings',    $10),
               ($5, 'land_listings',    $11),
               ($6, 'academy_progress', $12)`,
            [
                `${TAG}-legacy-1`, `${TAG}-legacy-2`, `${TAG}-modern-1`,
                `${TAG}-transferred`, `${TAG}-orphan`, `${TAG}-other-collection`,
                //   Written by the route BEFORE the fix: `userId` and no owner.
                JSON.stringify({ userId: SELLER, title: 'Legacy plot' }),
                JSON.stringify({ userId: SELLER, title: 'Second legacy plot' }),
                //   Written after the fix: both keys, agreeing.
                JSON.stringify({ ownerId: SELLER, userId: SELLER, title: 'Modern plot' }),
                //   The keys DISAGREE. A listing that changed hands is the row
                //   a careless backfill would hand back to its previous owner.
                JSON.stringify({ ownerId: `${TAG}-seller-B`, userId: SELLER, title: 'Transferred' }),
                //   Neither key. Nobody can say whose this is.
                JSON.stringify({ title: 'No owner at all' }),
                //   `userId` is a legitimate key across the whole database. A
                //   sweep that is not scoped to land listings invents an
                //   `ownerId` on every other collection on the platform.
                JSON.stringify({ userId: SELLER }),
            ],
        );
    }, 300_000);

    it('THE REPORTED CASE: before, the seller sees one of their three', async () => {
        expect(await visibleTo(SELLER)).toEqual([`${TAG}-modern-1`]);
    }, 300_000);

    it('AND AFTER THE MIGRATION, ALL THREE', async () => {
        await client!.query(sql(MIGRATION_040));

        expect(await visibleTo(SELLER)).toEqual([
            `${TAG}-legacy-1`, `${TAG}-legacy-2`, `${TAG}-modern-1`,
        ]);
    }, 300_000);

    it('AND THE TRANSFERRED LISTING IS NOT HANDED BACK — the control', async () => {
        /*
         *   The half that would make this a theft rather than a repair. The row
         *   has BOTH keys and they disagree, which is what a sale looks like
         *   after the fact. `NOT (raw_data ? 'ownerId')` is the clause that
         *   keeps it: an existing owner is never overwritten.
         */
        await client!.query(sql(MIGRATION_040));

        const { rows } = await client!.query(
            `select raw_data->>'ownerId' as owner from public.document_collections where id = $1`,
            [`${TAG}-transferred`],
        );
        expect(rows[0].owner).toBe(`${TAG}-seller-B`);
        expect(await visibleTo(SELLER)).not.toContain(`${TAG}-transferred`);
    }, 300_000);

    it('AND A LISTING NAMING NOBODY IS LEFT NAMING NOBODY', async () => {
        //   Guessing an owner for a parcel of land hands somebody's property to
        //   the wrong account. 040 reports these and changes none.
        await client!.query(sql(MIGRATION_040));

        const { rows } = await client!.query(
            `select (raw_data ? 'ownerId') as has_owner
               from public.document_collections where id = $1`,
            [`${TAG}-orphan`],
        );
        expect(rows[0].has_owner).toBe(false);
    }, 300_000);

    it('AND NO OTHER COLLECTION IS TOUCHED', async () => {
        await client!.query(sql(MIGRATION_040));

        const { rows } = await client!.query(
            `select (raw_data ? 'ownerId') as has_owner
               from public.document_collections where id = $1`,
            [`${TAG}-other-collection`],
        );
        expect(rows[0].has_owner).toBe(false);
    }, 300_000);

    it('AND `userId` IS KEPT, UNLIKE 023', async () => {
        /*
         *   023 could DELETE its stray key because nothing but the defect wrote
         *   it. `userId` is a real field, it is still written deliberately by
         *   that route, and idx_dc_collection_user is an index on it. 040 adds
         *   a key and removes none.
         */
        await client!.query(sql(MIGRATION_040));

        const { rows } = await client!.query(
            `select raw_data->>'userId' as user_id from public.document_collections where id = $1`,
            [`${TAG}-legacy-1`],
        );
        expect(rows[0].user_id).toBe(SELLER);
    }, 300_000);

    it('AND RUNNING IT TWICE CHANGES NOTHING THE SECOND TIME', async () => {
        const first = await client!.query(sql(MIGRATION_040));
        const second = await client!.query(sql(MIGRATION_040));

        //   The UPDATE is the last statement, so rowCount is what it touched.
        expect({ first: first.rowCount, second: second.rowCount })
            .toEqual({ first: 2, second: 0 });
        expect(await visibleTo(SELLER)).toHaveLength(3);
    }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#904 — 041 stops My Properties reading the whole table', () => {
    const BULK = 20_000;

    beforeAll(async () => {
        if (!REQUESTED) return;
        await client!.query(sql(MIGRATION_041));
        await client!.query(
            `insert into public.document_collections (id, collection_name, raw_data)
             select $1 || g, 'land_listings',
                    jsonb_build_object('ownerId', $2 || g, 'sellerId', $2 || g)
               from generate_series(1, $3) g
             on conflict (id, collection_name) do nothing`,
            [`${TAG}-bulk-`, `${TAG}-other-`, BULK],
        );
        await client!.query('analyze public.document_collections');
    }, 300_000);

    /** How the planner says it will answer a seller's own-rows query. */
    async function planFor(key: string): Promise<string> {
        const { rows } = await client!.query(
            `explain select * from public.document_collections
              where collection_name = 'land_listings'
                and raw_data->>'${key}' = $1`,
            [SELLER],
        );
        return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    }

    it('THE REPORTED SHAPE: My Properties uses an index, not a scan', async () => {
        const plan = await planFor('ownerId');

        expect(plan).toContain('idx_dc_collection_owner');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it("AND SO DOES THE SELLER'S PRODUCT LIST", async () => {
        const plan = await planFor('sellerId');

        expect(plan).toContain('idx_dc_collection_seller');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it('AND THE FILE APPLIES INSIDE A TRANSACTION — #469, which cost a whole migration', async () => {
        /*
         *   THE ASSERTION THIS FILE EXISTS FOR, and the one that caught the
         *   first draft.
         *
         *   041 was written with CREATE INDEX CONCURRENTLY, copying 022. That
         *   is the textbook form and it is unapplicable HERE: CONCURRENTLY
         *   cannot run in a transaction, the Supabase SQL Editor is the only
         *   route available for applying these files, and 027's header records
         *   the last time — "it could not be applied by the SQL Editor this
         *   header says is the only route available here, AND IT SAT
         *   UNAPPLIED".
         *
         *   An index nobody can apply optimises nothing, so applicability is a
         *   property of the migration and is asserted like one. 027's suite
         *   does exactly this and this follows it.
         */
        let refusal: string | null = null;
        await client!.query('begin');
        try {
            await client!.query(sql(MIGRATION_041));
        } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
        } finally {
            await client!.query('rollback');
        }

        //   Asserted, not merely "did not throw": a test whose only outcome is
        //   an absent exception passes when its own setup is skipped.
        expect(refusal).toBeNull();
        expect(statements(MIGRATION_041)).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        //   …and the prose is not empty, so the strip cannot pass by deleting everything.
        expect(statements(MIGRATION_041)).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }, 300_000);

    it('AND BOTH INDEXES ARE VALID — an index that exists is not one that works', async () => {
        const { rows } = await client!.query(
            `select c.relname, i.indisvalid
               from pg_class c join pg_index i on i.indexrelid = c.oid
              where c.relname in ('idx_dc_collection_owner', 'idx_dc_collection_seller')
              order by c.relname`,
        );
        expect(rows).toEqual([
            { relname: 'idx_dc_collection_seller', indisvalid: true },
            { relname: 'idx_dc_collection_owner', indisvalid: true },
        ].sort((a, b) => a.relname.localeCompare(b.relname)));
    }, 300_000);

    it('AND THE MEASUREMENT IS NOT VACUOUS — without it, this is a scan', async () => {
        /*
         *   The control that gives the two assertions above their meaning. On a
         *   small enough table the planner picks a sequential scan whatever
         *   indexes exist, and then "it used the index" would be a statement
         *   about the row count rather than about the index. Dropped and
         *   rebuilt inside one test so the suite leaves the schema as it found
         *   it.
         */
        await client!.query('drop index if exists idx_dc_collection_owner');
        try {
            expect(await planFor('ownerId')).toContain('Seq Scan');
        } finally {
            await client!.query(sql(MIGRATION_041));
        }
        expect(await planFor('ownerId')).toContain('idx_dc_collection_owner');
    }, 300_000);
});
