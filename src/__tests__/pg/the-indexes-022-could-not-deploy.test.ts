/**
 * @jest-environment node
 */

/**
 *   THE SIX INDEXES 022 DECLARED AND NO DEPLOY COULD EVER APPLY.
 *
 *   022 writes all nine of its expression indexes with CREATE INDEX
 *   CONCURRENTLY, which cannot run inside a transaction block — so 022 is in
 *   build-deploy-sql's EXCLUDED list and its own reason ends "Apply it on its
 *   own": a human, by hand, once, per database. Whether that happened anywhere
 *   is not knowable from the repository, and 027's header records what the
 *   same uncertainty cost last time — a migration that "could not be applied
 *   by the SQL Editor ... AND IT SAT UNAPPLIED".
 *
 *   041 and 043 each rescued ONE of the nine into the plain, deployable form
 *   under 022's own name. Six went unnoticed for five migrations, among them
 *   the pair 041's own header calls "the two that cover most of the
 *   application". 048 is those six, and this suite is what says 048 does what
 *   it claims — asked of a real planner rather than read off the SQL.
 *
 *   ── THE "BEFORE" IS NOT ALWAYS A SEQUENTIAL SCAN ──────────────────────────
 *
 *   On document_collections it is not, and claiming one would overstate it.
 *   The planner reaches for whichever (collection_name, …) index exists — 041's
 *   seller index — and uses only its LEADING column, so it narrows to the
 *   collection and then examines every row in it. That the plan NAMES A
 *   DIFFERENT INDEX is exactly the finding, and it is the same shape 043
 *   documented. So the control asserts the index is absent from the plan
 *   rather than that a Seq Scan is present.
 *
 *   ── AND THE TWO STATUS INDEXES DO NOT SERVE THE COMMON VALUE ──────────────
 *
 *   'completed' is 85% of processed_payments and 70% of marketplace_orders,
 *   and the planner correctly keeps a sequential scan for both — a bitmap over
 *   most of a table is worse than reading it. What they serve is the RARE
 *   values: the stranded-payment sweep and the two broadcasts, which select
 *   the people who have NOT paid. That is asserted below in both directions,
 *   because an index whose benefit nobody has written down is an index the
 *   next person deletes.
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
import {
    dbDescribe, planWithTheIndexPricedToLose, indexAndHeapPages, rebuildIndex,
} from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

/** Every row this suite writes is tagged, so cleanup cannot reach a real one. */
const TAG = 'pg022r';

const MIGRATION_048 = 'supabase/migrations/048_the_indexes_022_could_not_deploy.sql';

const sql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

async function clearProbeRows(): Promise<void> {
    await client!.query('delete from public.document_collections where id like $1', [`${TAG}-%`]);
    await client!.query('delete from public.processed_payments where id like $1', [`${TAG}-%`]);
    await client!.query('delete from public.marketplace_orders where id like $1', [`${TAG}-%`]);
    //   #673 A DELETE DOES NOT TELL THE PLANNER, and every one of these tables
    //   is shared with the other suites in this directory.
    await client!.query('analyze public.document_collections');
    await client!.query('analyze public.processed_payments');
    await client!.query('analyze public.marketplace_orders');
}

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();

    await c.query(sql(MIGRATION_048));

    /*
     *   THE POOL SIZE IS COPRIME WITH THE COLLECTION COUNT, and the first
     *   attempt at this fixture was not. With 5,000 users over 25 collections,
     *   25 divides 5,000 — so `g % 5000` fixes `g % 25` and every row for one
     *   user landed in ONE collection. The per-collection filter then matched
     *   everything or nothing and the measurement meant nothing. 4,999 is
     *   prime. This is 047's 'Member ' || i mistake wearing a different hat:
     *   a fixture whose distribution does not resemble the thing it models
     *   fails in the direction that looks like a negative result.
     *
     *   AND THE SAME LESSON A THIRD TIME, ON A DIFFERENT AXIS: the COLLECTION
     *   COUNT matters as much as the row count. Seeded over five collections,
     *   'disputes' is 20% of the table and `status = 'pending'` is 5% of it —
     *   and no index wins at 5%, so the status test failed and appeared to say
     *   the index was useless. Production keeps dozens of collections in this
     *   table; over twenty-five, 'disputes' is 4% and 'pending' within it is
     *   1%, and the plan flips. The index was never the variable.
     */
    await c.query(
        `insert into public.document_collections (id, collection_name, raw_data)
         select $1 || g,
                (array['disputes','export_orders','land_offers','marketplace_quotes',
                       'seller_reviews','farm_nation_transactions','notifications',
                       'course_enrollments','land_listings','products','messages','quotes',
                       'offers','applications','events','posts','tickets','invoices',
                       'shipments','inspections','payouts','refunds','claims','logs',
                       'audits'])[1 + (g % 25)],
                jsonb_build_object(
                    'userId',   $2 || (g % 4999),
                    'sellerId', $2 || (g % 401),
                    'status',   (array['pending','completed','cancelled','draft'])[1 + (g % 4)])
           from generate_series(1, 20000) g
         on conflict (id, collection_name) do nothing`,
        [`${TAG}-d`, `${TAG}-u-`],
    );

    /*
     *   status and type skew the way production skews them: 'completed' is the
     *   overwhelming majority, which is what decides whether an index on
     *   either is reachable for a given value.
     */
    await c.query(
        `insert into public.processed_payments (id, user_id, amount, reference, raw_data)
         select $1 || g, $2 || (g % 400), 10000, $1 || '-ref-' || g,
                jsonb_build_object(
                    'status', case when g % 100 < 85 then 'completed'
                                   when g % 100 < 93 then 'pending_fulfilment'
                                   else 'failed' end,
                    'type',   case when g % 100 < 35 then 'cooperative_membership_registration'
                                   when g % 100 < 55 then 'academy_registration'
                                   else 'marketplace_order' end)
           from generate_series(1, 20000) g
         on conflict (id) do nothing`,
        [`${TAG}-p`, `${TAG}-u-`],
    );

    await c.query(
        `insert into public.marketplace_orders (id, status, raw_data)
         select $1 || g, 'processing',
                jsonb_build_object(
                    'paymentReference', $1 || '-PSK-' || md5(g::text),
                    'paymentStatus', case when g % 100 < 70 then 'completed'
                                          when g % 100 < 90 then 'pending'
                                          else 'failed' end)
           from generate_series(1, 20000) g
         on conflict (id) do nothing`,
        [`${TAG}-m`],
    );

    await c.query('analyze public.document_collections');
    await c.query('analyze public.processed_payments');
    await c.query('analyze public.marketplace_orders');
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

async function planFor(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await client!.query(`explain ${text}`, params);
    return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
}

/**
 *   #972 — THE TWO QUESTIONS 048's INDEX ASSERTIONS MEAN, ASKED SEPARATELY.
 *
 *   Three of them read "the plan names this index" for a value selecting a fifth
 *   to a third of the table, and that is partly a statement about how many times
 *   this directory has been run: the suites here seed tens of thousands of rows
 *   into these four tables and delete them, VACUUM gives the freed index pages
 *   back to the index rather than the filesystem, and the files grow every run.
 *   Measured on one cluster: 30,378 index pages over an 1,089-page
 *   document_collections heap; 16,364 over marketplace_orders. An index larger
 *   than its table is an index the planner is RIGHT to refuse, and two of these
 *   assertions failed on trees nobody had touched — cost 1472.00 at 30%
 *   selectivity, and again at 20%.
 *
 *   What 048 is about is REACHABILITY: the migration's indexes exist and the
 *   queries that motivated them can use them. That is asked with the index
 *   priced to lose — see lib/testing/pg-harness — and owes nothing to bloat.
 *   The preference is asked separately, on a rebuilt index, where it is fair.
 *
 *   `AND status = completed CORRECTLY STAYS A SEQUENTIAL SCAN` below is left
 *   exactly as it was, deliberately: bloat can only make an index LESS
 *   attractive, so an assertion that a Seq Scan is chosen cannot be broken by
 *   it, and that test is about the planner being right at 85%.
 *
 *   MUTATION-TESTED, against re-bloated indexes:
 *
 *     the capability tests stop pricing the index    2 of 3        KILLED
 *     the preference tests stop rebuilding it        2 of 3        KILLED
 *
 *   AND THE ONE THAT SURVIVED THE FIRST MUTANT IS THE FINDING RESTATED. Dropping
 *   the pricing kills the 20% and 30% assertions and NOT the 8% one, because at
 *   8% the planner prefers the index on cost anyway. That is the measurement for
 *   the claim above: the stranded sweep was not over the cliff, it was one run's
 *   index growth from it.
 */
const canBeServedBy = async (text: string, params: unknown[] = []): Promise<string> =>
    (await planWithTheIndexPricedToLose(client!, text, params)).plan;

/**
 * Rebuild the one index, prove the rebuild landed, then ask the planner freely.
 *
 * No ANALYZE: REINDEX does not change a row estimate, and the fixture analysed
 * all four tables when it seeded them.
 */
const preferredOnARebuiltIndex = async (
    index: string, table: string, text: string, params: unknown[] = [],
): Promise<string> => {
    await rebuildIndex(client!, index);

    const { indexPages, heapPages } = await indexAndHeapPages(client!, index, table);
    expect({ index, indexPages, heapPages, proportionate: indexPages < heapPages })
        .toEqual({ index, indexPages, heapPages, proportionate: true });

    return planFor(text, params);
};

const userInCollection = () => planFor(
    `select id from public.document_collections
      where collection_name = 'disputes' and raw_data->>'userId' = $1`,
    [`${TAG}-u-42`],
);

const statusInCollection = () => planFor(
    `select id from public.document_collections
      where collection_name = 'disputes' and raw_data->>'status' = 'pending' limit 50`,
);

const PAYMENTS_BY_TYPE =
    `select id from public.processed_payments where raw_data->>'type' = 'academy_registration'`;
const paymentsByType = () => planFor(PAYMENTS_BY_TYPE);

const orderByReference = () => planFor(
    `select id from public.marketplace_orders where raw_data->>'paymentReference' = $1`,
    [`${TAG}-m-PSK-nope`],
);

/** The stranded-payment sweep — payments service line 401. */
const STRANDED_PAYMENTS =
    `select id from public.processed_payments where raw_data->>'status' = 'pending_fulfilment'`;
const strandedPayments = () => planFor(STRANDED_PAYMENTS);

/** The two broadcasts: the people who have NOT paid. */
const ORDERS_NOT_PAID = `select id from public.marketplace_orders
      where raw_data->>'paymentStatus' in ('pending','unpaid','failed')`;
const ordersNotPaid = () => planFor(ORDERS_NOT_PAID);

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('048 — the indexes 022 could not deploy', () => {
    it('THE BIG ONE: a user\'s own rows in a collection stop being read whole', async () => {
        expect(await userInCollection()).toContain('idx_dc_collection_user');
    }, 300_000);

    it('AND WITHOUT IT THE PLAN NAMES A DIFFERENT INDEX — the control', async () => {
        /*
         *   Stated as "a different index", not "a Seq Scan", because it is not
         *   one: the planner uses idx_dc_collection_seller's LEADING column to
         *   narrow to the collection and then examines every row in it. The
         *   cost grows with the collection rather than with the user.
         */
        await client!.query('drop index if exists idx_dc_collection_user');
        try {
            expect(await userInCollection()).not.toContain('idx_dc_collection_user');
        } finally {
            await client!.query(sql(MIGRATION_048));
        }
        expect(await userInCollection()).toContain('idx_dc_collection_user');
    }, 300_000);

    it('a status filter within a collection uses its own index', async () => {
        expect(await statusInCollection()).toContain('idx_dc_collection_status');
    }, 300_000);

    it('THE WEBHOOK LOOKUP: an order is found by reference without a scan', async () => {
        const plan = await orderByReference();

        expect(plan).toContain('idx_mo_payment_reference');
        expect(plan).not.toContain('Seq Scan');
    }, 300_000);

    it('AND WITHOUT IT EVERY PAYMENT SCANNED THE ORDER TABLE — the control', async () => {
        await client!.query('drop index if exists idx_mo_payment_reference');
        try {
            expect(await orderByReference()).toContain('Seq Scan');
        } finally {
            await client!.query(sql(MIGRATION_048));
        }
        expect(await orderByReference()).toContain('idx_mo_payment_reference');
    }, 300_000);

    it('the ledger IS REACHABLE by type', async () => {
        //   'academy_registration' is 20% of the fixture, which is near enough
        //   the crossover that the index FILE's size decided the answer: this
        //   failed on a Seq Scan once processed_payments' indexes had grown to
        //   5,798 pages. #972, and the two helpers above say what replaced it.
        expect(await canBeServedBy(PAYMENTS_BY_TYPE)).toContain('idx_pp_type');
    }, 300_000);

    it('AND THE PLANNER PREFERS IT THERE, ON A REBUILT INDEX', async () => {
        expect(await preferredOnARebuiltIndex(
            'idx_pp_type', 'public.processed_payments', PAYMENTS_BY_TYPE,
        )).toContain('idx_pp_type');
    }, 300_000);

    describe('the status indexes serve the RARE values, not the common one', () => {
        it('the stranded-payment sweep CAN BE SERVED BY idx_pp_status', async () => {
            //   8% — the genuinely rare value this block's heading is about, and
            //   the only one of the three that survived the bloat measurement in
            //   #972. Split anyway: it passed at 5,798 index pages, which is one
            //   more run's growth from the cliff its two siblings went over.
            expect(await canBeServedBy(STRANDED_PAYMENTS)).toContain('idx_pp_status');
        }, 300_000);

        it('AND THE PLANNER PREFERS IT THERE, ON A REBUILT INDEX', async () => {
            expect(await preferredOnARebuiltIndex(
                'idx_pp_status', 'public.processed_payments', STRANDED_PAYMENTS,
            )).toContain('idx_pp_status');
        }, 300_000);

        it('the unpaid-broadcast filter CAN BE SERVED BY idx_mo_payment_status', async () => {
            /*
             *   #972 — ASKED AS CAPABILITY, NOT AS COST, and this is the second
             *   suite that needed the distinction.
             *
             *   THIS ASSERTION USED TO READ "uses idx_mo_payment_status" AND
             *   FAILED ON A TREE NOBODY HAD TOUCHED. `in ('pending','unpaid',
             *   'failed')` is 30% of the fixture — 6,000 rows of 20,000 — which
             *   is near enough the crossover that the size of the index file
             *   decides the answer. Measured: with marketplace_orders' indexes
             *   grown to 5,582 pages by earlier suites seeding and deleting
             *   300,000 rows, the plan was a Seq Scan at cost 1472.00.
             *
             *   30% is also not what this block's heading claims. 'completed' is
             *   70%, and the sibling assertion above — the stranded-payment
             *   sweep, 8% — is the genuinely rare one. So the reachability 048 is
             *   about is asked here with the index priced to lose, and the
             *   preference is asked separately below, where it is fair.
             */
            expect(await canBeServedBy(ORDERS_NOT_PAID)).toContain('idx_mo_payment_status');
        }, 300_000);

        it('AND THE PLANNER PREFERS IT THERE, ON A REBUILT INDEX', async () => {
            //   An index nothing scans is not a fix, so the preference is still
            //   asserted — on an index whose size reflects its rows rather than
            //   how many times this directory has been run.
            expect(await preferredOnARebuiltIndex(
                'idx_mo_payment_status', 'public.marketplace_orders', ORDERS_NOT_PAID,
            )).toContain('idx_mo_payment_status');
        }, 300_000);

        it('AND status = completed CORRECTLY STAYS A SEQUENTIAL SCAN', async () => {
            /*
             *   Not a defect and not a disappointment. 'completed' is 85% of
             *   the table; a bitmap over most of a table is worse than reading
             *   it, and the planner declining the index is it being right.
             *
             *   Asserted so that nobody adds up 048's numbers, expects the
             *   revenue totals to get faster, finds they have not, and concludes
             *   the index is broken.
             */
            const plan = await planFor(
                `select id from public.processed_payments where raw_data->>'status' = 'completed'`,
            );

            expect(plan).toContain('Seq Scan');
            expect(plan).not.toContain('idx_pp_status');
        }, 300_000);
    });

    it('AND 048 DOES NOT BRING THE TWO cooperative_members INDEXES BACK', async () => {
        /*
         *   ASSERTED AS "048 DOES NOT CREATE THEM", NOT "THEY DO NOT EXIST",
         *   AND THE DIFFERENCE IS THE WHOLE REASON THIS WENT UNSEEN.
         *
         *   scripts/local-postgres.sh applies EVERY file in migrations/ with
         *   `psql -f`, which runs in autocommit — and CONCURRENTLY works
         *   perfectly there. So 022 applies cleanly on every local and CI
         *   database, and its nine indexes have always been present in the one
         *   environment that runs the tests. The environments where 022 cannot
         *   apply are the SQL Editor and the deploy runner, which is to say the
         *   real ones. A test asserting these are absent would be asserting
         *   something false here and true in production.
         *
         *   So: drop them, apply 048, and they must stay gone — while the six
         *   it does rescue come back.
         */
        await client!.query('drop index if exists idx_cm_user_id');
        await client!.query('drop index if exists idx_cm_membership_status');
        await client!.query('drop index if exists idx_pp_type');

        await client!.query(sql(MIGRATION_048));

        const { rows } = await client!.query(
            `select indexname from pg_indexes
              where indexname in ('idx_cm_user_id', 'idx_cm_membership_status',
                                  'idx_pp_type')
              order by indexname`,
        );

        //   idx_pp_type is the positive control: if 048 rebuilt nothing at all
        //   this test would pass for the wrong reason.
        expect(rows.map((r) => r.indexname)).toEqual(['idx_pp_type']);

        //   Leave the harness as it was found — 022 put them there. Restored
        //   with plain statements rather than by re-running 022, because a
        //   multi-statement query() is wrapped in an implicit transaction and
        //   022 cannot run in one. That refusal is asserted on its own below.
        await client!.query(
            `create index if not exists idx_cm_user_id
                 on public.cooperative_members ((raw_data->>'userId'))`);
        await client!.query(
            `create index if not exists idx_cm_membership_status
                 on public.cooperative_members ((raw_data->>'membershipStatus'))`);
    }, 300_000);

    it('AND 022 ITSELF IS STILL REFUSED IN A TRANSACTION — the defect, stated', async () => {
        /*
         *   The whole reason 048 exists, reduced to one assertion. A
         *   multi-statement query() is wrapped in an implicit transaction, which
         *   is what the Supabase SQL Editor and the deploy runner both do — and
         *   there 022 raises 25001 and applies NOTHING.
         *
         *   That it applies cleanly via `psql -f` is why every local and CI
         *   database has had its nine indexes all along, and why five
         *   migrations passed before anyone noticed they had never reached a
         *   real one.
         */
        let refusal: string | null = null;
        try {
            await client!.query(sql('supabase/migrations/022_jsonb_expression_indexes.sql'));
        } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
        }

        expect(refusal).toContain('CONCURRENTLY cannot run inside a transaction');
    }, 300_000);

    it('AND EVERY INDEX IT BUILT IS VALID — one that exists is not one that works', async () => {
        const { rows } = await client!.query(
            `select c.relname, i.indisvalid
               from pg_class c join pg_index i on i.indexrelid = c.oid
              where c.relname in ('idx_dc_collection_status','idx_dc_collection_user',
                                  'idx_pp_status','idx_pp_type',
                                  'idx_mo_payment_reference','idx_mo_payment_status')
              order by c.relname`,
        );

        expect(rows).toHaveLength(6);
        for (const r of rows) expect(r.indisvalid).toBe(true);
    }, 300_000);

    it('AND THE FILE APPLIES INSIDE A TRANSACTION — the one thing 022 could not do', async () => {
        let refusal: string | null = null;
        await client!.query('begin');
        try {
            await client!.query(sql(MIGRATION_048));
        } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
        } finally {
            await client!.query('rollback');
        }

        //   This is the entire reason 048 exists: 022's CONCURRENTLY form
        //   raises 25001 here, which is why it never reached any database
        //   through the Editor or the deploy runner.
        expect(refusal).toBeNull();
    }, 300_000);
});
