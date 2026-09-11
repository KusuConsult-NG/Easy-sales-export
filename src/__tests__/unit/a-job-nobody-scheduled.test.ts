/**
 *   #614 THE LIST OF SCHEDULED JOBS IS KEPT BY HAND IN FOUR PLACES, AND TWO OF
 *        THEM HAD ALREADY FALLEN OUT.
 *
 *   Seven endpoints live under `src/app/api/cron/`. The workflow that invokes
 *   them named five. The two it did not name are not minor:
 *
 *     close-export-windows        Nothing else writes "closed" onto an export
 *                                 window (#196), so every window whose
 *                                 investment period ended stays listed. The
 *                                 money is already safe — all three investment
 *                                 doors refuse an expired window — so the cost
 *                                 is a list offering opportunities nobody can
 *                                 take.
 *
 *     release-stale-reservations  A reservation hold has NO OTHER EXIT (#140).
 *                                 The owner cannot relist, no other buyer can
 *                                 claim, and an admin cannot free it either,
 *                                 because #137 deliberately removed "pending"
 *                                 from the statuses an approval may overwrite.
 *                                 Each of those guards is right; together they
 *                                 leave the abandoned case with no way out, and
 *                                 closing the checkout tab took a parcel off the
 *                                 market permanently.
 *
 *   Both were written to be scheduled, audited, and never scheduled. That is the
 *   same shape the workflow itself was created to fix — "endpoints that nothing
 *   invokes" — reappearing inside the fix.
 *
 * ── WHY IT DRIFTED, AND WHAT THIS CHECKS ────────────────────────────────────
 *
 *   The job list exists FOUR TIMES: as directories under src/app/api/cron, as
 *   cron lines in the schedule block, as options in the manual dispatch menu,
 *   and as branches of the case statement that maps a schedule to a path. Adding
 *   a job means editing four places and nothing held them together, so two of
 *   them were edited in one place and forgotten in three.
 *
 *   #439's lesson, on operations rather than code: a rule stated by hand in
 *   every copy is a rule applied in most of them.
 *
 * ── WHAT THIS CANNOT DO, SAID PLAINLY ───────────────────────────────────────
 *
 *   THE SCHEDULE IS STILL COMMENTED OUT AND THESE JOBS STILL DO NOT RUN. It is
 *   disabled pending two GitHub repository secrets — CRON_SECRET and
 *   PRODUCTION_URL — which only the repository owner can set. Nothing in this
 *   file changes that, and a test that implied otherwise would be worse than no
 *   test. What it does is make sure that when the schedule is enabled, all seven
 *   jobs are on it, and that a third omission fails the suite rather than
 *   waiting to be noticed by its consequences.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const WORKFLOW = join(ROOT, '.github/workflows/scheduled-jobs.yml');
const CRON_DIR = join(ROOT, 'src/app/api/cron');

/** Every cron endpoint that exists, read from the tree rather than listed here. */
function endpointsOnDisk(): string[] {
    return readdirSync(CRON_DIR)
        .filter(name => statSync(join(CRON_DIR, name)).isDirectory())
        .sort();
}

const workflow = () => readFileSync(WORKFLOW, 'utf8');

/** The jobs the manual dispatch menu offers. */
function dispatchOptions(src: string): string[] {
    const block = /options:\n((?:\s*-\s*[\w-]+\n)+)/.exec(src);
    if (!block) return [];
    return [...block[1].matchAll(/-\s*([\w-]+)/g)].map(m => m[1]).sort();
}

/** The jobs the case statement can resolve a path for. */
function casePaths(src: string): string[] {
    return [...src.matchAll(/echo "path=([\w-]+)"/g)].map(m => m[1]).sort();
}

/** The jobs the schedule block names, commented out or not. */
function scheduledJobs(src: string): string[] {
    return [...src.matchAll(/cron: '[^']+'\s*#\s*([\w-]+)/g)].map(m => m[1]).sort();
}

describe('#614 — every cron endpoint is on the schedule that invokes them', () => {
    /*
     *   THERE IS NO VACUITY GUARD IN THIS BLOCK, AND THAT IS DELIBERATE.
     *
     *   I wrote two and deleted both. The first asserted the cron directory held
     *   at least seven entries; the second asserted each parser found something
     *   in the real file. Neither could be made to fail on its own:
     *
     *     an empty directory is caught by the three comparisons below, which
     *     compare seven workflow names against none;
     *     a parser that stops matching is caught the same way, from the other
     *     side;
     *     an unreadable workflow is caught by the "still disabled" tests further
     *     down, which read the same file and assert its content.
     *
     *   A guard that cannot fail is not protection, it is decoration that reads
     *   as protection — #598's dead exclusion, and I had written it twice here
     *   before checking. What actually protects the parsers is the positive
     *   control at the foot of this block, which runs each of them against a
     *   sample whose answer is known. That is the structural form: code
     *   exercised against known answers, rather than an assertion hoping to be
     *   reached.
     */

    it('THE SCHEDULE BLOCK NAMES EVERY ONE OF THEM', () => {
        expect(scheduledJobs(workflow())).toEqual(endpointsOnDisk());
    });

    it('AND THE MANUAL DISPATCH MENU OFFERS EVERY ONE OF THEM', () => {
        //   A job missing here cannot be run by hand either, which is the only
        //   way any of these run at all while the schedule is disabled.
        expect(dispatchOptions(workflow())).toEqual(endpointsOnDisk());
    });

    it('AND THE CASE STATEMENT CAN RESOLVE EVERY ONE OF THEM', () => {
        //   A cron line with no matching branch falls through to `inputs.job`,
        //   which is empty on a scheduled run — so the job would fail on "Could
        //   not resolve a job for this trigger" every time it fired. A schedule
        //   entry without this is worse than no schedule entry: it looks done.
        expect(casePaths(workflow())).toEqual(endpointsOnDisk());
    });

    it('AND THE READERS CAN FAIL — a positive control on each', () => {
        //   Three parsers returning [] would make three assertions above agree
        //   with each other and with nothing else. Each is shown to find what is
        //   there and to reject what is not.
        const sample = [
            "        options:",
            "          - alpha",
            "          - beta",
            "    - cron: '0 * * * *'   # alpha  — hourly",
            '            echo "path=beta" >> "$GITHUB_OUTPUT"',
        ].join('\n');
        expect(dispatchOptions(sample)).toEqual(['alpha', 'beta']);
        expect(scheduledJobs(sample)).toEqual(['alpha']);
        expect(casePaths(sample)).toEqual(['beta']);

        expect(dispatchOptions('nothing here')).toEqual([]);
        expect(scheduledJobs('nothing here')).toEqual([]);
        expect(casePaths('nothing here')).toEqual([]);
    });
});

describe('#623 — the schedule is on, and cannot go quiet', () => {
    /*
     *   #614 PINNED THIS FILE AS DISABLED, deliberately: "if somebody enables
     *   the schedule this test fails and they update it deliberately — which is
     *   the moment to check the two secrets really are set." That is exactly
     *   what happened, and this block is that deliberate update.
     *
     *   WHY IT WAS ENABLED WITH THE SECRETS STILL UNSET. Commenting the block
     *   out prevented failing runs and, in doing so, left eight jobs not running
     *   — which is the defect this workflow was written to fix, preserved by the
     *   fix for it. Of the two costs, silence is the worse: a red run gets
     *   noticed, a job that never fires does not. With the block live, setting
     *   the two secrets is now the ONLY remaining step; nobody has to remember
     *   to come back and edit YAML.
     */
    it('THE SCHEDULE BLOCK IS LIVE, NOT COMMENTED OUT', () => {
        const src = workflow();
        expect(src).toMatch(/^on:\n\s+schedule:/m);
        expect(src).not.toContain('# Automatic schedule disabled');
        //   And the crons themselves are real lines, not commented ones.
        expect(src).toMatch(/^\s+- cron: '\*\/15 \* \* \* \*'/m);
    });

    it('AND A SCHEDULED RUN WITHOUT THE SECRETS CALLS NOTHING', () => {
        //   The reason it is safe to leave on. Skipped, not fired blindly: a
        //   run that called the endpoints without a secret would 401 eight ways
        //   and teach everyone to ignore this workflow.
        const src = workflow();
        expect(src).toContain("configured=false");
        expect(src).toContain("if: needs.preflight.outputs.configured == 'true'");
    });

    it('AND IT STILL SAYS SO LOUDLY — once a day, not ninety-six times', () => {
        /*
         *   "A scheduler that quietly no-ops is how this situation arose" — the
         *   workflow's own words, and still true. The answer is not to fail every
         *   fifteen minutes, which produces a red that everyone mutes; it is to
         *   fail ONCE A DAY with the reason. Bounded noise is read; unbounded
         *   noise is filtered.
         */
        const src = workflow();
        expect(src).toContain('config-check');
        expect(src).toContain("github.event.schedule == '0 3 * * *'");
        expect(src).toContain('Eight scheduled jobs are not running');
        expect(src).toContain('CRON_SECRET');
        expect(src).toContain('PRODUCTION_URL');
    });

    it('AND A MANUAL RUN WITHOUT THEM STILL FAILS HARD', () => {
        //   A person pressed the button and is waiting. A green tick over a job
        //   that never ran is the worst of the three outcomes.
        const src = workflow();
        expect(src).toContain('if [ "$EVENT" = "workflow_dispatch" ]');
        expect(src).toContain('Nothing was called.');
    });

    it('AND THE DAILY CHECK RIDES AN EXISTING CRON, so the four lists still agree', () => {
        //   A ninth cron line would put a name in the schedule block that is not
        //   an endpoint on disk, and the ratchet above compares those two lists
        //   exactly. Stated here so the next person does not "tidy" it into its
        //   own schedule entry and break a test three describes up.
        expect(scheduledJobs(workflow())).toEqual(endpointsOnDisk());
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     workflow: drop the release-stale-reservations cron line        KILLED
 *     workflow: drop the close-export-windows cron line              KILLED
 *     workflow: drop a dispatch option                               KILLED
 *     workflow: drop a case branch                                   KILLED
 *     dispatchOptions: return [] always                              KILLED
 *     scheduledJobs: stop matching the file's real formatting        KILLED
 *     endpointsOnDisk: return [] (the directory moved)               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   ONE MUTANT SURVIVED AND THE FIX WAS TO DELETE THE ASSERTION IT ATTACKED.
 *   Weakening the "at least seven endpoints" guard changed no answer, because
 *   the directory really does hold seven. Chasing it further showed the guard
 *   could not fail in ANY scenario I could build: the comparisons catch an empty
 *   directory and a broken parser from opposite sides, and the "still disabled"
 *   tests catch an unreadable workflow. I replaced it with a narrower guard,
 *   found that one was redundant too, and removed both.
 *
 *   That is #598's dead exclusion, written twice in one file by the person who
 *   keeps citing it. The parsers are protected structurally instead — exercised
 *   against a sample whose answer is known, which is a test that can be wrong
 *   rather than an assertion hoping to be reached.
 */
