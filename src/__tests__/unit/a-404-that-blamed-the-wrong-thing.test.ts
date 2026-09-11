/**
 * @jest-environment node
 */

/**
 *   #631 SEVEN HUNDRED AND SEVENTY-NINE FAILURES THAT NAMED THE WRONG CAUSE.
 *
 *   The scheduled-jobs workflow ran 779 times and failed every time, and the
 *   message it printed on each one was:
 *
 *       /api/cron/process-email-queue returned HTTP 404
 *
 *   which reads as "that route is missing" — something wrong with this code. It
 *   was not. The response body said so, and nothing was reading it:
 *
 *       {"status":"error","code":404,"message":"Application not found",
 *        "request_id":"f848Mjx0QTKK88Wun6XIxQ"}
 *
 *   `status` / `code` / `message` / `request_id` is the HOSTING PLATFORM's error
 *   shape, not this application's. There was no app deployed at PRODUCTION_URL
 *   at all. A configuration problem wearing the costume of a routing one.
 *
 *   IT LASTED THREE WEEKS AND ENDED WITH THE SCHEDULE BEING COMMENTED OUT — the
 *   alarm silenced rather than answered, which is how eight jobs came to be
 *   switched off. #623 switched them back on; this makes sure the next failure
 *   says what it actually is.
 *
 * ── THE THREE ANSWERS NEED THREE DIFFERENT PEOPLE ───────────────────────────
 *
 *     nothing deployed there    the PRODUCTION_URL secret is wrong, or the app
 *                               is not running. Nobody should read the code.
 *     the secret is refused     CRON_SECRET is SET but does not match the one
 *                               the running app checks. Also not the code.
 *     the app 404s the route    the deployed build is older than the route.
 *                               This one IS about the code.
 *
 *   Told apart by the workflow now, instead of by somebody opening the log and
 *   noticing the body underneath the error.
 *
 * ── WHY THIS RUNS THE SHELL ─────────────────────────────────────────────────
 *
 *   Asserting that the YAML CONTAINS these messages would pin the words and not
 *   the behaviour — the lesson #620 learned about its own verdict and #626 about
 *   a regex. The classifier is extracted from the workflow and EXECUTED here
 *   against each body, so a condition that can no longer match is a failure.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const WORKFLOW = '.github/workflows/scheduled-jobs.yml';

/**
 * The classifier, lifted out of the workflow exactly as it is written there.
 *
 * Taken from the file rather than retyped — #612: a test that keeps its own copy
 * of the thing under test proves only that the copy works.
 */
function classifierScript(): string {
    const yaml = readFileSync(join(process.cwd(), WORKFLOW), 'utf8');

    const start = yaml.indexOf('if [ "$http_code" -ge 400 ]; then');
    expect(start).toBeGreaterThan(-1);
    const end = yaml.indexOf('exit 1', start);
    expect(end).toBeGreaterThan(start);

    //   The block is indented inside the YAML `run:` scalar; bash does not mind
    //   the leading spaces, but the `exit 1` is dropped so a case can be run
    //   without killing the shell that is inspecting it.
    return yaml.slice(start, end).replace(/\n\s*$/, '\n') + '\nfi\n';
}

/** Run the classifier for one HTTP code and one response body. */
function classify(httpCode: string, body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cron-classify-'));
    const bodyFile = join(dir, 'body.json');
    writeFileSync(bodyFile, body);

    const script = [
        `http_code="${httpCode}"`,
        `JOB_PATH="process-email-queue"`,
        classifierScript().replace(/\/tmp\/body\.json/g, bodyFile),
    ].join('\n');

    return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
}

/** The body the hosting platform actually returned, from the run logs. */
const EDGE_404 = '{"status":"error","code":404,"message":"Application not found","request_id":"f848Mjx0QTKK88Wun6XIxQ"}';

describe('#631 — the failure says which of three things is wrong', () => {
    it('NOTHING DEPLOYED THERE IS NOT REPORTED AS A MISSING ROUTE', () => {
        //   The one that actually happened, 779 times.
        const out = classify('404', EDGE_404);

        expect(out).toContain('NOTHING IS DEPLOYED AT PRODUCTION_URL');
        expect(out).toContain('PRODUCTION_URL');
        //   And it must NOT be the message that sent everybody to the code.
        expect(out).not.toContain('returned HTTP 404');
    });

    it('A REFUSED SECRET SAYS THE SECRET IS SET AND WRONG', () => {
        /*
         *   The distinction that matters here: "CRON_SECRET is not configured"
         *   and "CRON_SECRET does not match" look identical from the outside and
         *   need opposite actions. The preflight already proves it is SET, so a
         *   401 can only mean the value disagrees.
         */
        for (const code of ['401', '403']) {
            const out = classify(code, '{"error":"Unauthorized. Provide Authorization: Bearer <CRON_SECRET>"}');
            expect(out).toContain('REFUSED THE CRON SECRET');
            expect(out).toContain('does not match');
        }
    });

    it('AND A ROUTE THE APP ITSELF CANNOT FIND IS REPORTED AS THAT', () => {
        //   A 404 whose body is NOT the platform's error page: the app answered,
        //   and this endpoint is missing from the deployed build.
        const out = classify('404', '<!DOCTYPE html><html><body>404 - This page could not be found</body></html>');

        expect(out).toContain('THE APP IS THERE AND THE ROUTE IS NOT');
        expect(out).toContain('older than the route');
        expect(out).not.toContain('NOTHING IS DEPLOYED');
    });

    it('AND ANYTHING ELSE STILL REPORTS ITS CODE', () => {
        //   The fallback must stay: a 500 from the job itself is a real failure
        //   and classifying it as one of the three above would be a new lie.
        const out = classify('500', '{"success":false,"error":"Sweep failed"}');
        expect(out).toContain('returned HTTP 500');
    });

    it('AND THE CLASSIFIER REALLY IS THE ONE IN THE WORKFLOW', () => {
        //   Vacuity guard on the whole file: if the extraction returned nothing,
        //   every case above would run an empty script and print nothing, and
        //   `not.toContain` would pass for all of them.
        const script = classifierScript();
        expect(script.length).toBeGreaterThan(200);
        expect(script).toContain('http_code');
        expect(script).toContain('grep -qi');

        //   And an empty classifier would NOT satisfy the positive cases — which
        //   is what makes those the real assertions.
        expect(classify('404', EDGE_404).length).toBeGreaterThan(40);
    });
});

describe('#631 — and the schedule that produced them is still on', () => {
    it('THE BLOCK IS LIVE, so these messages can still be reached', () => {
        //   #623 enabled it. A failure message nobody will ever see because the
        //   schedule is commented out again is the situation this came from.
        const yaml = readFileSync(join(process.cwd(), WORKFLOW), 'utf8');
        expect(yaml).toMatch(/^on:\n\s+schedule:/m);
        expect(yaml).not.toContain('# Automatic schedule disabled');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: every failure is the generic message again         KILLED
 *     the edge 404 is classified as a missing route                  KILLED
 *     the refused-secret case is dropped                             KILLED
 *     the app-404 case is dropped                                    KILLED
 *     the generic fallback is dropped (a 500 reports nothing)        KILLED
 *     the edge check matches EVERYTHING                              KILLED
 *     the schedule is commented out again                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The sixth is the way this fix becomes its own misdiagnosis in the other
 *   direction: a check that matches every body would tell somebody the app is
 *   not deployed while it is running perfectly and merely missing a route.
 *   Naming the wrong cause CONFIDENTLY is what cost three weeks the first time,
 *   so it is tested in both directions.
 *
 *   The seventh is not about this change at all and is here on purpose: every
 *   message in this file is unreachable if the schedule is off again. That is
 *   how the original failure ended, and a fix to the wording of an alarm nobody
 *   will hear is not a fix.
 */
