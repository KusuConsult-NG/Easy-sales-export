/**
 * @jest-environment node
 */

/**
 *   #672 SEVEN CONSECUTIVE PUSHES WENT TO main WITH CI RED, AND EVERY ONE OF
 *   THEM PRINTED "✅ Unit tests passed" ON THE WAY OUT.
 *
 *   The owner noticed before the tooling did: "a lot of your push failed."
 *
 *   Every failure from c4b90aab onward was the SAME single test in the SAME
 *   single job — `integration-tests` → "The money SQL, against the same
 *   database", which runs `npm run test:pg`. One test of 199, red for seven
 *   commits, on the suite that covers row locks, wallet debits and
 *   claim_status_transition.
 *
 *   TWO SEPARATE THINGS KEPT IT INVISIBLE, AND THEY ARE THE SAME SHAPE.
 *
 *   ── 1. THE STACK STARTS THE DATABASE AND DOES NOT SAY WHERE ──
 *
 *   `jest.config.pg.js` runs its database blocks only when `LOCAL_PG_URL` is
 *   set; without it every `dbDescribe` SKIPS. `scripts/local-stack/up.sh`
 *   brings up PostgreSQL on 127.0.0.1:54322 — exactly the database that suite
 *   needs, with the schema and every migration loaded — and wrote six
 *   variables to `.env.development.local`, none of them that one.
 *
 *   So on the setup this repository tells people to use, the documented
 *   command reported:
 *
 *       npm run test:pg
 *       Tests: 166 skipped, 34 passed, 200 total          exit 0
 *
 *   Success, having run none of the money SQL. A CHECK THAT PASSES BY NOT
 *   RUNNING — this audit's most-filed shape, on the layer that moves money,
 *   on the happy path.
 *
 *   It is one line. `scripts/local-stack/jest-env.js` already copies every key
 *   of that file into `process.env` before the pg suite loads, and `up.sh`
 *   already computes the URL as `DB_URL` for its own use. The value existed,
 *   the loader existed, and nothing carried one to the other.
 *
 *   MEASURED BOTH WAYS, against the live local stack:
 *
 *       without LOCAL_PG_URL in the file    166 skipped,  34 passed
 *       with it                               0 skipped, 200 passed
 *
 *   ── 2. THE PUSH GATE RAN ONE OF THE TWO SUITES CI RUNS ──
 *
 *   `.husky/pre-push` ran `npm run test` and nothing else. CI runs that AND
 *   `test:pg`. So the pg suite could go red and stay red across pushes without
 *   the person pushing ever being told — which is precisely what happened,
 *   seven times.
 *
 *   ── WHAT IS NOT CLAIMED ──
 *
 *   CI ITSELF WAS NEVER FOOLED, and that is worth stating because it would be
 *   easy to read this as a hole in CI. #651 put a shell assertion in the
 *   workflow — `test -n "$LOCAL_PG_URL" || exit 1` — precisely so the suites
 *   could not skip silently there, and it held: CI ran them, they failed, and
 *   it reported failure every time. The gap was between CI and the developer,
 *   not inside CI.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Shell and YAML comment at `#`; a source assertion strips them, every format. */
const stripHash = (src: string) =>
    src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

const UP = stripHash(read('scripts/local-stack/up.sh'));
const PREPUSH = stripHash(read('.husky/pre-push'));
const JEST_ENV = read('scripts/local-stack/jest-env.js');
const CI = read('.github/workflows/ci.yml');

// ─────────────────────────────────────────────────────────────────────────────
describe('#672 — the stack tells the money suite where the database is', () => {
    it('up.sh WRITES LOCAL_PG_URL INTO THE FILE THE SUITE READS', () => {
        /*
         *   THE defect, and the whole fix. Asserted on the ASSIGNMENT rather
         *   than on the name appearing: the name appeared in that script's
         *   prose before this change and in the header of the config that
         *   wanted it, which is how something this small stays missing.
         */
        expect(UP).toMatch(/^LOCAL_PG_URL=/m);
    });

    it('AND IT IS THE DATABASE up.sh ACTUALLY STARTED, NOT A SECOND SPELLING OF IT', () => {
        /*
         *   Two hand-maintained copies of one connection string is this audit's
         *   fourth-most-common finding, and here it would be silent: a wrong
         *   port would not fail, it would SKIP — back to 166 skipped and exit
         *   0, the exact state being fixed.
         *
         *   `DB_URL` is the variable the script already computes and uses for
         *   its own psql calls, so there is one definition and the file quotes
         *   it.
         */
        expect(UP).toContain('LOCAL_PG_URL=${DB_URL}');
        expect(UP).toMatch(/^DB_URL="postgresql:\/\/postgres@127\.0\.0\.1:\$\{PG_PORT\}\/postgres"$/m);
    });

    it('AND THE LOADER CARRIES ANY KEY OF THAT FILE, WHICH IS WHY ONE LINE IS ENOUGH', () => {
        /*
         *   The other half of the mechanism, asserted so that a later
         *   "optimisation" narrowing jest-env.js to the Supabase variables it
         *   was written for does not silently switch the money suite back off.
         */
        expect(JEST_ENV).toContain("if (process.env[key] === undefined) process.env[key] = value;");
    });

    it('AND AN EXPLICIT VARIABLE STILL WINS, WHICH IS WHAT CI RELIES ON', () => {
        //   CI sets LOCAL_PG_URL through $GITHUB_ENV and has no
        //   .env.development.local at all. The loader must not overwrite it.
        expect(JEST_ENV).toContain('process.env[key] === undefined');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#672 — and the push gate runs both suites CI runs', () => {
    it('IT RUNS THE UNIT SUITE', () => {
        /*
         *   The positive control. A change that swapped one suite for the other
         *   would satisfy every assertion below and lose more than it gained.
         *
         *   ANCHORED ON THE WHOLE LINE, and the first version was not: it asked
         *   for `toContain('npm run test')`, and `npm run test:pg` CONTAINS
         *   that string. A mutant that deleted the unit run entirely SURVIVED,
         *   because the line added by this very finding kept the assertion
         *   green.
         *
         *   A control that one of the things it is controlling can satisfy by
         *   itself is not a control. Same lesson as #667, where a refusal
         *   message was found in a different function of the same file, and
         *   #665, where a flag was mentioned twice on one screen.
         */
        expect(PREPUSH).toMatch(/^TZ=UTC npm run test$/m);
    });

    it('AND THE DATABASE SUITE', () => {
        //   THE defect: this hook ran the first and not the second, so seven
        //   pushes reported success onto a red main.
        expect(PREPUSH).toContain('npm run test:pg');
    });

    it('AND RESOLVES THE DATABASE THE STACK WROTE, NOT ONLY AN EXPORTED ONE', () => {
        /*
         *   Nobody exports LOCAL_PG_URL by hand — that is how this was missed.
         *   The hook has to read the file the stack writes, or it protects only
         *   the person who already knew.
         */
        expect(PREPUSH).toContain('.env.development.local');
        expect(PREPUSH).toContain('LOCAL_PG_URL');
    });

    it('AND A MACHINE WITH NO DATABASE IS TOLD, NOT BLOCKED', () => {
        /*
         *   Both halves matter.
         *
         *   NOT BLOCKED, because a push-time gate that fails on a laptop with
         *   no cluster gets bypassed with --no-verify, and a bypassed gate
         *   protects nothing at all — including the unit suite above it.
         *
         *   BUT TOLD, because silence is what this finding is about. "Unit
         *   tests passed" meant less than it appeared to for seven pushes, and
         *   the cure for that is not another silent skip.
         */
        expect(PREPUSH).toContain('NO DATABASE SUITE RUN');
        expect(PREPUSH).toContain('./scripts/local-stack/up.sh');
    });

    it('AND A FAILING DATABASE SUITE STOPS THE PUSH', () => {
        //   Running it and ignoring the result is the same silence wearing a
        //   different hat.
        expect(PREPUSH).toMatch(/npm run test:pg[\s\S]{0,200}exit 1/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#672 — and CI, which was never the one fooled, still cannot skip quietly', () => {
    it('THE WORKFLOW STILL ASSERTS THE DATABASE BEFORE RUNNING THE SUITE', () => {
        /*
         *   #651's guard, re-asserted rather than assumed. It is the reason CI
         *   reported these seven failures honestly while every local signal
         *   said green, and it is a shell line in a YAML file — the kind of
         *   thing a tidy-up removes because "the suite handles it".
         */
        expect(CI).toContain('test -n "$LOCAL_PG_URL"');
        expect(CI).toContain('npm run test:pg');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: up.sh stops writing LOCAL_PG_URL                    KILLED
 *     up.sh writes a second, hand-typed connection string             KILLED
 *     up.sh writes the wrong port                                     KILLED
 *     jest-env stops copying unknown keys                             KILLED
 *     jest-env overwrites an already-set variable                     KILLED
 *     pre-push stops running the database suite                       KILLED
 *     pre-push runs it but ignores the result                         KILLED
 *     pre-push only honours an exported variable                      KILLED
 *     pre-push skips silently when there is no database               KILLED
 *     pre-push stops running the unit suite                           KILLED
 *       — SURVIVED the first run, and the test was the fault. The control
 *         asked for `toContain('npm run test')`, which `npm run test:pg`
 *         satisfies on its own: the line this finding ADDED was keeping the
 *         assertion green while the unit suite was deleted. Anchored on the
 *         whole line instead. A control one of its own subjects can satisfy
 *         is not a control.
 *     the CI assertion on LOCAL_PG_URL is removed                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   Against the live local stack, twice, varying the one thing:
 *
 *       .env.development.local WITHOUT LOCAL_PG_URL   166 skipped, 34 passed
 *       .env.development.local WITH it                  0 skipped, 200 passed
 *
 *   Both runs with the variable ABSENT from the environment, so the file is
 *   demonstrably what carried it — the negative control #666 taught this audit
 *   to run, after two controls that both varied the migrations and neither the
 *   host.
 *
 *   The seven red runs were read from the workflow history rather than inferred:
 *   c4b90aab, 5f7cc10d, 320ef457, 0b01592c, 72e54b0c, 32ed1ae6, b885e412 and
 *   7e3a84f0, all `integration-tests`, all the same step, all one failing test.
 */
