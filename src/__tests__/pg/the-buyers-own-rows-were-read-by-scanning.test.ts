/**
 * @jest-environment node
 */

/**
 *   #904 (BUYER SIDE) — THE BUYER'S OWN ROWS, FOUND BY READING EVERY ROW.
 *
 *   041 indexed `ownerId` and `sellerId` on document_collections and said what
 *   it was fixing: "022 indexed `status` and `userId` — the two that cover
 *   most of the application. Neither is what a seller's own two screens filter
 *   on."
 *
 *   `buyerId` is the third such field and was in neither list. Six of the seven
 *   collections a buyer's screens read are GENERIC, so nothing indexed it:
 *   disputes, export_orders, land_offers, marketplace_quotes, seller_reviews,
 *   farm_nation_transactions.
 *
 *   Migration 043 is that index, and this suite is what says 043 does what it
 *   claims — asked of a real planner rather than read off the SQL, on enough
 *   rows that a scan is not simply the cheaper plan.
 *
 *   AND THE SECOND HALF IS ABOUT A MIGRATION THAT MAY NEVER HAVE RUN.
 *   marketplace_orders is a DEDICATED table; 022 declares idx_mo_buyer_id with
 *   CONCURRENTLY, which is why 022 is excluded from the consolidated deploy
 *   and must be applied by hand. 043 Part 2 re-declares it in the plain form
 *   under the same name — a no-op where 022 landed, the repair where it did
 *   not. Without it, that query is a true sequential scan.
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
import { dbDescribe } from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

/** Every row this suite writes is tagged, so cleanup cannot reach a real one. */
const TAG = 'pg904c';
const BUYER = `${TAG}-buyer-7`;

const MIGRATION_043 = 'supabase/migrations/043_buyer_id_expression_indexes.sql';

const sql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/** The migration's STATEMENTS, with its `--` prose removed — the #651 trap. */
const statements = (file: string) =>
    sql(file).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

async function clearProbeRows(): Promise<void> {
    await client!.query('delete from public.document_collections where id like $1', [`${TAG}-%`]);
    await client!.query('delete from public.marketplace_orders where id like $1', [`${TAG}-%`]);
    //   #673 A DELETE DOES NOT TELL THE PLANNER. Both tables are shared with
    //   every other suite, and this one inserts 20,000 rows into each.
    await client!.query('analyze public.document_collections');
    await client!.query('analyze public.marketplace_orders');
}

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();

    await c.query(sql(MIGRATION_043));

    /*
     *   20,000 rows per table, a buyer's own share of them small — which is the
     *   whole point. Fewer rows and the planner would choose a scan whatever
     *   indexes exist, and "it used the index" would be a statement about the
     *   row count rather than about the index.
     */
    await c.query(
        `insert into public.document_collections (id, collection_name, raw_data)
         select $1 || g,
                (array['disputes','export_orders','land_offers',
                       'marketplace_quotes','seller_reviews'])[1 + (g % 5)],
                jsonb_build_object('buyerId', $2 || ((g / 5) % 400), 'status', 'open')
           from generate_series(1, 20000) g
         on conflict (id, collection_name) do nothing`,
        [`${TAG}-d`, `${TAG}-buyer-`],
    );
    await c.query(
        `insert into public.marketplace_orders (id, status, raw_data)
         select $1 || g, 'processing', jsonb_build_object('buyerId', $2 || (g % 400))
           from generate_series(1, 20000) g
         on conflict (id) do nothing`,
        [`${TAG}-m`, `${TAG}-buyer-`],
    );
    await c.query('analyze public.document_collections');
    await c.query('analyze public.marketplace_orders');
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** How the planner answers a buyer's own-rows query on a generic collection. */
async function genericPlan(): Promise<string> {
    const { rows } = await client!.query(
        `explain select id from public.document_collections
          where collection_name = 'disputes'
            and raw_data->>'buyerId' = any($1)`,
        [[BUYER, `${TAG}-buyer-8`]],
    );
    return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
}

/** …and on the dedicated table. */
async function dedicatedPlan(): Promise<string> {
    const { rows } = await client!.query(
        `explain select id from public.marketplace_orders
          where raw_data->>'buyerId' = any($1)`,
        [[BUYER, `${TAG}-buyer-8`]],
    );
    return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#904 — 043 stops a buyer screen reading the whole collection', () => {
    it('THE REPORTED SHAPE: a generic collection uses the buyer index', async () => {
        expect(await genericPlan()).toContain('idx_dc_collection_buyer');
    }, 300_000);

    it('AND THE DEDICATED TABLE DOES TOO — where 022 may never have run', async () => {
        const plan = await dedicatedPlan();

        expect(plan).toContain('idx_mo_buyer_id');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it('AND WITHOUT PART 2 IT IS A SEQUENTIAL SCAN — the control', async () => {
        /*
         *   The half that says Part 2 is worth having at all. Dropped and
         *   rebuilt inside one test so the suite leaves the schema as it found
         *   it.
         */
        await client!.query('drop index if exists idx_mo_buyer_id');
        try {
            expect(await dedicatedPlan()).toContain('Seq Scan');
        } finally {
            await client!.query(sql(MIGRATION_043));
        }
        expect(await dedicatedPlan()).toContain('idx_mo_buyer_id');
    }, 300_000);

    it('AND WITHOUT PART 1 THE COLLECTION IS READ WHOLE — the other control', async () => {
        /*
         *   Stated carefully, because the "before" here is NOT a Seq Scan and
         *   claiming one would be overstating it. The planner reaches for
         *   idx_dc_collection_seller and uses only its leading column,
         *   `collection_name` — so it narrows to the collection and then
         *   examines every row in it. That the plan NAMES A DIFFERENT INDEX is
         *   exactly the finding.
         */
        await client!.query('drop index if exists idx_dc_collection_buyer');
        try {
            const without = await genericPlan();
            expect(without).not.toContain('idx_dc_collection_buyer');
        } finally {
            await client!.query(sql(MIGRATION_043));
        }
        expect(await genericPlan()).toContain('idx_dc_collection_buyer');
    }, 300_000);

    it('AND BOTH INDEXES ARE VALID — one that exists is not one that works', async () => {
        const { rows } = await client!.query(
            `select c.relname, i.indisvalid
               from pg_class c join pg_index i on i.indexrelid = c.oid
              where c.relname in ('idx_dc_collection_buyer', 'idx_mo_buyer_id')
              order by c.relname`,
        );
        expect(rows).toEqual([
            { relname: 'idx_dc_collection_buyer', indisvalid: true },
            { relname: 'idx_mo_buyer_id', indisvalid: true },
        ]);
    }, 300_000);

    it('AND THE FILE APPLIES INSIDE A TRANSACTION — #469, which cost a whole migration', async () => {
        let refusal: string | null = null;
        await client!.query('begin');
        try {
            await client!.query(sql(MIGRATION_043));
        } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
        } finally {
            await client!.query('rollback');
        }

        //   Asserted, not merely "did not throw": a test whose only outcome is
        //   an absent exception passes when its own setup is skipped.
        expect(refusal).toBeNull();
        expect(statements(MIGRATION_043)).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        expect(statements(MIGRATION_043)).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }, 300_000);

    it('AND RE-RUNNING IT CHANGES NOTHING', async () => {
        await client!.query(sql(MIGRATION_043));
        await client!.query(sql(MIGRATION_043));

        const { rows } = await client!.query(
            `select count(*)::int as n from pg_class
              where relname in ('idx_dc_collection_buyer', 'idx_mo_buyer_id')`,
        );
        expect(rows[0].n).toBe(2);
    }, 300_000);
});
