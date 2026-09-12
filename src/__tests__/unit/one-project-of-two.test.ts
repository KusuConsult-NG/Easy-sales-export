/**
 * @jest-environment node
 */

/**
 *   #656 CI RAN ONE SPEC FILE OF TWENTY-SIX.
 *
 *   The e2e-smoke job invokes `npx playwright test --project=smoke`. That
 *   project carries a testMatch:
 *
 *       { name: 'smoke', testMatch: ['tests/e2e/public-routes.spec.ts'] }
 *
 *   ONE FILE. The `chromium` project has no testMatch of its own, so it is
 *   every spec under testDir — and it was invoked by no workflow in this
 *   repository. Twenty-five spec files had never run in CI, including every
 *   single one that signs a user in:
 *
 *     rbac-security          rbac-admin-gate        auth-module-access
 *     api-auth-contract      escrow                 financial-workflow
 *     payment-callback       marketplace-critical-flows
 *     complete-flow          loans                  cooperative
 *
 *   The job's own comment records that 23 specs "had been in the repository for
 *   a month and no workflow referenced any of them, so not one had ever run".
 *   The job added in answer to that covered a single file. THE FIX REACHED ONE
 *   DOOR OF TWO — which is the shape this audit has now found more times than
 *   any other.
 *
 * ── WHAT THE UNRUN SUITE WAS HIDING ─────────────────────────────────────────
 *
 *   Run for real against the local stack: 362 tests, 9.4 minutes, THREE FAILED.
 *   All three were stale specs, and stale precisely BECAUSE they had never run:
 *
 *     wave-submission   waited for "BVN verified successfully" — the exact
 *                       sentence #522 DELIBERATELY REMOVED from FinancialStep
 *                       when it found that nothing checked the BVN. The screen
 *                       was corrected; the test kept asserting the old lie,
 *                       because nothing executed it.
 *     courses           clicked the enrolled-course card, which is a <div>
 *                       whose inner Continue/Start <Link> is what navigates. So
 *                       the run never left the list, where `module-item` does
 *                       not exist and `progress-bar` matches once per course.
 *     health-check      two links now match /forensic scan/i — the sidebar's
 *                       and the panel's, both pointing at /admin/forensics. A
 *                       strict-mode violation, not a broken page.
 *
 *   None was an application defect, and that is the point: a suite nobody runs
 *   decays into one that CANNOT be turned on, and the longer it sits the more
 *   expensive the day someone tries. All three repaired; the full suite is
 *   362 passed, 8.9 minutes, zero failures, and CI runs it now.
 *
 * ── WHY THIS FILE IS A SOURCE TEST ──────────────────────────────────────────
 *
 *   The default run cannot start a browser or a database. So what is guarded
 *   here is the WIRING — that a workflow still invokes the project that means
 *   "all of them", that the project still means that, and that the three
 *   repairs are not quietly reverted into the state that made them necessary.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Source with its COMMENTS REMOVED, in both formats this file reads — using the
 * SHARED strippers, not a copy.
 *
 *   #651 found a mutant surviving because the PROSE ABOVE a step satisfied an
 *   assertion about the step. #654 found the same thing in a field sweep that
 *   matched its own test file. #655 found it a third time, in a JS comment
 *   explaining the very sentence the assertion said was gone.
 *
 *   Three times in five findings. This file — whose subject is a YAML step
 *   surrounded by a thirty-line write-up of mine mentioning `--project=chromium`
 *   twice — would have been the fourth.
 *
 *   BOTH COME FROM lib/testing/strip-comments, and the TypeScript one did not
 *   at first. The hand-rolled version this file carried ATE THE GLOB IT WAS
 *   ABOUT TO ASSERT ON. The recursive glob in `testMatch` — a slash, two
 *   stars, a slash — is a complete block comment to anything that does not know
 *   about strings, so a positive control failed on green code. The shared module
 *   exists BECAUSE of that exact trap, tracks strings and template holes, and
 *   throws rather than hand back a gutted file. Writing a second copy of it,
 *   in a file whose whole subject is a fix that reached one door of two, was
 *   the wrong instinct twice over.
 *
 *   The YAML one was added to that module by this finding, for the same reason:
 *   #651 had its own, and one contract in two places is what this audit spends
 *   most of its time on.
 */
import { stripComments, stripYamlComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The `e2e-smoke` job's steps, and nothing else in the workflow.
 *
 *   Scoped deliberately. "The file contains --project=chromium somewhere" is
 *   satisfied by a line in any of the other four jobs — including one with no
 *   database, no browser and no built app, where the step could only ever fail.
 *   The claim being made is that THIS job, the one that starts a Supabase and
 *   installs Chromium, runs the full project.
 */
const CI_YAML = stripYamlComments(read('.github/workflows/ci.yml'));
const E2E_JOB = (() => {
    const lines = CI_YAML.split('\n');
    const start = lines.findIndex((l) => l === '  e2e-smoke:');
    if (start < 0) throw new Error('#656: the e2e-smoke job is gone from ci.yml');
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^  [A-Za-z]/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n');
})();

const CONFIG = stripComments(read('playwright.config.ts'), { label: 'playwright.config.ts' });

const SPECS = [
    ...readdirSync(join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.ts')).map((f) => `e2e/${f}`),
    ...readdirSync(join(ROOT, 'tests/e2e')).filter((f) => f.endsWith('.spec.ts')).map((f) => `tests/e2e/${f}`),
].sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#656 — CI invokes the project that means "all of them"', () => {
    it('THE E2E JOB RUNS --project=chromium', () => {
        //   THE defect. Only `--project=smoke` was ever invoked.
        expect(E2E_JOB).toContain('npx playwright test --project=chromium');
    });

    it('AND STILL RUNS THE SMOKE PROJECT TOO', () => {
        /*
         *   The other half. Satisfying the assertion above by REPLACING the
         *   smoke step loses the fast public-route signal that runs before the
         *   nine-minute suite and tells you in ninety seconds whether the app
         *   boots at all.
         */
        expect(E2E_JOB).toContain('npx playwright test --project=smoke');
    });

    it('AND A SMOKE FAILURE DOES NOT SUPPRESS IT', () => {
        /*
         *   Steps are sequential and a failed one ends the job, so without
         *   `if: !cancelled()` the full suite would report nothing on exactly
         *   the runs where its 362 answers are most wanted. Anchored on the
         *   step, not on the file: `if: ${{ !cancelled() }}` appears three
         *   times in this job and the other two are for other steps.
         */
        const step = E2E_JOB.slice(E2E_JOB.indexOf('- name: Run the full authenticated suite'));
        const body = step.slice(0, step.indexOf('- name:', 1));
        expect(body).toContain('if: ${{ !cancelled() }}');
        expect(body).toContain('--project=chromium');
    });

    it('AND IT REUSES THE STACK THE JOB ALREADY STARTED', () => {
        /*
         *   The reason this is a step in e2e-smoke rather than a job of its
         *   own: ci-integration-db.sh has already applied the schema and every
         *   migration, and Chromium is already installed. A separate job pays
         *   for both again, and this one takes nine minutes as it is.
         *
         *   Asserted as ORDER — the database step must come before the suite,
         *   which is the whole content of "reuses".
         */
        const db = E2E_JOB.indexOf('./scripts/ci-integration-db.sh');
        const browser = E2E_JOB.indexOf('npx playwright install --with-deps chromium');
        const suite = E2E_JOB.indexOf('--project=chromium');

        //   PRESENT FIRST, THEN ORDERED. indexOf returns -1 for something that
        //   is not there, and -1 is less than everything — so a mutant that
        //   DELETED the database step would have satisfied a bare `<`. The
        //   check that cannot fail, one more time.
        expect({ db: db > -1, browser: browser > -1, suite: suite > -1 })
            .toEqual({ db: true, browser: true, suite: true });
        expect(db).toBeLessThan(suite);
        expect(browser).toBeLessThan(suite);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#656 — and that project still means every spec', () => {
    it('THE CHROMIUM PROJECT HAS NO testMatch OF ITS OWN', () => {
        /*
         *   A positive control on everything above, and the assertion that
         *   actually carries the finding. `--project=chromium` in the workflow
         *   is worth nothing the day somebody adds a testMatch to that project
         *   the way `smoke` has one — the step would still be there, still
         *   green, and running one file again.
         *
         *   The project block, from its name to the end of its `use`.
         */
        const at = CONFIG.indexOf("name: 'chromium'");
        expect(at).toBeGreaterThan(-1);
        const block = CONFIG.slice(at, CONFIG.indexOf('},', at));
        expect(block).not.toContain('testMatch');
    });

    it('AND THE SMOKE PROJECT REALLY IS THE ONE FILE', () => {
        //   The measurement the finding rests on. If smoke ever stopped being
        //   narrow, the defect would have fixed itself and this file would be
        //   guarding a distinction that no longer exists.
        const at = CONFIG.indexOf("name: 'smoke'");
        const block = CONFIG.slice(at, CONFIG.indexOf('},', at));
        expect(block).toContain("testMatch: ['tests/e2e/public-routes.spec.ts']");
    });

    it('AND THE SUITE IT RUNS STILL CONTAINS THE AUTHENTICATED JOURNEYS', () => {
        /*
         *   "Every spec under testDir" is a claim about a set, and the set is
         *   what makes the step worth its nine minutes. These eleven are the
         *   ones that had never run and that sign a user in — the security
         *   boundaries, the money, and the checkout.
         */
        expect(SPECS).toEqual(expect.arrayContaining([
            'tests/e2e/rbac-security.spec.ts',
            'tests/e2e/rbac-admin-gate.spec.ts',
            'tests/e2e/auth-module-access.spec.ts',
            'tests/e2e/api-auth-contract.spec.ts',
            'tests/e2e/escrow.spec.ts',
            'tests/e2e/financial-workflow.spec.ts',
            'tests/e2e/payment-callback.spec.ts',
            'tests/e2e/cooperative.spec.ts',
            'e2e/marketplace-critical-flows.spec.ts',
            'e2e/complete-flow.spec.ts',
            'e2e/loans.spec.ts',
        ]));
    });

    it('AND testMatch AT THE TOP LEVEL STILL REACHES BOTH DIRECTORIES', () => {
        //   Specs live in two places for historical reasons, and a config that
        //   covered only one would quietly halve the suite while every
        //   assertion above stayed green.
        expect(CONFIG).toContain("testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts']");
        expect(SPECS.filter((f) => f.startsWith('e2e/')).length).toBeGreaterThan(0);
        expect(SPECS.filter((f) => f.startsWith('tests/e2e/')).length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#656 — and the three specs that had decayed stay repaired', () => {
    it('WAVE SUBMISSION ACCEPTS EITHER HONEST MESSAGE', () => {
        /*
         *   Not "assert the new sentence instead of the old one" — that swaps
         *   one brittle claim for another, and would go red the day a provider
         *   IS configured and the verified message becomes the true one.
         *
         *   What this step is testing is that the application flow continues
         *   past the BVN field. Either truthful sentence satisfies that.
         */
        const spec = stripComments(read('e2e/wave-submission.spec.ts'), { label: 'e2e/wave-submission.spec.ts' });
        expect(spec).toContain(
            'p:has-text("BVN verified successfully"), p:has-text("BVN recorded")');
    });

    it('AND BOTH OF THOSE MESSAGES ARE STILL THE SCREEN\'S OWN WORDS', () => {
        /*
         *   The half that makes the assertion above mean something. A locator
         *   is a string; it goes on matching nothing in particular if the
         *   component stops saying either thing.
         *
         *   #522's finding lives here: the verified message is shown ONLY when
         *   a provider confirmed the number, and the recorded message when it
         *   did not. IDENTITY_PROVIDER is 'none' today, so it is the second one
         *   a member actually sees.
         */
        const step = read('src/app/wave/application/steps/FinancialStep.tsx');
        /*
         *   ANCHORED ON THE TERNARY, not on the two sentences. The first
         *   version asserted `toContain('BVN recorded')` and a mutant that
         *   replaced the rendered message SURVIVED — because the TOAST, forty
         *   lines up, says "BVN recorded. Our team will confirm it during
         *   review." and satisfied the assertion on its own.
         *
         *   The spec's locator is `p:has-text(...)`, so the <p> is the thing
         *   that has to keep saying it. The same lesson as #649 and #651 in a
         *   third costume: a check on the presence of a string is not a check
         *   on the string that matters.
         */
        expect(step).toMatch(
            /\{bvnChecked\s*\?\s*"BVN verified successfully"\s*:\s*"BVN recorded[^"]*"\}/);
    });

    it('AND COURSES WALKS THE JOURNEY INSTEAD OF ASSERTING TWO PAGES AT ONCE', () => {
        /*
         *   Three separate corrections, all asserted, because any one of them
         *   reverted puts the spec back to failing:
         *
         *     the bar is scoped to ONE card   — it renders per enrolled course
         *     the LINK is clicked             — the card is a <div>
         *     the run waits for the detail URL — modules live on the next page
         */
        const spec = stripComments(read('e2e/courses.spec.ts'), { label: 'e2e/courses.spec.ts' });
        expect(spec).toContain("card.locator('[data-testid=\"progress-bar\"]')");
        expect(spec).toMatch(/getByRole\('link', \{ name: \/continue\|start\/i \}\)\s*\.?\s*\.click\(\)/);
        expect(spec).toContain('await page.waitForURL(/\\/academy\\/[^/]+$/)');
    });

    it('AND THE HEALTH CHECK SURVIVES THE SECOND FORENSICS LINK', () => {
        /*
         *   Both matches point at /admin/forensics, so the assertion's intent
         *   is unharmed and `.first()` is the honest fix rather than a papered
         *   over ambiguity. Anchored on the two together: `.first()` anywhere
         *   in the file would otherwise satisfy this.
         */
        const spec = stripComments(read('tests/e2e/health-check.spec.ts'), { label: 'tests/e2e/health-check.spec.ts' });
        expect(spec).toMatch(
            /getByRole\('link', \{ name: \/forensic scan\/i \}\)\.first\(\)\)?\s*\.toHaveAttribute\(/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the chromium step is removed from CI                KILLED
 *     the chromium step replaces the smoke step                       KILLED
 *     the step loses `if: !cancelled()`                               KILLED
 *     the e2e-smoke job itself is renamed away                        KILLED
 *     the database step is deleted from the job                       KILLED
 *     the browser install is deleted from the job                     KILLED
 *     the chromium project is given smoke's testMatch                 KILLED
 *     top-level testMatch drops the tests/e2e directory               KILLED
 *     wave-submission goes back to the removed sentence               KILLED
 *     the toast keeps the phrase, the <p> loses it                    KILLED
 *     courses clicks the card instead of the link                     KILLED
 *     courses stops waiting for the detail URL                        KILLED
 *     health-check drops `.first()`                                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this file's header                                       SURVIVED ✓
 *     reword the workflow's own comment block                         SURVIVED ✓
 *
 *   The controls are the ones that matter here: this file's write-up says
 *   `--project=chromium` twice and the workflow's says it twice more, so an
 *   assertion reading either raw would have been satisfied by prose. Both are
 *   comment-stripped before anything is asserted — the fourth appearance of a
 *   trap that has now cost this audit three diagnoses.
 *
 * ── ONE SURVIVED THE FIRST RUN, AND ONE INSTRUMENT FAULT ────────────────────
 *
 *   "FinancialStep stops saying BVN recorded" SURVIVED. The assertion was
 *   `toContain('BVN recorded')` and the TOAST, forty lines above the rendered
 *   <p>, says "BVN recorded. Our team will confirm it during review." — so the
 *   string was still in the file while the element the spec's locator matches
 *   had stopped saying it. Re-anchored on the ternary itself.
 *
 *   And before that, a positive control failed on green code: the regex
 *   stripper ate `testMatch: ['e2e/ ** / *.spec.ts']`, because that glob IS a
 *   block comment to a regex. The instrument was removing the source it was
 *   about to assert on. It uses lib/testing/strip-comments now — the
 *   module that exists for this trap. See the note above the imports.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The full suite was run for real against the stack scripts/local-stack/up.sh
 *   brings up — native PostgreSQL, PostgREST, a Node auth gateway — with the
 *   app's schema and every migration, against a PRODUCTION build:
 *
 *     before   362 tests, 3 failed, 9.4 minutes
 *     after    362 passed,  0 failed, 8.9 minutes
 *
 *   The CI step itself cannot be executed here — GitHub Actions does not run
 *   locally — so the YAML is validated by parse, the suite it invokes was run
 *   in full, and every piece the step depends on is asserted above.
 */
