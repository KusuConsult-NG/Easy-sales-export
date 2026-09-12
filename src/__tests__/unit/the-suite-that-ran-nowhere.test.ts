/**
 * @jest-environment node
 */

/**
 *   #651 THE SUITE HOLDING THE MONEY LAYER'S CONCURRENCY PROOFS RAN NOWHERE.
 *
 *   There are three test harnesses in this repository and they cover different
 *   things:
 *
 *     the unit run          mocks `@/lib/supabase-db` globally, so it cannot
 *                           execute one line of the SQL.
 *     jest.config.db.js     real Postgres through PostgREST. Tests the ADAPTER.
 *     jest.config.pg.js     two connections to one real database, firing the
 *                           same claim AT ONCE, proving exactly one wins.
 *
 *   The third is the only one that can check the thing every money path in this
 *   platform is built on — `claim_status_transition`, `debit_wallet_locked`,
 *   `credit_wallet_once`, `increment_within_ceiling`, `claim_idempotency_key`.
 *   Its own header says why the other two cannot.
 *
 *   `test:integration` and `test:db` each got a CI job AND a guard that turns a
 *   silent skip into a failure. `test:pg` got neither. It appears in
 *   package.json, in a local helper's echo, and in no workflow at all.
 *
 * ── WHAT WAS NOT RUNNING ────────────────────────────────────────────────────
 *
 *   money-functions.test.ts           the concurrency proofs themselves.
 *   fake-db-matches-postgres.test.ts  THE CONTRACT TEST. lib/testing/fake-db's
 *                                     header cites it as the reason its claims
 *                                     about matching Postgres are "measured
 *                                     rather than asserted" — and every suite in
 *                                     this repository that calls installFakeDb
 *                                     rests on that sentence being true.
 *
 *   Both were executed against a real PostgreSQL 16 with the app's schema and
 *   all 33 migrations while this finding was written. BOTH PASS. So the claims
 *   were sound; what was missing was anything that would notice if they stopped
 *   being.
 *
 * ── AND IT COULD NOT HAVE BEEN WIRED UP AS IT STOOD ─────────────────────────
 *
 *   Run exactly as its own documentation instructs, `npm run test:pg` was RED —
 *   22 tests across 5 suites, every one of them named "THE ADAPTER", failing
 *   with `TypeError: fetch failed`. They go through `lib/supabase-db.ts`, which
 *   speaks PostgREST, and `scripts/local-postgres.sh` says in its own header
 *   that it deliberately does not serve PostgREST.
 *
 *   So the directory mixed two harness requirements under one config, and a
 *   suite that cannot pass in its own harness is a suite nobody runs. The two
 *   capabilities are asked for separately now: a plain Postgres runs every SQL
 *   test and reports the adapter ones as SKIPPED, and CI — where the Supabase
 *   stack provides both — runs all of them.
 *
 *   ONE MORE THING WAS RED FOR A DIFFERENT REASON, and it is this audit's
 *   favourite shape: `AND READS KEEP WORKING WHILE ONE IS HELD` asserted
 *   `count(*) > 0` on `users`, so it needed a database somebody had already
 *   used. On a cluster made a minute earlier by the command the suite's own
 *   header gives you, it failed having proved nothing. It also measured the
 *   wrong thing — the claim is that the read is not BLOCKED, and a row count is
 *   evidence of that only by accident. It inserts its own row now.
 *
 * ── WHY THIS FILE IS A SOURCE TEST ──────────────────────────────────────────
 *
 *   The default run cannot execute the pg suites — that is the whole point of
 *   them. So what is guarded here is the WIRING: that the workflow still invokes
 *   them, that the invocation cannot pass by skipping, and that the gate they
 *   share is still one gate. Without this, deleting the CI step restores the
 *   exact state this finding is about and nothing says a word.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { stripYamlComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The workflow with its COMMENTS REMOVED.
 *
 *   #651 — and this is the reason, found by a surviving mutant on the first
 *   run. `expect(CI).toContain('npm run test:pg')` passed after the step was
 *   replaced with `echo skipping`, because the paragraph ABOVE the step — the
 *   one explaining why it had never existed — says `npm run test:pg` in prose.
 *
 *   My own write-up satisfied the assertion about the code. That is the trap
 *   this audit strips comments for everywhere else, met here in a file format
 *   where I had not thought to.
 *
 *   #656 needed the same thing for a different step in the same workflow, so
 *   the filter moved into lib/testing/strip-comments beside the TypeScript one
 *   rather than becoming a second copy. Behaviour is unchanged — whole-line
 *   comments only.
 */
const CI = stripYamlComments(read('.github/workflows/ci.yml'));
const PG_DIR = 'src/__tests__/pg';
const PG_SUITES = readdirSync(join(ROOT, PG_DIR))
    .filter((f) => f.endsWith('.test.ts'))
    .sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#651 — the money SQL is invoked by CI', () => {
    it('A WORKFLOW RUNS test:pg', () => {
        //   THE defect. It was in package.json and in nothing that runs.
        expect(CI).toContain('npm run test:pg');
    });

    it('AND THE STEP CANNOT PASS BY SKIPPING', () => {
        /*
         *   The suites skip when LOCAL_PG_URL is absent, which is right on a
         *   laptop and wrong here — it is how `npm run test:db` reported
         *   "8 skipped" for as long as it existed with nobody reading it as a
         *   problem. The step asserts the variable before running.
         *
         *   ANCHORED ON THE WHOLE GUARD, not on the test expression. The first
         *   version checked that `test -n "$LOCAL_PG_URL"` appeared somewhere,
         *   and a mutant that turned it into `test -n "$LOCAL_PG_URL" || true ||`
         *   — which disarms it completely — survived, because the text it looked
         *   for was still there. A check on the presence of a line is not a
         *   check on what the line does; that is the same sentence #649's
         *   surviving mutant produced, two findings ago.
         */
        expect(CI).toContain('test -n "$LOCAL_PG_URL" || {');
        expect(CI).toContain('exit 1');
        expect(CI).not.toMatch(/LOCAL_PG_URL" \|\| true/);
    });

    it('AND THE HARNESS THAT STARTS THE DATABASE HANDS IT OVER', () => {
        //   The other half: the assertion above is only satisfiable because
        //   ci-integration-db.sh exports the URL of the Postgres it has just
        //   applied the schema and every migration to.
        const script = read('scripts/ci-integration-db.sh');
        expect(script).toContain('LOCAL_PG_URL=$DB_URL');
        //   Both branches — under Actions and when run by hand.
        expect((script.match(/LOCAL_PG_URL=\$DB_URL/g) ?? []).length).toBe(2);
    });

    it('AND THE TWO SUITES THAT MATTER ARE STILL IN THAT DIRECTORY', () => {
        /*
         *   A positive control on everything above. "CI runs test:pg" means
         *   nothing if the files it was wired up for have moved out from under
         *   it, and these two are the reason the wiring is worth having.
         */
        expect(PG_SUITES).toEqual(expect.arrayContaining([
            'money-functions.test.ts',
            'fake-db-matches-postgres.test.ts',
        ]));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#651 — and the gate they share is one gate', () => {
    it('NO SUITE HAND-WRITES ITS OWN', () => {
        /*
         *   `const dbDescribe = (REQUESTED ? describe : describe.skip)` was
         *   written out identically in all ten. A rule in ten places is a rule
         *   waiting to drift, and this audit has spent most of its time on what
         *   happens when one does.
         */
        const offenders = PG_SUITES.filter((f) =>
            /const dbDescribe[^\n]*describe\.skip/.test(read(`${PG_DIR}/${f}`)));

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND EVERY ONE OF THEM ASKS THE SHARED MODULE', () => {
        //   The other half: "nobody hand-writes it" is also satisfied by
        //   deleting the gate, which would run database tests with no database.
        const asking = PG_SUITES.filter((f) =>
            read(`${PG_DIR}/${f}`).includes("from '@/lib/testing/pg-harness'"));

        expect(asking).toEqual(PG_SUITES);
    });

    it('AND THE ADAPTER BLOCKS ASK FOR POSTGREST SEPARATELY', () => {
        /*
         *   The change that made the suite runnable at all. These go through
         *   lib/supabase-db, which speaks PostgREST; the plain-Postgres harness
         *   does not serve it and says so. Asking for the two capabilities as
         *   one is what left 22 tests failing for a dependency the harness never
         *   claimed to provide.
         */
        const usingRest = PG_SUITES.filter((f) =>
            read(`${PG_DIR}/${f}`).includes('restDescribe('));

        expect(usingRest).toEqual([
            'a-blank-email-is-not-an-identity.test.ts',
            'aggregate-reads-the-column.test.ts',
            'login-finds-the-profile-it-already-has.test.ts',
            'the-role-scan-reads-the-whole-table-without-the-index.test.ts',
        ]);
    });

    it('AND A DECLARED-BUT-ABSENT STACK FAILS LEGIBLY', () => {
        /*
         *   A URL is a declaration, not a service. A stale .env.development.local
         *   from a stack that is no longer up produced 19 `TypeError: fetch
         *   failed` and nothing saying why — the third form of a confusion that
         *   has already cost this codebase a diagnosis twice.
         *
         *   It still FAILS, which is right: somebody asked for a stack, and
         *   quietly not using it is worse than a red suite. It fails once now,
         *   first, saying which of the two things to do.
         */
        const harness = read('src/lib/testing/pg-harness.ts');
        expect(harness).toContain('export async function assertRestReachable');
        const wired = PG_SUITES.filter((f) =>
            read(`${PG_DIR}/${f}`).includes('beforeAll(assertRestReachable)'));
        expect(wired.length).toBe(4);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the CI step is removed again                        KILLED
 *     the step can pass by skipping                                   KILLED
 *     the database URL stops being handed over                        KILLED
 *     one suite goes back to a hand-written gate                      KILLED
 *     the adapter blocks stop asking for PostgREST                    KILLED
 *     the legible-failure probe is unwired from one block             KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── TWO SURVIVED THE FIRST RUN AND BOTH WERE MINE ───────────────────────────
 *
 *   "The CI step is removed again" replaced `npm run test:pg` with
 *   `echo skipping`, and the suite stayed green — because the PARAGRAPH ABOVE
 *   the step, the one I had just written explaining why it never existed, says
 *   `npm run test:pg` in prose. My own write-up satisfied the assertion about
 *   the code. This audit strips comments before every source sweep for exactly
 *   this reason and I had not thought to do it to a YAML file.
 *
 *   "The step can pass by skipping" turned the guard into
 *   `test -n "$LOCAL_PG_URL" || true || { … }`, which disarms it completely, and
 *   survived because the text the assertion looked for was still there. A check
 *   on the presence of a line is not a check on what the line does — the same
 *   sentence #649's surviving mutant produced two findings ago, and the second
 *   time in three findings that a source-shape assertion has been the weak one.
 *
 *   Both are now anchored on the whole guard, over comment-stripped YAML.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The pg suites were run for real against PostgreSQL 16 with the app's schema
 *   and all 33 migrations, started by the repository's own
 *   ./scripts/local-postgres.sh:
 *
 *     before   10 suites, 6 failed, 22 tests failed  (every failure an adapter
 *              test, plus one that needed a database somebody had already used)
 *     after    10 suites passed, 126 passed, 23 skipped
 *
 *   money-functions.test.ts and fake-db-matches-postgres.test.ts both PASS. The
 *   CI step itself is the one thing here that could not be executed from this
 *   environment — GitHub Actions cannot be run locally — so the YAML is
 *   validated by parse and every piece it depends on is asserted above.
 */
