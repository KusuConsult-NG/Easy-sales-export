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
