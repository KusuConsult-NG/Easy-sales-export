/**
 * @jest-environment node
 */

/**
 *   #673 A SUITE THAT SEEDS ROWS MUST PUT THE STATISTICS BACK, NOT JUST THE
 *   ROWS.
 *
 *   `created-at-is-indexed-where-it-is-ordered` asserts that the planner picks
 *   `idx_users_created_at`. That is only true of a table WITH ROWS IN IT —
 *   against an empty `users`, a sequential scan is the correct plan and
 *   Postgres choosing it is the database working.
 *
 *   It never seeded any. For months it passed on whatever the file before it
 *   had left behind, and it went red the day #671 added an assertion to an
 *   unrelated file, reordered the `--runInBand` run, and put it first.
 *
 *   TWO SUITES PRODUCED THAT RESIDUE. Both seed tens of thousands of rows into
 *   `public.users`, `analyze` as they go, and delete the rows in `afterAll` —
 *   AND A DELETE DOES NOT UPDATE PLANNER STATISTICS. So `pg_class.reltuples`
 *   went on claiming the rows were there, and the next suite to read a query
 *   plan measured a table that no longer existed.
 *
 *   Both re-analyse now. This file is what stops that becoming a rule in two
 *   places waiting to drift — which is this audit's fourth-most-common finding,
 *   and the reason a one-line cleanup is worth a test.
 *
 * ── WHY THIS IS A UNIT TEST AND NOT A DATABASE ONE ──────────────────────────
 *
 *   Because the suites it polices are the ones that SKIP without a database
 *   (#672), so a database test could not be relied on to run. This asks a
 *   question about the source, which is answerable anywhere, and it runs in the
 *   suite that gates every push.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const DIR = join(process.cwd(), 'src/__tests__/pg');

const PG_SUITES = readdirSync(DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();

/** The source, with comments removed — a prose mention of `analyze` is not one. */
const code = (file: string) =>
    stripComments(readFileSync(join(DIR, file), 'utf8'), { label: `pg/${file}` });

/**
 * Does this suite touch PLANNER STATISTICS on a shared table?
 *
 *   THE RULE IS NARROWER THAN "does it seed", AND THE FIRST VERSION WAS NOT.
 *
 *   Asking "does it insert rows" flagged three further suites —
 *   a-blank-email-is-not-an-identity, login-finds-the-profile-it-already-has
 *   and the-sql-segments-agree-with-the-javascript. All three insert a handful
 *   of rows, delete them, and run NO ANALYZE AT ALL, so they leave statistics
 *   exactly as they found them and cannot produce the residue this file is
 *   about.
 *
 *   Requiring them to re-analyse would have been a manufactured finding — a
 *   check reporting work that does not need doing, which is precisely what the
 *   forensic scan was doing to the owner in #671. The mechanism is ANALYZE, so
 *   the rule is about ANALYZE.
 */
const analysesStatistics = (src: string) => /analyze\s+public\./i.test(src);

/** Does it remove rows from a shared table? */
const deletesRows = (src: string) => /delete\s+from\s+public\./i.test(src);

/**
 * Is every removal of rows followed by an ANALYZE of the same schema?
 *
 *   NOT "does afterAll mention analyze". The first version sliced from
 *   `afterAll(` to the end of the file and reported
 *   created-at-is-indexed-where-it-is-ordered — THE SUITE THIS FINDING IS
 *   ABOUT, and one that does re-analyse — as failing, because its teardown
 *   calls a helper declared above the hook.
 *
 *   A checker that cannot see a one-line extraction would have taught whoever
 *   met it to inline the call to satisfy the test. What matters is that a
 *   delete and an analyse travel together, wherever they live.
 */
export const everyDeleteIsFollowedByAnAnalyse = (src: string): boolean => {
    const WINDOW = 800;
    for (const match of src.matchAll(/delete\s+from\s+public\./gi)) {
        const at = match.index ?? 0;
        const statement = src.slice(at, at + 140);

        /*
         *   ONLY BULK DELETES. A `where id = $1` removing the single row an
         *   adapter test just wrote cannot move a table's statistics, and
         *   demanding an ANALYZE after it would be asking for work that does
         *   nothing — the second time this rule has had to be narrowed, and the
         *   same lesson both times: the mechanism is a POPULATION being added
         *   and removed, so the check has to be about populations.
         *
         *   The tagged `where id like '<TAG>-%'` form is how every suite here
         *   removes one, which makes it the honest marker.
         */
        if (!/\blike\b/i.test(statement)) continue;

        /*
         *   THE WINDOW STOPS AT THE END OF THE ENCLOSING FUNCTION.
         *
         *   A flat 800 characters reached into the NEXT one: in
         *   created-at-is-indexed-where-it-is-ordered the cleanup helper is
         *   followed immediately by the seeding helper, which analyses for its
         *   own reasons — so a mutant that deleted the cleanup's analyse
         *   SURVIVED, satisfied by the seed's.
         *
         *   A check that accepts the right word in the wrong function is
         *   `toContain` on a whole file wearing a hat, which this audit has now
         *   been caught by in #665, #667 and here.
         */
        const rest = src.slice(at, at + WINDOW);
        const endOfFunction = rest.indexOf('\n};');
        const scope = endOfFunction >= 0 ? rest.slice(0, endOfFunction) : rest;

        if (!/analyze\s+public\./i.test(scope)) return false;
    }
    return true;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#673 — a suite that re-plans the table puts the statistics back', () => {
    const analysers = PG_SUITES.filter((f) => analysesStatistics(code(f)));

    it('THERE ARE SUITES THAT DO THIS TO CHECK', () => {
        /*
         *   THE control, and the one that matters most in a file shaped like
         *   this. Every assertion below is over a filtered list, and a filter
         *   that matches nothing satisfies all of them — a check that cannot
         *   fail, which is the defect this audit has removed more often than
         *   any other.
         */
        expect(analysers.length).toBeGreaterThanOrEqual(3);
    });

    it.each(PG_SUITES.filter((f) => analysesStatistics(code(f))))(
        '%s CLEANS UP ITS ROWS AND ITS STATISTICS',
        (file) => {
            const src = code(file);

            //   It removes what it wrote …
            expect(`${file} deletes: ${deletesRows(src)}`).toBe(`${file} deletes: true`);
            //   … and tells the planner each time, because a DELETE does not.
            expect(`${file} re-analyses after each delete: ${everyDeleteIsFollowedByAnAnalyse(src)}`)
                .toBe(`${file} re-analyses after each delete: true`);
        },
    );

    it('AND A SUITE THAT NEVER ANALYSES IS NOT ASKED TO', () => {
        /*
         *   The other half of the narrowing above, pinned so the rule cannot
         *   quietly widen back. Three suites insert and delete a handful of
         *   rows without ever touching statistics; they are outside this
         *   mechanism, and a check that dragged them in would be reporting work
         *   that does not need doing.
         */
        const untouched = PG_SUITES.filter((f) => !analysesStatistics(code(f)) && deletesRows(code(f)));

        expect(untouched.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#673 — the checker itself, against known answers', () => {
    /*
     *   WITHOUT THIS THE RULE ABOVE CANNOT FAIL. A mutant that made
     *   `everyDeleteIsFollowedByAnAnalyse` skip EVERY delete — turning it into
     *   a function that returns true unconditionally — SURVIVED the first
     *   mutation run, because every real suite in the repository satisfies the
     *   rule and nothing asked the checker about a suite that does not.
     *
     *   This is the cure #670 recorded, applied again: a decision worth
     *   trusting is a named function exercised on inputs whose answers are
     *   known, not a predicate only ever pointed at data that agrees with it.
     */
    const bulkDeleteThenAnalyse = `
const cleanup = async () => {
    await client.query('delete from public.users where id like $1', [TAG]);
    await client.query('analyze public.users');
};`;

    const bulkDeleteAlone = `
const cleanup = async () => {
    await client.query('delete from public.users where id like $1', [TAG]);
};`;

    const analyseInTheNextFunction = `
const cleanup = async () => {
    await client.query('delete from public.users where id like $1', [TAG]);
};

const seed = async () => {
    await client.query('insert into public.users select 1');
    await client.query('analyze public.users');
};`;

    const singleRowDelete = `
const cleanup = async () => {
    await client.query('delete from public.users where id = $1', [probeId]);
};`;

    it('IT ACCEPTS A BULK DELETE THAT RE-ANALYSES', () => {
        expect(everyDeleteIsFollowedByAnAnalyse(bulkDeleteThenAnalyse)).toBe(true);
    });

    it('AND REJECTS ONE THAT DOES NOT', () => {
        //   THE case the rule exists for, and the one no real file supplies.
        expect(everyDeleteIsFollowedByAnAnalyse(bulkDeleteAlone)).toBe(false);
    });

    it('AND IS NOT SATISFIED BY AN ANALYSE IN THE NEXT FUNCTION', () => {
        //   The survivor that forced the window to stop at `\n};`.
        expect(everyDeleteIsFollowedByAnAnalyse(analyseInTheNextFunction)).toBe(false);
    });

    it('AND IGNORES A SINGLE-ROW DELETE, WHICH CANNOT MOVE STATISTICS', () => {
        //   The narrowing, pinned. Without this the rule could widen back and
        //   demand pointless work of three suites that never analyse at all.
        expect(everyDeleteIsFollowedByAnAnalyse(singleRowDelete)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#673 — and the suite that was caught by this seeds what it measures', () => {
    const CAUGHT = 'created-at-is-indexed-where-it-is-ordered.test.ts';

    it('IT IS STILL THERE UNDER THAT NAME', () => {
        //   So the two assertions below cannot pass by reading nothing — the
        //   same trap as the filter above.
        expect(PG_SUITES).toContain(CAUGHT);
    });

    it('AND IT PUTS ROWS IN BEFORE ASKING THE PLANNER ABOUT THEM', () => {
        /*
         *   THE defect. It asked the planner to prefer an index on a table it
         *   had not populated, so the answer was about the previous suite.
         *
         *   Anchored on the seed being CALLED, not merely defined: a helper
         *   that exists and is never invoked is how a fix reaches nothing, and
         *   this file has met that shape before.
         */
        const src = code(CAUGHT);
        expect(src).toContain('await seedProbeRows();');
        expect(src).toContain('analyze public.users');
    });

    it('AND THE SEED IS BIG ENOUGH THAT AN INDEX SCAN CAN WIN', () => {
        /*
         *   A seed of five rows would satisfy the line above and change
         *   nothing: the planner would still sequentially scan, and the test
         *   would fail for the original reason while looking fixed.
         */
        const rows = Number(code(CAUGHT).match(/PROBE_ROWS\s*=\s*([\d_]+)/)?.[1]?.replace(/_/g, ''));
        expect(rows).toBeGreaterThanOrEqual(1000);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE RESIDUE: the role-scan suite stops re-analysing              KILLED
 *     the listing suite stops re-analysing                             KILLED
 *     the caught suite stops re-analysing on cleanup                   KILLED
 *       — SURVIVED first. The window was a flat 800 characters and ran
 *         past the end of the cleanup helper into the SEEDING helper
 *         below it, which analyses for its own reasons. A check
 *         satisfied by the right word in the wrong function is
 *         `toContain` on a whole file wearing a hat — #665 and #667 were
 *         both that, and this is the third. The window stops at `\n};`.
 *     the caught suite stops calling its seed                          KILLED
 *     the seed shrinks to a handful of rows                            KILLED
 *     the analyser filter matches nothing                              KILLED
 *     the bulk-delete narrowing swallows every delete                  KILLED
 *       — SURVIVED first, and nothing in the file could have caught it:
 *         every real suite satisfies the rule, so a checker that
 *         returned true unconditionally agreed with all of them. The
 *         known-answer tests above are #670's recorded cure, applied.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                               SURVIVED ✓
 *
 * ── WHAT THIS DOES NOT CLAIM ────────────────────────────────────────────────
 *
 *   That the pg suites are now order-independent. They share one database and
 *   several of them write to `public.users`; this closes the one coupling that
 *   actually produced a red CI, and names the discipline so the next person
 *   adding a seeding suite meets it. A real answer would give each suite its
 *   own schema, which is a change to the harness rather than to a test, and is
 *   not something to attempt while chasing a specific failure.
 */
