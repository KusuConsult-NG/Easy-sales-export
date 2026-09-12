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
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { dbDescribe as sharedDbDescribe, restDescribe } from '@/lib/testing/pg-harness';

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
                jsonb_build_object('fullName', 'Probe ' || g)
           from generate_series(1, $2::int) g`,
        [TAG, PROBE_ROWS],
    );
    await client!.query('analyze public.users');
};

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
        const { rows } = await client!.query(
            `explain (analyze, format json)
             select id from users order by raw_data->>'fullName' limit 20`,
        );

        expect(JSON.stringify(rows[0]['QUERY PLAN'])).toContain('"Node Type":"Sort"');
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

        const { rows } = await client!.query(
            `select tablename from pg_indexes
             where schemaname='public' and indexname like '%_created_at'
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

        const { rows } = await client!.query(
            `select count(*)::int as n from pg_indexes
             where schemaname='public' and indexname like '%_created_at'
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
