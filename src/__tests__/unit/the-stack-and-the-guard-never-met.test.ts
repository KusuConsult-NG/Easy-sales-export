/**
 * @jest-environment node
 */

/**
 *   #655 THE LOCAL STACK TOLD YOU TO RUN THE SUITES, AND THE SUITES SKIPPED.
 *
 *   `scripts/local-stack/up.sh` brings up a complete local backend with no
 *   Docker — real PostgreSQL, real PostgREST, real schema, all migrations, RLS
 *   on — and finishes by printing what to do with it:
 *
 *       npm run dev          start the app against it
 *       npm run test:e2e     run the Playwright suite against it
 *       npm run test:db      run the DB/integration suites against it
 *
 *   FOLLOWING THAT LAST LINE RAN NOTHING. All 17 suites skipped, 161 tests, and
 *   `npm run test:integration` skipped 11 of its 31 beside them.
 *
 *   The stack writes its URL and keys to `.env.development.local`.
 *   `db-env-guard.js` looked in `.env.staging` — A FILE THAT IS NOT IN THIS
 *   REPOSITORY AT ALL. Two halves of one workflow, neither of them wrong on its
 *   own terms, that never met.
 *
 * ── AND THE FIX FOR THIS EXISTED ALREADY, ON THE OTHER HARNESS ──────────────
 *
 *   `scripts/local-stack/jest-env.js` was written for exactly this problem on
 *   the pg side, and its header says so — the stack writes a file that jest does
 *   not load, and the result was not a loud failure but a wall of
 *   `TypeError: fetch failed` that cost somebody a diagnosis.
 *
 *   The db harness has the same problem and never got the same fix. The fix
 *   reached one of two, which is the defect this audit finds more often than any
 *   other, and #651 is the same sentence one layer up: `test:integration` and
 *   `test:db` each got a CI job and a guard, and `test:pg` got neither.
 *
 *   The guard's own warning had got as far as DOCUMENTING THE MANUAL STEP —
 *   "then re-run with those variables exported from .env.development.local" —
 *   which is the step it now performs. It also said `.env.staging` "currently
 *   carries all three variables with EMPTY values", describing a file nobody
 *   has; that sentence is gone.
 *
 * ── MEASURED, BEFORE AND AFTER ──────────────────────────────────────────────
 *
 *     npm run test:db            0 of 161 ran   ->   161 of 161
 *     npm run test:integration   20 of 31 ran   ->    31 of 31
 *
 *   Both against the stack that up.sh brings up, with nothing exported by hand.
 *   172 tests a developer could not reach by following the instructions they
 *   were given.
 *
 *   CI IS UNAFFECTED and was never broken: it exports the ephemeral stack's
 *   values through `$GITHUB_ENV`, and dotenv does not override what is already
 *   set, so neither file is read there. This is a local-development repair, and
 *   the reason it matters is that "test locally" is how a defect gets found
 *   before it reaches production.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const GUARD = join(ROOT, 'src/lib/testing/db-env-guard.js');

/**
 * Run `resolveDbEnv` in a throwaway directory, with the two variables unset.
 *
 * A child process because the guard reads `process.cwd()` and mutates
 * `process.env` through dotenv — doing that in-process would leak the resolved
 * values into every test that ran afterwards in the same worker.
 */
/**
 * The parent's environment with the three variables genuinely REMOVED.
 *
 *   Spreading `process.env` and setting a key to `undefined` does not unset it
 *   for a child — it arrives as the literal string "undefined", which is truthy,
 *   so the guard reported `hasDb: true` with a URL of "undefined" and even the
 *   no-file control passed for the wrong reason. Deleted properly here.
 */
function cleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete env.CI;
    return env;
}

function resolveIn(files: Record<string, string>): { hasDb: boolean; url: string; isLocal: boolean } {
    const dir = mkdtempSync(join(tmpdir(), 'esx-655-'));
    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    const out = execFileSync(
        process.execPath,
        ['-e', `
            const { resolveDbEnv } = require(${JSON.stringify(GUARD)});
            //   Marked, because dotenv v17 prints a banner to STDOUT and the
            //   first version of this parsed it as JSON.
            process.stdout.write('<<655>>' + JSON.stringify(resolveDbEnv({ label: 'probe' })));
        `],
        { cwd: dir, encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out.slice(out.indexOf('<<655>>') + 7));
}

const LOCAL_STACK_ENV = [
    'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key-for-the-local-stack',
    'SUPABASE_SERVICE_ROLE_KEY=service-key-for-the-local-stack',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
describe('#655 — the guard reads the file the local stack writes', () => {
    it('A .env.development.local IS ENOUGH — no manual export', () => {
        //   THE defect. This file is what up.sh writes, and the guard did not
        //   look at it, so following up.sh's own closing instructions ran
        //   nothing at all.
        const resolved = resolveIn({ '.env.development.local': LOCAL_STACK_ENV });

        expect({ hasDb: resolved.hasDb, isLocal: resolved.isLocal })
            .toEqual({ hasDb: true, isLocal: true });
        expect(resolved.url).toBe('http://127.0.0.1:54321');
    });

    it('AND NO FILE AT ALL IS STILL AN HONEST SKIP — the control', () => {
        /*
         *   The assertion above is satisfied by a guard that returns `hasDb:
         *   true` unconditionally, which would turn every skip into a run
         *   against nothing and fail with a confusing error instead of a clear
         *   skip. A developer with no database must still get a skip.
         */
        const resolved = resolveIn({});

        expect({ hasDb: resolved.hasDb, url: resolved.url })
            .toEqual({ hasDb: false, url: '' });
    });

    it('AND .env.staging STILL WORKS WHERE SOMEBODY HAS ONE', () => {
        //   The file the guard looked at before. It is not in this repository,
        //   but the parameter is part of the contract and two callers pass it;
        //   widening the search must not narrow it.
        const resolved = resolveIn({
            '.env.staging': LOCAL_STACK_ENV.replace('54321', '54399'),
        });

        expect(resolved.hasDb).toBe(true);
        expect(resolved.url).toBe('http://127.0.0.1:54399');
    });

    it('AND THE LOCAL STACK WINS OVER STAGING', () => {
        /*
         *   Order matters and the safe direction is unambiguous: a developer who
         *   has just brought up a local stack means the local one. The reverse
         *   would point a suite that CREATES AND DELETES ROWS at whatever
         *   staging happens to be.
         */
        const resolved = resolveIn({
            '.env.development.local': LOCAL_STACK_ENV,
            '.env.staging': LOCAL_STACK_ENV.replace('54321', '54399'),
        });

        expect(resolved.url).toBe('http://127.0.0.1:54321');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#655 — and none of the guard\'s teeth were pulled to do it', () => {
    it('THE PRODUCTION PROJECT IS STILL REFUSED', () => {
        /*
         *   These suites create and delete rows, so pointing them at production
         *   is one line in an env file. Widening where the guard LOOKS must not
         *   widen what it ACCEPTS — and `.env.development.local` is a file
         *   anybody can edit.
         */
        const { PRODUCTION_PROJECT_REF } = require('@/lib/testing/db-env-guard');
        expect(typeof PRODUCTION_PROJECT_REF).toBe('string');

        const dir = mkdtempSync(join(tmpdir(), 'esx-655-prod-'));
        writeFileSync(join(dir, '.env.development.local'), [
            `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_PROJECT_REF}.supabase.co`,
            'SUPABASE_SERVICE_ROLE_KEY=whatever',
        ].join('\n'));

        let threw = '';
        try {
            execFileSync(process.execPath, ['-e', `
                const { resolveDbEnv } = require(${JSON.stringify(GUARD)});
                resolveDbEnv({ label: 'probe' });
            `], {
                cwd: dir, encoding: 'utf8',
                env: cleanEnv(),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e: any) {
            threw = String(e.stderr ?? e.message);
        }

        expect(threw).toMatch(/PRODUCTION project/i);
    });

    it('AND A SKIP IN CI IS STILL A FAILURE', () => {
        //   The rule that exists because a suite which does not run looks
        //   identical to one that passes. Widening the search would be a quiet
        //   way to lose it.
        const guard = readFileSync(GUARD, 'utf8');
        expect(guard).toContain('!hasDb && process.env.CI');
        expect(guard).toMatch(/rather than a skip/);
    });

    it('AND THE MESSAGE NO LONGER DESCRIBES A FILE NOBODY HAS', () => {
        /*
         *   It said `.env.staging` "currently carries all three variables with
         *   EMPTY values". That file is not in the repository, so the sentence
         *   sent whoever read it looking for something that was never there —
         *   and this audit has spent a good deal of time on notes that describe
         *   a repository other than the one in front of you.
         */
        expect(existsSync(join(ROOT, '.env.staging'))).toBe(false);
        //   Comment-stripped. The first version read the raw file and failed on
        //   the COMMENT above the message — the one explaining that the sentence
        //   had been removed. Third time this session that my own prose has
        //   satisfied, or here broken, an assertion about code (#651's YAML,
        //   #654's field sweep). A source assertion has to strip comments, every
        //   time, in every file format.
        expect(stripComments(readFileSync(GUARD, 'utf8'), { label: 'db-env-guard.js' }))
            .not.toContain('carries all three variables with EMPTY');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the guard stops reading the stack's file            KILLED
 *     the staging file is dropped from the search                     KILLED
 *     staging wins over the local stack                               KILLED
 *     hasDb stops depending on the values                             KILLED
 *     the production refusal is removed                               KILLED
 *     a skip in CI stops being a failure                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   The last three are the teeth. Widening where a guard LOOKS is the easiest
 *   possible place to widen what it ACCEPTS, and these suites create and delete
 *   rows: "staging wins over the local stack" would point them at whatever
 *   staging happens to be, and the production refusal is all that stands between
 *   them and the real database.
 *
 * ── TWO THINGS WENT WRONG IN THIS FILE BEFORE IT WORKED ─────────────────────
 *
 *   BOTH IN THE HARNESS, BOTH SILENT, AND THE SECOND IS THE THIRD TIME.
 *
 *   1. The child's environment was built by spreading `process.env` and setting
 *      the three keys to `undefined`. That does not unset them — they arrive as
 *      the STRING "undefined", which is truthy — so the guard reported
 *      `hasDb: true` with a URL of "undefined", and the no-file CONTROL passed
 *      for entirely the wrong reason. A control that passes for the wrong reason
 *      is the thing this audit spends most of its time removing.
 *
 *   2. The assertion that the stale message is gone read the guard's RAW TEXT
 *      and found the sentence in the COMMENT that explains its removal. My own
 *      prose broke an assertion about code, after my own prose satisfied one in
 *      #651 (a YAML comment) and again in #654 (a field-name sweep that found
 *      this file). Comments are stripped now. Three times in five findings is
 *      not bad luck; it is a rule: a source assertion strips comments, every
 *      time, in every file format.
 */
