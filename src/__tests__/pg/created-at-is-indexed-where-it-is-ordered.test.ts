/**
 * @jest-environment node
 */

/**
 *   #467 THE TABLES PROMOTED FOR SPEED LOST THE INDEX THE SLOW ONE KEPT.
 *
 *   The owner reported /admin and /admin/users loading slowly. Measured against
 *   a real PostgreSQL 16 with 50,009 users, on the exact query the page issues:
 *
 *       select id, raw_data from users order by created_at desc limit 20;
 *
 *       BEFORE   26.496 ms   Sort (rows=50009), Sort Key: created_at DESC
 *       AFTER     0.061 ms   Index Scan using idx_users_created_at
 *
 *   430x. The whole table was sorted to find twenty rows, on every page load.
 *
 *   AND THE PROOF IT IS AN OVERSIGHT: document_collections, the untyped
 *   catch-all everything used to live in, already carries
 *   (collection_name, created_at DESC). Every table since promoted OUT of it
 *   into a dedicated table — for performance — was created without one.
 *
 *   TWO THINGS I MEASURED THAT WERE NOT THE CAUSE, recorded so nobody re-runs
 *   them:
 *
 *     count: 'exact'      20 sequential counts over 50k rows: 615 ms; the same
 *                         20 as 'planned': 542 ms. Barely different, because
 *                         the cost is the round trip, not the counting. An
 *                         "estimated count" change would trade correctness for
 *                         nothing. The admin block is already Promise.all —
 *                         190 ms for all twenty.
 *
 *     the JSONB detoast   `select id, raw_data` vs `select id, email` on the
 *                         same query: 28.8 ms against 23.2 ms. Real, and small
 *                         beside the sort.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       npm run pg:start                                    # Postgres alone, 55432
 *       LOCAL_PG_URL="$(cat .local-pg-url)" npm run test:pg
 *
 *   #337 taught local-postgres.sh to write .local-pg-url and the push hook to
 *   read it. `npm run test:pg` was NOT taught the same thing — it reads only
 *   LOCAL_PG_URL — so the variable is still passed here on purpose.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import {
    dbDescribe as sharedDbDescribe, restDescribe,
    explainPlan, planWithTheIndexPricedToLose, indexAndHeapPages, rebuildIndex,
} from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
//   #651 — one definition, in lib/testing/pg-harness. This line was
//   written out identically in all ten suites.
const dbDescribe = sharedDbDescribe;

/**
 *   #673 THE PLANNER TEST BELOW WAS PASSING ON ANOTHER SUITE'S LEFTOVERS.
 *
 *        It asks the planner to choose `idx_users_created_at` for
 *        `order by created_at desc limit 20`. THE PLANNER IS ONLY WRONG TO
 *        REFUSE THAT ON A TABLE WITH ROWS IN IT: against an empty `users` a
 *        sequential scan is the correct plan, and Postgres picking it is the
 *        database working, not the index missing.
 *
 *        The suite never seeded anything. It measured whatever the suite
 *        before it happened to leave behind — and `--runInBand` orders files
 *        by a heuristic, so ADDING AN UNRELATED TEST TO AN UNRELATED FILE
 *        reorders the run and changes the answer. That is precisely what
 *        happened: #671 added an assertion to
 *        a-rule-the-database-enforces-by-itself.test.ts, this file moved, and
 *        CI went red on a test nothing had touched in months.
 *
 *        REPRODUCED BEFORE BEING BELIEVED, and the first hypothesis was
 *        wrong. "The table is empty" is NOT enough — against a freshly
 *        created, never-analysed table the planner still takes the index, and
 *        the suite passes. The condition is empty AND ANALYSED, i.e. the
 *        planner KNOWS there are no rows. A sibling suite
 *        (the-role-scan-reads-the-whole-table-without-the-index) runs
 *        `analyze public.users` and deletes its rows, which produces exactly
 *        that state.
 *
 *        Measured on a scratch database built from schema.sql + deploy.sql:
 *
 *            empty, never analysed     the planner uses the index   PASS
 *            empty, analysed           sequential scan + sort       FAIL
 *
 *        AND THE MUTATION RUN IS THE FINDING IN THREE LINES. Removing the
 *        seed this file now performs:
 *
 *            mutant, pristine empty+analysed database    1 FAILED   killed
 *            mutant, the 50,000-row local database       18 PASSED  survived
 *            the fix, pristine empty+analysed database   18 PASSED
 *
 *        The same test, the same mutant, two databases, two answers. Running
 *        `npm run test:pg` locally proves nothing about CI unless the local
 *        database resembles CI's, and a developer's does not — mine held
 *        50,023 users. That is #666's lesson arriving a second time: a control
 *        only rules out what it VARIES, and every control anyone had run here
 *        held the host fixed.
 *
 *        The scratch database needs rebuilding between measurements, too. The
 *        first attempt at the table above reused one, and the seed-and-delete
 *        from the previous run left dead tuples and pages behind — enough to
 *        change the planner's mind and let the mutant survive. A control is
 *        only pristine the first time it is used.
 *
 *        So the suite creates the condition it is asserting about, and puts
 *        the database back afterwards — INCLUDING the statistics, because
 *        leaving those wrong is how this reached the next suite in the first
 *        place.
 */
/**
 *   #972 AND THEN IT WENT RED AGAIN — ON A CLUSTER, NOT ON A CHANGE.
 *
 *        #673 above fixed "this test measured the ROWS the previous suite left
 *        behind". It did not fix the other thing a previous suite leaves behind.
 *
 *        THE #051 FILTER TEST BELOW FAILED ON A COMMIT THAT TOUCHED NONE OF
 *        THIS, twenty minutes after the same code passed. Running the file alone
 *        reproduced it twice, so it was not a flake. Measured on the exact query,
 *        over the exact 5,000 rows this file seeds:
 *
 *            idx_users_raw_created_at      the plan, and its cost
 *            ────────────────────────      ──────────────────────────────────
 *              8 pages (freshly built)     Bitmap Index Scan        156.55
 *             87 pages                     Bitmap Index Scan        192.55
 *            237 pages                     Seq Scan                 236.33
 *
 *        THE INDEX HAD GROWN LARGER THAN THE TABLE IT INDEXES: 237 pages of
 *        index over a 135-page heap, for 5,000 rows that need 8. Sibling suites
 *        seed tens of thousands of users and delete them, and VACUUM gives index
 *        pages back to the INDEX, never to the filesystem — so the file grows
 *        across runs and never shrinks. At 237 pages the bitmap scan's start-up
 *        cost alone (105.68) is most of the sequential scan's whole total
 *        (235.00), and CHOOSING THE SEQUENTIAL SCAN IS THE PLANNER BEING RIGHT.
 *
 *        So one assertion was reading the cluster's history and reporting it as
 *        a missing index. It was also asking two questions at once, and only one
 *        of them is answerable from a cost estimate:
 *
 *        1. CAN the dashboard's predicate use an index AT ALL? That is #051's
 *           actual finding — a btree on the COLUMN cannot serve a filter on the
 *           JSON KEY — and it must not depend on what anything costs. Asked with
 *           THE INDEX PRICED TO LOSE — random_page_cost = 1000, so no cost
 *           accident can explain it being chosen — AND sequential scans then
 *           discouraged, `enable_seqscan = off` being a preference and not a
 *           prohibition. Measured, all three, on the same 5,000 rows:
 *
 *               random_page_cost=1000                  Seq Scan          208.33
 *               ... and seqscan off                    Bitmap Index Scan  1124.55
 *               ... and 051's index DROPPED     Seq Scan, 10000000207.06
 *
 *           The index is five times the cheaper plan's cost and still appears,
 *           because it is the only thing that FITS. No page count, row count or
 *           statistic enters into it — which is exactly what the assertion below
 *           it cannot say for itself. This is also the distinction 022 is about: that index was
 *           present and UNUSABLE for its query, which pg_indexes cannot tell you
 *           and a cost comparison tells you only by accident.
 *
 *        2. DOES the planner prefer it? Worth keeping — an index nothing scans is
 *           not a fix — but it is only a fair question about an index
 *           proportionate to its rows, which is the state production's index is
 *           in and this one was not. So the seed rebuilds that one index, and the
 *           test reports both page counts when it fails, so the next reader sees
 *           bloat instead of re-deriving it.
 *
 *        TWO FIXES I MEASURED AND REJECTED, recorded so nobody re-runs them:
 *
 *            vacuum (analyze)    marked all 135 heap pages all-visible; the plan
 *                                did not move. What is being compared is the
 *                                index FILE's size, and VACUUM does not shrink
 *                                it.
 *
 *            more rows, or a     the selectivity is already the dashboard's own:
 *            narrower range      526 rows of 5,000, one month out of 300 days.
 *                                Changing it would make the test easier to pass
 *                                and stop it resembling the query that timed out.
 *
 *        MUTATION-TESTED, each mutant verified to have landed, and the bloated
 *        mutants run against an index re-bloated to 244-495 pages first, because
 *        a mutant run on a pristine cluster would have proved nothing:
 *
 *          051's index does not exist          both assertions      KILLED
 *          the seed stops rebuilding it        preference only      KILLED
 *          enable_seqscan off -> on            capability only      KILLED
 *          drop the random_page_cost pricing   capability only      KILLED
 *          capability names the COLUMN index   capability only      KILLED
 *          the probe stops using a transaction both assertions      KILLED
 *          `set local` -> bare `set`           EQUIVALENT, not a survivor:
 *                                              Postgres reverts a SET on
 *                                              ROLLBACK, measured, so inside
 *                                              this helper the two are the same
 *                                              statement.
 *
 *        THE SECOND AND THIRD ROWS ARE THE POINT. One mutant kills only the
 *        preference assertion and the other only the capability assertion, on
 *        the same cluster, in the same run — which is the evidence that the two
 *        tests ask different questions rather than the same one twice.
 */
const TAG = 'plan-probe-467';

/** Enough rows that an index scan genuinely beats a sequential one. */
const PROBE_ROWS = 5_000;

const clearProbeRows = async () => {
    await client!.query('delete from public.users where id like $1', [`${TAG}-%`]);
    //   Re-analysed, not merely deleted. The suite that taught this file the
    //   lesson removes its rows and leaves the statistics claiming they are
    //   still there; the next suite to read a query plan then measures a table
    //   that does not exist.
    await client!.query('analyze public.users');
};

/** Put enough rows in `users` that the question this file asks is meaningful. */
const seedProbeRows = async () => {
    await client!.query(
        `insert into public.users (id, email, created_at, raw_data)
         select $1 || '-' || g,
                $1 || '-' || g || '@example.com',
                now() - (g || ' minutes')::interval,
                jsonb_build_object(
                    'fullName', 'Probe ' || g,
                    /*
                     *   THE JSON KEY AS WELL AS THE COLUMN, and on a FIXED
                     *   base date rather than now(), because #051's assertions
                     *   below name a literal range. The two are deliberately
                     *   different values: the column descends by minute so the
                     *   ORDER BY test above still reads cleanly, and the key
                     *   spreads over 300 days so a one-month predicate selects
                     *   a slice worth indexing rather than all of it or none.
                     */
                    'createdAt', to_char(
                        timestamp '2026-01-01' + ((g % 300) || ' days')::interval,
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                )
           from generate_series(1, $2::int) g
         on conflict (id) do nothing`,
        [TAG, PROBE_ROWS],
    );
    /*
     *   #972 REBUILT, NOT MERELY ANALYSED — see the note above. This index file
     *   grows every time a sibling suite seeds tens of thousands of rows into
     *   `users` and deletes them, and at 237 pages over a 135-page heap the
     *   planner correctly refuses it. Without this the test below reads the
     *   cluster's history rather than the schema.
     *
     *   NARROW ON PURPOSE: this one index, not `reindex table`. The suite next
     *   door asserts that a role scan reads the whole table WITHOUT an index,
     *   and shrinking indexes nobody asked about is how this file's problem
     *   becomes that file's problem.
     */
    await rebuildIndex(client!, 'idx_users_raw_created_at');
    await client!.query('analyze public.users');
};

/*
 *   #651's rule, applied to #972: the planner probe and the page counts live in
 *   lib/testing/pg-harness, because the-indexes-022-could-not-deploy needs the
 *   same two questions and a rule written twice is a rule waiting to drift.
 */

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

/** Every dedicated table the adapter routes a collection to. */
const DEDICATED = [
    'users',
    'marketplace_orders',
    'processed_payments',
    'transactions',
    'cooperative_members',
    'cooperative_loans',
    'academy_applications',
    'wallets',
];

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#467 — every dedicated table can be ordered by created_at cheaply', () => {
    it('EVERY ONE OF THEM HAS A created_at INDEX', async () => {
        const { rows } = await client!.query(
            `select tablename from pg_indexes
             where schemaname = 'public' and indexdef like '%created_at%'`,
        );
        const indexed = new Set(rows.map((r: any) => r.tablename));

        const missing = DEDICATED.filter((t) => !indexed.has(t));
        expect({ missing }).toEqual({ missing: [] });
    });

    it('AND THE CATCH-ALL STILL HAS THE ONE IT ALWAYS HAD', async () => {
        // The premise of the whole finding: document_collections was never the
        // problem, which is what made the dedicated tables' omission visible.
        const { rows } = await client!.query(
            `select indexdef from pg_indexes
             where schemaname='public' and tablename='document_collections'
               and indexdef like '%created_at%'`,
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].indexdef).toContain('collection_name');
    });

    it('AND THE PLANNER USES IT — an index nothing scans is not a fix', async () => {
        // The assertion that actually matters. A btree can exist and be ignored:
        // migration 022 records exactly that outcome for a different query
        // shape, which is why this asks the planner rather than pg_indexes.
        //
        //   #673 SEEDED HERE, because the question is only meaningful about a
        //   table with rows in it — see the header. Without this the suite
        //   asserted against whatever the previous file left behind, and went
        //   red the day an unrelated test changed the file ordering.
        await seedProbeRows();

        const { rows } = await client!.query(
            `explain (analyze, format json)
             select id, raw_data from users order by created_at desc limit 20`,
        );
        const plan = JSON.stringify(rows[0]['QUERY PLAN']);

        expect(plan).toContain('idx_users_created_at');
        expect(plan).not.toContain('"Node Type":"Sort"');
    });

    it('POSITIVE CONTROL: a query with no index still sorts', async () => {
        // Without this, "no Sort node" could mean the plan text is being read
        // wrongly rather than the index being used.
        //
        //   ORDERED BY AN EXPRESSION NO INDEX CAN SERVE, not by a bare column
        //   that merely happens to be unindexed today.
        //
        //   This read `order by raw_data->>'fullName'`, chosen because nothing
        //   indexed it — and 047 then indexed it, for the admin search box.
        //   The planner started answering from idx_users_full_name, the Sort
        //   node vanished, and a control that was correct went red without
        //   anything it was controlling for having changed.
        //
        //   A control that depends on the absence of an index is a control
        //   that any future index can break. `length(...)` cannot be served by
        //   a b-tree on the value, so the only way to make this plan
        //   index-only is to add an index for this expression specifically,
        //   which nobody will do by accident.
        const { rows } = await client!.query(
            `explain (analyze, format json)
             select id from users order by length(raw_data->>'fullName') limit 20`,
        );

        expect(JSON.stringify(rows[0]['QUERY PLAN'])).toContain('"Node Type":"Sort"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#051 — and the chart that filtered the OTHER createdAt', () => {
    /**
     *   THE INDEX ABOVE EXISTED, WAS USED, AND WAS IRRELEVANT TO THE QUERY
     *   THAT TIMED OUT.
     *
     *   The owner's production log, six of these on one admin dashboard:
     *
     *       [DashboardStats] user growth count failed {"month":"Sept 26",
     *         "error":"[supabase-db] count users: ... HTTP 500"}
     *       ... canceling statement due to statement timeout
     *
     *   analytics.service asks `.where("createdAt", ">=", start)`. `createdAt`
     *   is in neither FIELD_TO_COLUMN['users'] nor NATIVE_COLUMNS['users'] —
     *   which lists the snake_case `created_at` — so supabase-db's router
     *   falls through to applyJsonbFilter and emits `raw_data->>'createdAt'`.
     *
     *   A btree on the COLUMN cannot serve a predicate on the JSON KEY. One
     *   underscore and one capital letter between an index scan and a scan of
     *   the whole table.
     *
     *   THIS IS THE PAIR OF ASSERTIONS THAT WOULD HAVE CAUGHT IT: the suite
     *   above proves 027's index is used for the ORDER BY, and stopped there.
     *   Nothing asked whether the FILTER the dashboard actually issues could
     *   use anything at all.
     */
    /** The query analytics.service issues, verbatim in shape. */
    const DASHBOARD_FILTER = `select count(*) from users
              where raw_data->>'createdAt' >= $1
                and raw_data->>'createdAt' <= $2`;
    //   One month out of the 300 days the seed spreads over: 526 rows of 5,000.
    //   The dashboard's own selectivity, and #972 says why it is not adjusted to
    //   suit the planner.
    const ONE_MONTH = ['2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.999Z'];

    it('THE FILTER THE DASHBOARD ISSUES CAN BE SERVED BY AN INDEX AT ALL', async () => {
        /*
         *   THE ASSERTION THAT IS ACTUALLY #051's FINDING, and the one that owes
         *   nothing to a cost estimate.
         *
         *   A btree on the COLUMN `created_at` cannot serve a predicate on the
         *   JSON KEY `raw_data->>'createdAt'` — not "will not today", CANNOT. So
         *   the question is whether any index CAN, and it is asked with the
         *   index priced to LOSE: see the helper, which makes index access cost
         *   1000 a page and then rules out the sequential scan anyway. An index
         *   that appears under those costs is one the predicate fits; with 051's
         *   index dropped the plan is a Seq Scan instead, at 10000000207.06.
         *
         *   Seeded for #673's reason: the question is only meaningful about a
         *   table with rows in it.
         */
        await seedProbeRows();

        const forced = await planWithTheIndexPricedToLose(client!, DASHBOARD_FILTER, ONE_MONTH);

        expect(forced.plan).toContain('idx_users_raw_created_at');

        /*
         *   AND IT WAS TAKEN AGAINST ITS OWN PRICE. Priced at 1000 a page the
         *   index path costs 1124.55 against the 208.33 sequential scan it is
         *   forbidden from taking, while the same query planned freely costs
         *   156.54 — so this plan is emphatically not the cheap one.
         *
         *   NOT ASSERTED HERE, because the helper THROWS when the forced plan is
         *   no dearer than the free choice: an assertion that cannot fail is the
         *   thing this audit keeps finding, and one enforced in the helper covers
         *   the other caller too.
         */
    });

    it('AND THE PLANNER PREFERS IT, ON AN INDEX PROPORTIONATE TO ITS ROWS', async () => {
        //   An index nothing scans is not a fix, so the preference is still
        //   asserted — but #972 is why the precondition is measured first rather
        //   than assumed. A 237-page index over a 135-page heap is a state no
        //   production table is in, and refusing it is the planner working.
        await seedProbeRows();

        const { indexPages, heapPages } = await indexAndHeapPages(
            client!, 'idx_users_raw_created_at', 'public.users');

        //   BOTH PRECONDITIONS, MEASURED. The second is here because the test
        //   above turns sequential scans off: it does so with `set local` inside
        //   a transaction it rolls back, and if that ever became a bare SET this
        //   test would go on passing while asking an entirely different question.
        const { rows: setting } = await client!.query('show enable_seqscan');

        expect({
            indexPages, heapPages,
            proportionate: indexPages < heapPages,
            seqscan: setting[0].enable_seqscan,
        }).toEqual({ indexPages, heapPages, proportionate: true, seqscan: 'on' });

        const { plan } = await explainPlan(client!, DASHBOARD_FILTER, ONE_MONTH);

        expect(plan).toContain('idx_users_raw_created_at');
        expect(plan).not.toContain('"Node Type":"Seq Scan"');
    });

    it('AND 027\'S COLUMN INDEX IS NOT WHAT ANSWERS IT', async () => {
        /*
         *   THE CONTROL THAT MAKES THE ASSERTION ABOVE MEAN SOMETHING.
         *
         *   `idx_users_raw_created_at` does not CONTAIN `idx_users_created_at`
         *   as a substring — deliberately, and 050's header says why: a name
         *   that contains another makes one test's `toContain` pass for the
         *   wrong reason and another's `not.toContain` fail for no reason,
         *   which cost a CI cycle on #263.
         *
         *   So this control is only meaningful BECAUSE of the name. Rename the
         *   new index to idx_users_created_at_json and this assertion starts
         *   failing on a correct plan.
         */
        expect('idx_users_raw_created_at').not.toContain('idx_users_created_at');

        await seedProbeRows();

        const { rows } = await client!.query(
            `explain (analyze, format json)
             select count(*) from users where raw_data->>'createdAt' >= $1`,
            ['2026-10-01T00:00:00.000Z'],
        );

        //   Not "some index was used" — the column index cannot serve a JSON
        //   key and must not appear in this plan.
        expect(JSON.stringify(rows[0]['QUERY PLAN'])).not.toContain('idx_users_created_at"');
    });
});

const SQL_027 = 'supabase/migrations/027_dedicated_table_created_at_indexes.sql';
const sql = () => readFileSync(SQL_027, 'utf-8');

/** The header NAMES the CONCURRENTLY form, for a future where a table is huge.
 *  Naming it is not writing it, so the statements are read without comments. */
const statements = () =>
    sql()
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#469 — the migration can be applied by the route this project has', () => {
    /**
     *   THE FIRST DRAFT OF 027 COULD NOT BE APPLIED AT ALL.
     *
     *   It used CREATE INDEX CONCURRENTLY and told the operator to run the file
     *   "on its own". They did, in the Supabase SQL Editor, and got
     *
     *       ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a
     *       transaction block
     *
     *   The Editor wraps every submission in a transaction and has no setting
     *   for that — and build-deploy-sql.mjs's own header says the Editor is the
     *   only route here, "because neither psql nor the Supabase CLI is
     *   installed". So the 430x fix above sat unapplied while THREE places in
     *   this repository recorded the instruction nobody could follow: the file's
     *   header, the builder's EXCLUDED list, and the test right here, which
     *   asserted CONCURRENTLY was the safe choice.
     *
     *   A test can pin a file to a form that cannot be used. This one did.
     */
    it('APPLIES INSIDE A TRANSACTION BLOCK — the thing that failed', async () => {
        //   The assertion that matters, and the only one that could have caught
        //   this: submit the real file the way the SQL Editor submits it, then
        //   ask what it left behind.
        //
        //   The error is caught rather than thrown so the failure REPORTS the
        //   Postgres code. A raw throw here would say "query failed"; `25001` is
        //   the whole finding.
        await client!.query('BEGIN');
        const failed = await client!
            .query(readFileSync(SQL_027, 'utf-8'))
            .then(() => null, (e: any) => ({ code: e.code, message: e.message }));
        await client!.query(failed ? 'ROLLBACK' : 'COMMIT');

        expect(failed).toBeNull();

        /*
         *   ASKED OF THE DEFINITION, NOT THE NAME — and #051 is why.
         *
         *   This read `indexname like '%_created_at'`, which is a proxy: it
         *   assumes every index whose NAME ends that way is one of 027's eight
         *   column indexes, and nothing else will ever be named that way.
         *
         *   051 added `idx_users_raw_created_at` — a btree on the JSON KEY
         *   `raw_data->>'createdAt'`, which is a different index answering a
         *   different query. Its name ends in `_created_at`, so `users`
         *   appeared TWICE in this list and the count below read 9 for 8.
         *
         *   #263 recorded the neighbouring hazard — a name that CONTAINS an
         *   existing one — and the author of 051 checked for exactly that and
         *   found none. The hazard that actually bit is the other direction: a
         *   name that matches a PATTERN some other test greps for. A name
         *   cannot be audited against every LIKE in the suite, so the fix is
         *   here, in the question.
         *
         *   `btree (created_at` matches only an index on the COLUMN, which is
         *   what 027 creates and what this test has always been about. It is
         *   narrower than the name match, not looser: an expression index can
         *   no longer satisfy it, and neither can a future
         *   `something_created_at` on an unrelated expression.
         */
        const { rows } = await client!.query(
            `select tablename from pg_indexes
             where schemaname='public' and indexdef like '%btree (created_at%'
               and tablename = any($1)`,
            [DEDICATED],
        );
        expect({ indexed: rows.map((r: any) => r.tablename).sort() })
            .toEqual({ indexed: [...DEDICATED].sort() });
    });

    it('POSITIVE CONTROL: the CONCURRENTLY form really does fail that way', async () => {
        // Without this, "the file applied" could mean the harness never wrapped
        // anything in a transaction and the test proves nothing.
        await client!.query('BEGIN');
        const failed = await client!
            .query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_probe_469 ON public.users (created_at DESC)')
            .then(() => null, (e: any) => e);
        await client!.query('ROLLBACK');

        expect(failed?.code).toBe('25001');
    });

    it('IS RE-RUNNABLE — a timed-out run must be resumable', async () => {
        // The lock_timeout below converts a stall into an abort, which is only
        // an improvement if running it again finishes the job.
        for (let i = 0; i < 2; i += 1) await client!.query(readFileSync(SQL_027, 'utf-8'));

        //   By definition rather than by name — see the note above.
        const { rows } = await client!.query(
            `select count(*)::int as n from pg_indexes
             where schemaname='public' and indexdef like '%btree (created_at%'
               and tablename = any($1)`,
            [DEDICATED],
        );
        expect(rows[0].n).toBe(DEDICATED.length);
    });

    it('AND LEAVES NO INVALID INDEX BEHIND', async () => {
        // The failure mode CONCURRENTLY has and the plain form does not: an
        // index the planner ignores and every write still maintains.
        const { rows } = await client!.query('select indexrelid::regclass::text as name from pg_index where not indisvalid');
        expect({ invalid: rows.map((r: any) => r.name) }).toEqual({ invalid: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#469 — and it says what the cheap route actually costs', () => {
    it('NO STATEMENT IN IT IS CONCURRENTLY', () => {
        expect(statements()).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
    });

    it('EVERY BUILD IS GUARDED BY A lock_timeout', () => {
        //   The one real risk of a plain build is not its duration — it is that
        //   the ShareLock request QUEUES behind any open transaction on the
        //   table, and every writer arriving after queues behind the request.
        //   Without this line a 718 ms build can become a stall.
        const body = statements();
        const guard = body.indexOf('SET lock_timeout');
        const firstCreate = body.search(/CREATE\s+INDEX/i);

        expect(guard).toBeGreaterThanOrEqual(0);
        expect(guard).toBeLessThan(firstCreate);
    });

    it('AND IT COVERS EXACTLY THE DEDICATED TABLES', () => {
        const body = statements();
        const creates = body.split('\n').filter((l) => l.trim().startsWith('CREATE INDEX'));

        expect(creates.length).toBe(DEDICATED.length);
        for (const table of DEDICATED) {
            expect({ table, covered: body.includes(`ON public.${table} (created_at DESC)`) })
                .toEqual({ table, covered: true });
        }
    });

    it('and every one is IF NOT EXISTS — the re-run above depends on it', () => {
        for (const line of statements().split('\n').filter((l) => l.trim().startsWith('CREATE INDEX'))) {
            expect({ line, idempotent: line.includes('IF NOT EXISTS') }).toEqual({ line, idempotent: true });
        }
    });

    it('and it carries the measurement, not just the intent', () => {
        // 022 is marked DO NOT APPLY on ITS measurements. A sibling migration
        // that only asserted "this will be faster" would be the thing 022 warns
        // against.
        const body = sql();

        expect(body).toContain('26.496 ms');
        expect(body).toContain('0.061 ms');
        expect(body).toContain('Sort Key: created_at DESC');
    });

    it('AND CORRECTS THE CLAIM THAT MADE THE CHEAP ROUTE LOOK UNACCEPTABLE', () => {
        //   The first draft said the plain form "takes an ACCESS EXCLUSIVE lock
        //   and blocks every read and write". Asked directly, it takes a
        //   ShareLock — reads are unaffected. That wrong sentence is why the
        //   unusable form looked like the only safe one, so the corrected fact
        //   has to survive in the file rather than only in a commit message.
        const body = sql();

        expect(body).toContain('ShareLock');
        expect(body).toContain('READS KEEP WORKING');
    });

    it('and still tells the operator how to check an INVALID build, for the form that can leave one', () => {
        expect(sql()).toContain('WHERE NOT indisvalid');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#469 — asked of the database, not read off the file', () => {
    it('A PLAIN CREATE INDEX TAKES ShareLock, NOT AccessExclusiveLock', async () => {
        // The premise of the whole rewrite. If a future Postgres changed this,
        // the header's cost argument is wrong and somebody must re-read it.
        await client!.query('BEGIN');
        await client!.query('CREATE INDEX idx_probe_469_lockmode ON public.users (created_at DESC)');
        const { rows } = await client!.query(
            `select l.mode from pg_locks l join pg_class c on c.oid = l.relation
             where c.relnamespace = 'public'::regnamespace
               and c.relname = 'users' and l.pid = pg_backend_pid()`,
        );
        await client!.query('ROLLBACK');

        const modes = rows.map((r: any) => r.mode);
        expect(modes).toContain('ShareLock');
        expect(modes).not.toContain('AccessExclusiveLock');
    });

    it('AND READS KEEP WORKING WHILE ONE IS HELD', async () => {
        /*
         *   ShareLock is only good news if ACCESS SHARE does not conflict with
         *   it. Rather than trust the table, hold one and read through it.
         *
         *   #651 — THIS ASSERTED `count(*) > 0` AND SO NEEDED A DATABASE
         *   SOMEBODY HAD ALREADY USED. On a cluster made a minute ago by
         *   ./scripts/local-postgres.sh — the exact command this suite's own
         *   header tells you to run — `users` is empty, the read returns 0, and
         *   the test fails having proved nothing was wrong.
         *
         *   It also measured the wrong thing. The claim is "the read is not
         *   blocked"; a row count is evidence of that only by accident, and
         *   would go on being "true" if the query returned stale nonsense. What
         *   proves it is that the read COMPLETES, promptly, while the lock is
         *   held — so the reader now inserts its own row first and then asserts
         *   it can see exactly that row through the lock.
         *
         *   A test that passes only on a database with history is a test that is
         *   red in CI and green on the laptop of whoever wrote it, which is one
         *   of the reasons this suite ran nowhere.
         */
        const reader = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
        await reader.connect();
        const probeId = `probe-469-${Date.now()}`;
        try {
            await client!.query(
                `insert into public.users (id, raw_data) values ($1, '{}'::jsonb)
                 on conflict (id) do nothing`,
                [probeId],
            );

            await client!.query('BEGIN');
            await client!.query('LOCK TABLE public.users IN SHARE MODE');

            const { rows } = await reader.query(
                'select count(*)::int as n from public.users where id = $1', [probeId],
            );
            expect(rows[0].n).toBe(1);
        } finally {
            await client!.query('ROLLBACK');
            await client!.query('delete from public.users where id = $1', [probeId])
                .catch(() => {});
            await reader.end().catch(() => {});
        }
    });

    it('AND A WRITER DOES NOT — which is the cost being accepted', async () => {
        // The control for the test above: if nothing conflicted with ShareLock,
        // "reads keep working" would be trivially true and would not mean the
        // lock is mild.
        const writer = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
        await writer.connect();
        try {
            await client!.query('BEGIN');
            await client!.query('LOCK TABLE public.users IN SHARE MODE');

            await writer.query('BEGIN');
            await writer.query("SET lock_timeout = '1s'");
            const failed = await writer
                .query('LOCK TABLE public.users IN ROW EXCLUSIVE MODE')
                .then(() => null, (e: any) => e);
            await writer.query('ROLLBACK').catch(() => {});

            expect(failed?.code).toBe('55P03'); // lock_not_available
        } finally {
            await client!.query('ROLLBACK');
            await writer.end().catch(() => {});
        }
    });
});
