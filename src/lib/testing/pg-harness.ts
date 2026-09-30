/**
 * What the real-database suites are allowed to assume — one answer, two gates.
 *
 *   #651 `npm run test:pg` COULD NOT GO GREEN, SO IT RAN NOWHERE.
 *
 *   `jest.config.pg.js` is the only harness that can do the thing the money
 *   layer depends on: two connections to one real database, firing the same
 *   claim at once, proving exactly one wins. Its own header says so, and says
 *   why neither of the other two can — the unit run mocks `@/lib/supabase-db`
 *   globally, and `jest.config.db.js` goes through PostgREST.
 *
 *   It is invoked by NO WORKFLOW. `test:integration` and `test:db` each got a
 *   CI job and a guard that turns "skipped" into a failure when CI is set;
 *   `test:pg` got neither. The fix reached one of two, which is the shape this
 *   audit finds more often than any other.
 *
 *   AND IT COULD NOT HAVE BEEN ADDED AS IT STOOD, because run exactly as its own
 *   documentation instructs —
 *
 *       ./scripts/local-postgres.sh start
 *       LOCAL_PG_URL=postgres://…:55432/app npm run test:pg
 *
 *   — it is RED. Twenty-two tests across five suites fail with
 *   `TypeError: fetch failed`, and every one of them is named "THE ADAPTER":
 *   they go through `lib/supabase-db.ts`, which speaks PostgREST, and
 *   `local-postgres.sh` says in its own header that it deliberately does not
 *   serve PostgREST — "Adapter-level tests stay with ci-integration-db.sh".
 *
 *   So the directory mixes two harness requirements under one config, and the
 *   consequence is that `money-functions.test.ts` and
 *   `fake-db-matches-postgres.test.ts` have never run in CI. The second of those
 *   is the contract test the fake database's own header cites as the reason its
 *   claims are "measured rather than asserted" — and every suite in this
 *   repository that calls `installFakeDb` rests on it.
 *
 * ── TWO CAPABILITIES, ASKED SEPARATELY ──────────────────────────────────────
 *
 *   A POSTGRES              `LOCAL_PG_URL`. Enough for SQL: functions, locks,
 *                           query plans, two concurrent connections.
 *   A POSTGREST IN FRONT    a usable Supabase URL. Needed by anything that goes
 *                           through the adapter, and by nothing else.
 *
 *   Asked separately because they ARE separate, and conflating them is what made
 *   the suite unrunnable. A plain Postgres now runs every SQL test and reports
 *   the adapter ones as SKIPPED — honestly, with Jest saying "skipped" — rather
 *   than failing them for a dependency the harness never claimed to provide.
 *
 *   SKIPPED IS NOT PASSED, and that distinction is the whole design here. The
 *   third state is the one that matters: a capability ASKED FOR and unreachable
 *   is a hard failure, because quietly not running what somebody requested is
 *   worse than a red suite. That is the rule `money-functions.test.ts` already
 *   states for the database, kept and extended rather than reinvented.
 *
 * ── AND ONE COPY, NOT TEN ───────────────────────────────────────────────────
 *
 *   `const dbDescribe = (REQUESTED ? describe : describe.skip)` was written out
 *   in all ten suites, identically. That is a rule in ten places waiting to
 *   drift, and this audit has spent a good deal of time on what happens when it
 *   does. One definition now.
 */

import { describe } from '@jest/globals';
import { PLACEHOLDER_SUPABASE_URL } from '@/lib/supabase';

/** The database, when one was asked for. Empty string when none was. */
export const PG_URL: string = process.env.LOCAL_PG_URL ?? '';

/** Was a real PostgreSQL asked for? Decided synchronously, at module scope. */
export const HAS_PG: boolean = Boolean(PG_URL);

/**
 * Is there a PostgREST in front of it?
 *
 * `local-postgres.sh` serves Postgres alone and sets nothing here.
 * `ci-integration-db.sh` starts the full stack and exports its URL, so the
 * adapter tests run there without anybody wiring a second flag.
 *
 * The placeholder is excluded explicitly: `lib/supabase.ts` degrades a missing
 * URL to it (#451, so a bad value cannot fail a build), which is present enough
 * to look configured and useless enough to produce `TypeError: fetch failed` —
 * the exact confusion scripts/local-stack/jest-env.js was written about.
 */
export const HAS_REST: boolean = (() => {
    const url = process.env.LOCAL_REST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (!url) return false;
    if (url === PLACEHOLDER_SUPABASE_URL) return false;
    return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
})();

/**
 * Tests that need a database.
 *
 * `describe` when one was asked for, `describe.skip` when it was not — so Jest
 * reports a skip as a skip and a laptop with no cluster does not go red for an
 * optional dependency.
 */
export const dbDescribe: typeof describe =
    (HAS_PG ? describe : describe.skip) as typeof describe;

/**
 * Tests that additionally go through `lib/supabase-db.ts`.
 *
 * These need PostgREST, which is a different thing from a database, and saying
 * so is the whole of #651.
 */
export const restDescribe: typeof describe =
    (HAS_PG && HAS_REST ? describe : describe.skip) as typeof describe;

/**
 * Is the declared PostgREST actually there?
 *
 *   #651 — A URL IS A DECLARATION, NOT A SERVICE, and this codebase has been
 *   caught by that twice already: `.env.staging` carrying the three Supabase
 *   variables with EMPTY values ("present enough to look configured, empty
 *   enough to disable everything"), and `lib/supabase.ts` degrading a missing
 *   URL to a placeholder so that every read fails with a message naming the
 *   COLLECTION. scripts/local-stack/jest-env.js records losing a diagnosis to
 *   the second one.
 *
 *   A stale `.env.development.local` from a stack that is no longer up is the
 *   third form. The synchronous gate above cannot tell it from a live one — it
 *   has no way to reach out — so nineteen adapter tests fail with
 *   `TypeError: fetch failed` and nothing says why.
 *
 *   They SHOULD fail: somebody declared a stack, and quietly skipping what was
 *   asked for is worse than a red suite — that is this harness's own rule for
 *   the database, applied to the other capability. What they should not do is
 *   fail illegibly. Called from `beforeAll` in each adapter block, this fails
 *   once, first, and says which of the two things to do.
 */
export async function assertRestReachable(): Promise<void> {
    const url = process.env.LOCAL_REST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    try {
        //   Any answer at all proves something is listening. A 404 from
        //   PostgREST's root is as good as a 200 for this purpose.
        await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(4000),
        });
    } catch (error) {
        throw new Error(
            `This suite was pointed at a PostgREST at ${url} and nothing answered `
            + `(${error instanceof Error ? error.message : String(error)}).\n`
            + `Either start the local stack — ./scripts/local-stack/up.sh — or remove the `
            + `stale .env.development.local it wrote, in which case the adapter tests skip `
            + `and the SQL ones still run.`,
        );
    }
}

/**
 * ── ASKING THE PLANNER A QUESTION THAT SURVIVES THE CLUSTER'S HISTORY ────────
 *
 *   #972 TWO SUITES ASSERTED THAT THE PLANNER *CHOOSES* AN INDEX, AND BOTH WENT
 *   RED ON TREES THAT HAD NOT CHANGED.
 *
 *   `users`, `document_collections`, `marketplace_orders` and
 *   `processed_payments` are shared by every suite in this directory, and the
 *   suites seed tens of thousands of rows into them and delete them again.
 *   VACUUM gives the freed index pages back to the INDEX, never to the
 *   filesystem, so index files grow across runs and never shrink. Measured on
 *   one developer cluster: `idx_users_raw_created_at` at 237 pages over a
 *   135-page heap, for 5,000 rows that need 8; `idx_dc_collection_buyer` at
 *   5,139 pages over 1,812.
 *
 *   AN INDEX LARGER THAN THE TABLE IT INDEXES IS AN INDEX THE PLANNER IS RIGHT
 *   TO REFUSE. So an assertion of the form "the plan names this index" is partly
 *   a statement about how many times the suite has been run, and it fails on
 *   whichever commit happens to be in flight when the file crosses the cliff.
 *
 *   The question these suites MEAN is whether the predicate can use an index at
 *   all — a btree on `created_at` cannot serve `raw_data->>'createdAt'`, not
 *   "will not today" but CANNOT, and that is what 022 records and 051 fixed.
 *   `planWithTheIndexPricedToLose` asks exactly that, and owes nothing to a cost
 *   estimate. Where the preference itself is still worth asserting, the caller
 *   rebuilds the one index first and says so.
 */

/** Just enough of a `pg` Client, the way `waitUntilBlocked` does it. */
type Queryable = {
    query: (
        sql: string, params?: unknown[],
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/** A plan, and the price the planner put on it. */
export type PlanProbe = { plan: string; totalCost: number };

/**
 * `explain (analyze, format json)`, as text plus the top node's total cost.
 *
 * The cost is not decoration: it is what proves the probe below actually took
 * effect, and no caller has to remember to check it.
 */
export async function explainPlan(
    db: Queryable, sql: string, params: unknown[] = [],
): Promise<PlanProbe> {
    const { rows } = await db.query(`explain (analyze, format json) ${sql}`, params);
    const tree = rows[0]['QUERY PLAN'] as Array<{ Plan: Record<string, unknown> }>;
    return { plan: JSON.stringify(tree), totalCost: Number(tree[0].Plan['Total Cost']) };
}

/**
 * THE PLAN WHEN AN INDEX COULD ONLY BE THERE BECAUSE IT FITS. Two settings, and
 * both are load bearing:
 *
 *   random_page_cost = 1000   index access made absurdly expensive, so no cost
 *                             accident can explain an index appearing. Measured
 *                             on 051's query: under this alone the planner picks
 *                             a Seq Scan at 208.33, and the bitmap path it is
 *                             pushed onto costs 1124.55 — five times worse.
 *
 *   enable_seqscan = off      DISCOURAGED, which is not the same as forbidden,
 *                             and that is the whole point. Postgres adds a 1e10
 *                             penalty and STILL plans a Seq Scan when no index
 *                             can serve the predicate — measured, cost
 *                             10000000207.06, with 051's index dropped.
 *
 * So an index named in the returned plan is one the predicate can genuinely use,
 * whatever the table's size, the index's bloat, or what ANALYZE last thought.
 *
 * AND IT CHECKS ITS OWN PREMISE. If the forced plan does not cost MORE than the
 * plan the planner would have chosen freely, the pricing did not take effect and
 * this has quietly become an ordinary "is it cheapest" test — so it throws rather
 * than return an answer the caller would read as capability.
 *
 * `set local`, so both die with the rollback. (A bare SET would too — Postgres
 * reverts one on ROLLBACK, measured — but `local` says so at the call site
 * instead of resting on the rollback still being there.)
 */
export async function planWithTheIndexPricedToLose(
    db: Queryable, sql: string, params: unknown[] = [],
): Promise<PlanProbe> {
    const freely = await explainPlan(db, sql, params);

    await db.query('begin');
    let forced: PlanProbe;
    try {
        await db.query('set local random_page_cost = 1000');
        await db.query('set local enable_seqscan = off');
        forced = await explainPlan(db, sql, params);
    } finally {
        await db.query('rollback');
    }

    if (!(forced.totalCost > freely.totalCost)) {
        throw new Error(
            `the index pricing did not take effect: the forced plan costs `
            + `${forced.totalCost} and the free choice ${freely.totalCost}. `
            + `A forced plan that is no dearer than the free one means this probe `
            + `is measuring cost, not capability — see #972.`,
        );
    }
    return forced;
}

/** Pages, so a failure can say "the index is bloated" instead of "unused". */
export async function indexAndHeapPages(
    db: Queryable, index: string, table: string,
): Promise<{ indexPages: number; heapPages: number }> {
    const { rows } = await db.query(
        `select pg_relation_size($1::regclass) / 8192 as index_pages,
                pg_relation_size($2::regclass) / 8192 as heap_pages`,
        [index, table],
    );
    return {
        indexPages: Number(rows[0].index_pages),
        heapPages: Number(rows[0].heap_pages),
    };
}

/**
 * Rebuild ONE index, so its size reflects its rows rather than the suite runs
 * before it. Narrow on purpose: `reindex table` would shrink indexes other
 * suites assert the planner IGNORES, which is how one file's problem becomes
 * another's.
 */
export async function rebuildIndex(db: Queryable, index: string): Promise<void> {
    //   REINDEX takes an identifier, not a value, so this one cannot be a bound
    //   parameter. Callers pass a literal from their own source — never
    //   anything read from a database or the environment — and the shape is
    //   checked here rather than trusted.
    if (!/^[a-z_][a-z0-9_]*$/.test(index)) {
        throw new Error(`not an index name: ${index}`);
    }
    await db.query(`reindex index public.${index}`);
}

/**
 * Wait until `pid` is genuinely blocked on a lock, using `probe` to ask.
 *
 *   #653 — THE SYNCHRONISATION POINT FOR EVERY TWO-CALLER TEST, AND IT IS
 *   LOAD-BEARING. Found by a surviving mutant, twice.
 *
 *   A race written as "fire both, await the first" DEADLOCKS THE TEST whenever
 *   the second caller wins the lock: the first is being awaited, it waits for
 *   the second, and the second's commit never comes because nobody is awaiting
 *   it. The obvious repair — run A, then issue B, then commit A — is
 *   deterministic and quietly removes the race, because nothing makes B reach
 *   its statement before A commits. B then reads already-committed data and
 *   refuses for the ordinary reason, so deleting `FOR UPDATE` from the function
 *   changes nothing and the test goes on passing.
 *
 *   Polling pg_stat_activity is the honest arrangement: it waits for B to be
 *   actually blocked — on the row lock where there is one, on the UPDATE where
 *   there is not — so A's commit always lands while B is mid-flight. That is the
 *   only shape in which the lock is the thing under test.
 */
export async function waitUntilBlocked(
    probe: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
    pid: number,
): Promise<void> {
    for (let i = 0; i < 200; i++) {
        const { rows } = await probe.query(
            `select 1 from pg_stat_activity
              where pid = $1 and state = 'active' and wait_event_type = 'Lock'`,
            [pid],
        );
        if (rows.length > 0) return;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`backend ${pid} never blocked on a lock — the race did not happen`);
}

/**
 * What a run is about to do, printed once by whichever suite loads first.
 *
 * A skipped suite that says nothing is how `npm run test:db` reported
 * "8 skipped" for as long as it existed with nobody reading it as a problem.
 */
export function describeHarness(): string {
    if (!HAS_PG) return 'no LOCAL_PG_URL — database suites skipped';
    return HAS_REST
        ? 'Postgres and PostgREST: every suite runs'
        : 'Postgres only — adapter suites skipped (start the local stack for those)';
}
