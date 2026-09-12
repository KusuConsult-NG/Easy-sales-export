/**
 * @jest-environment node
 */

/**
 *   #660 THE ANSWER TO "IS THE MIGRATION APPLIED?" WAS A NODE SCRIPT THE OWNER
 *   CANNOT RUN.
 *
 *   Four entries on this audit's owner-side list were one question wearing four
 *   hats — "confirm migrations 034 and 035 are applied" being the live one,
 *   because 035 is #652's overselling fix and until it reaches the database a
 *   cart carrying one product on two lines can still take more stock than
 *   exists.
 *
 *   The repository could not answer it, and the instructions for answering it
 *   were: run `node scripts/build-deploy-sql.mjs`, then paste the output. The
 *   script's own header says why it exists — "applied by pasting into the
 *   Supabase SQL Editor because neither psql nor the Supabase CLI is installed"
 *   — which is an accurate description of somebody who also does not have a
 *   Node toolchain to hand. The artefact that removes the problem was one
 *   command away and was never committed.
 *
 * ── AND THE QUESTION DID NOT NEED ANSWERING ─────────────────────────────────
 *
 *   Every migration in the bundle is CREATE OR REPLACE or IF NOT EXISTS, so
 *   applying one that is already applied does nothing. That was written in the
 *   header as a claim. It is now MEASURED:
 *
 *     a fresh PostgreSQL 16 + supabase/schema.sql
 *     → deploy.sql applied THREE TIMES
 *     → every run exits clean, and the definitions of all 45 functions are
 *       byte-identical (md5 of pg_get_functiondef) after the third
 *     → decrement_many_or_fail carries 035's `GROUP BY 1, 2, 3`
 *
 *   So nobody has to determine which migrations a database has. Running the
 *   file is cheaper than finding out, and provably costs nothing when the answer
 *   is "all of them".
 *
 * ── WHY A COMMITTED GENERATED FILE NEEDS THIS TEST ──────────────────────────
 *
 *   A generated artefact in version control is a second copy of a contract, and
 *   this audit's fourth-most-common finding is what happens when one drifts. A
 *   migration added tomorrow and not regenerated leaves a deploy file that looks
 *   complete and is missing it — the exact failure the generator's own header
 *   says it exists to prevent, reintroduced by committing its output.
 *
 *   So the file is regenerated here and compared BYTE FOR BYTE. That is only
 *   possible because the generator stopped stamping the current time into the
 *   header; a clock in a generated file defeats every ratchet over it.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DEPLOY = 'supabase/deploy.sql';
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The generator's output, right now, from the migrations on disk. */
const regenerate = (): string =>
    execFileSync('node', ['scripts/build-deploy-sql.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });

const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#660 — the file exists and matches the migrations', () => {
    it('THE COMMITTED FILE IS WHAT THE GENERATOR PRODUCES TODAY', () => {
        /*
         *   THE ratchet. A migration added and not regenerated is a deploy file
         *   that looks complete and is missing it.
         */
        expect(read(DEPLOY)).toBe(regenerate());
    });

    it('AND THE FILE IS TRACKED, WHICH IS THE WHOLE POINT OF COMMITTING IT', () => {
        /*
         *   THE control that matters most here, and it nearly did not exist.
         *
         *   .gitignore carried `deploy.sql` with the comment "regenerate, never
         *   commit" — the usual and usually-right rule about generated
         *   artefacts. Every other assertion in this file passes against a
         *   working tree where the bundle exists on disk and is invisible to
         *   everyone who clones, which is precisely the state this finding is
         *   about: the person who has to apply it cannot get it.
         *
         *   So the rule was reversed, with the reason written into .gitignore,
         *   and this asks git rather than the filesystem.
         */
        const tracked = execFileSync('git', ['ls-files', '--error-unmatch', DEPLOY], {
            cwd: ROOT, encoding: 'utf8',
        }).trim();

        expect(tracked).toBe(DEPLOY);
    });

    it('AND THE GENERATOR IS DETERMINISTIC, or the line above is theatre', () => {
        //   It used to stamp `new Date()` into the header, which would make the
        //   comparison above fail on every regeneration and teach whoever hit it
        //   to stop believing this file.
        expect(regenerate()).toBe(regenerate());
        expect(read(DEPLOY)).not.toMatch(/generated \d{4}-\d{2}-\d{2}/);
    });

    it('AND EVERY MIGRATION ON DISK IS NAMED IN IT — APPLIED, OR OMITTED WITH A REASON', () => {
        /*
         *   A positive control on the comparison. "The committed file matches
         *   the generator" is also satisfied by a generator that has quietly
         *   stopped including something — so the migrations are counted from the
         *   DIRECTORY and looked for in the output by name.
         *
         *   THE FIRST VERSION OF THIS ASSERTION WAS WRONG AND SAYING SO IS THE
         *   POINT. It demanded that every migration be APPLIED by the bundle,
         *   and 022 is deliberately excluded — CREATE INDEX CONCURRENTLY cannot
         *   run inside a transaction block and every other migration opens one.
         *   That exclusion is correct.
         *
         *   What was NOT correct is that the bundle never mentioned it: the
         *   exclusion was printed to stderr during generation, so the artefact a
         *   person reads looked complete and was not. That is the generator's
         *   own stated purpose failing one level up, and it is fixed — the
         *   omission and its reason are in the file now.
         *
         *   So the rule is: named, either way. A migration that is neither
         *   applied nor disclosed is the defect.
         */
        const deploy = read(DEPLOY);
        const unnamed = MIGRATIONS.filter((f) => !deploy.includes(f));

        expect({ unnamed }).toEqual({ unnamed: [] });
        expect(MIGRATIONS.length).toBeGreaterThanOrEqual(34);
    });

    it('AND THE OMITTED ONE IS UNDER A HEADING THAT SAYS IT IS OMITTED', () => {
        /*
         *   The other half. "Named somewhere in a 6,000-line file" is satisfied
         *   by a mention in passing; a reader has to be able to tell APPLIED
         *   from NOT APPLIED, and the whole finding is about an artefact that
         *   looks complete.
         */
        const deploy = read(DEPLOY);
        const headingAt = deploy.indexOf('WHAT THIS FILE DOES NOT CONTAIN');
        expect(headingAt).toBeGreaterThan(-1);

        const section = deploy.slice(headingAt, deploy.indexOf('BEFORE YOU RUN THIS'));
        expect(section).toContain('022_jsonb_expression_indexes.sql');
        //   With the reason, not just the name.
        expect(section).toContain('CREATE INDEX CONCURRENTLY');
    });

    it('INCLUDING 035, WHICH IS THE ONE THAT IS NOT YET IN PRODUCTION', () => {
        /*
         *   Named on purpose rather than left to the sweep above. 035 is #652's
         *   overselling fix; until it is applied, a cart carrying the same
         *   product on two lines can take more stock than exists. Its aggregate
         *   is what makes it that fix, so the SQL is checked and not just the
         *   filename.
         */
        const deploy = read(DEPLOY);
        expect(deploy).toContain('035_decrement_many_or_fail_aggregates_duplicates.sql');
        expect(deploy).toContain('GROUP BY 1, 2, 3');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#660 — and it says what a person needs to know before pasting it', () => {
    it('THAT RE-RUNNING IT IS SAFE, AND THAT THIS WAS MEASURED', () => {
        //   The sentence that makes the owner-side question go away. A claim of
        //   idempotency that nobody checked is how "just re-run it" becomes the
        //   advice that broke production.
        const deploy = read(DEPLOY);
        expect(deploy).toContain('RE-RUNNING THIS FILE IS SAFE. MEASURED, NOT ASSUMED');
        expect(deploy).toContain('applied TWICE MORE');
    });

    it('AND WHERE TO ASK WHAT A DATABASE ALREADY HAS — #664', () => {
        /*
         *   deploy.sql answers "apply everything". It cannot answer "what is
         *   there now", and that is the question the owner-side list carried
         *   unanswered for weeks. supabase/status.sql is read-only and one
         *   paste; the bundle points at it so the two are found together.
         *
         *   The status query was validated against BOTH controls before being
         *   committed — a complete database (every row YES) and one missing
         *   033, 034 and 035 (those three NO, RLS 0 of 9). A status query that
         *   always says YES is worse than no status query.
         */
        expect(read(DEPLOY)).toContain('supabase/status.sql');

        const status = read('supabase/status.sql');
        expect(status).toContain('035 overselling fix applied');
        expect(status).toContain('RLS: tables with it ON');
        //   Read-only, and it says so: this is pasted into a production SQL
        //   editor by somebody who is right to be nervous.
        expect(status).toContain('READ-ONLY');
        expect(status).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/);
    });

    it('AND THAT THE ROW-LEVEL SECURITY SECTION IS THE ONE THAT CHANGES BEHAVIOUR', () => {
        /*
         *   Everything else in the bundle replaces a function with the same
         *   function. 004 turns RLS ON, which is a real change to a database
         *   that does not have it — and its failure mode is SILENT: with RLS on
         *   and no policy, Postgres returns zero rows rather than an error.
         *
         *   It is applied last and the header says so, so a reader who wants to
         *   defer it can stop before the final section.
         */
        const deploy = read(DEPLOY);
        expect(deploy).toContain('004 LAST');
        expect(deploy).toContain('Failures are silent');

        //   And last is where it actually is, not just where the prose says.
        const rlsAt = deploy.indexOf('004_enable_row_level_security.sql');
        const others = MIGRATIONS
            .filter((f) => !f.startsWith('004'))
            .map((f) => deploy.indexOf(f));
        expect(Math.min(...others)).toBeLessThan(rlsAt);
        expect(Math.max(...others)).toBeLessThan(rlsAt);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a migration is added and the file is not rebuilt    KILLED
 *     the file goes back to being gitignored                           KILLED
 *     the committed file is edited by hand                            KILLED
 *     the generator goes back to stamping the current time            KILLED
 *     035 is dropped from the generator's list                        KILLED
 *     035 loses the aggregate that makes it #652's fix                KILLED
 *     the RLS section stops being last                                KILLED
 *     the idempotency claim is made without the measurement           KILLED
 *     an excluded migration stops being disclosed                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   A scratch database on the local stack's PostgreSQL 16. supabase/schema.sql,
 *   then supabase/deploy.sql three times, then a fourth after the header
 *   changed. No run raised an error; `md5(pg_get_functiondef(oid))` over all 45
 *   public functions was identical between runs; and
 *   `decrement_many_or_fail` contains 035's aggregate.
 */
