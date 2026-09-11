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

    /*
     *   BOTH GUARDS, AS ONE BLOCK. The first version of this sliced to the first
     *   `exit 1`, which used to be the end of everything — and stopped being so
     *   the moment #632 added the redirect check in front. Four cases then ran
     *   against a script that no longer contained the branch they were about.
     *
     *   The ORDER of the two is part of what is tested: the redirect guard must
     *   not shadow the classifier behind it.
     */
    const start = yaml.indexOf('if [ "$http_code" -ge 300 ] && [ "$http_code" -lt 400 ]; then');
    expect(start).toBeGreaterThan(-1);

    const secondGuard = yaml.indexOf('if [ "$http_code" -ge 400 ]; then', start);
    expect(secondGuard).toBeGreaterThan(start);

    const lastExit = yaml.indexOf('exit 1', secondGuard);
    expect(lastExit).toBeGreaterThan(secondGuard);
    const end = yaml.indexOf('fi', lastExit) + 2;

    //   `exit` is neutralised rather than trimmed, so a case can run the whole
    //   chain without killing the shell inspecting it — and so the second guard
    //   is genuinely reachable when the first does not fire.
    return yaml.slice(start, end).replace(/\bexit 1\b/g, 'true');
}

/** Run the classifier for one HTTP code and one response body. */
function classify(httpCode: string, body: string, redirectUrl = ''): string {
    const dir = mkdtempSync(join(tmpdir(), 'cron-classify-'));
    const bodyFile = join(dir, 'body.json');
    writeFileSync(bodyFile, body);

    const script = [
        `http_code="${httpCode}"`,
        `redirect_url="${redirectUrl}"`,
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

describe('#632 — a redirect is not a success', () => {
    /*
     *   THE CHECK USED TO BE `if [ "$http_code" -ge 400 ]`, AND A 3xx IS NOT
     *   GREATER THAN 400. A redirect therefore made the step PASS while the
     *   endpoint was never invoked — eight scheduled jobs reporting green, for
     *   ever, having done nothing. The alarm that exists to say the jobs are not
     *   running would have said they were.
     *
     *   Reachable by one character: the middleware answers 308 from the apex to
     *   canonicalise the host, so PRODUCTION_URL set to
     *   https://easysalesexport.com instead of https://www.easysalesexport.com
     *   is enough to do it.
     */
    it.each(['301', '302', '307', '308'])('A %s FAILS THE RUN', (code) => {
        const out = classify(code, '', 'https://www.easysalesexport.com/api/cron/process-email-queue');

        expect(out).toContain('PRODUCTION_URL REDIRECTS, SO THE JOB DID NOT RUN');
        expect(out).toContain('a redirect is not a run');
    });

    it('AND IT NAMES WHERE IT WAS SENT, so the fix is the message', () => {
        const out = classify('308', '', 'https://www.easysalesexport.com/api/cron/process-email-queue');
        expect(out).toContain('https://www.easysalesexport.com/api/cron/process-email-queue');
    });

    it('AND SAYS SOMETHING USEFUL EVEN WHEN THE LOCATION IS MISSING', () => {
        //   curl leaves %{redirect_url} empty on a 3xx with no Location. The
        //   message must still be actionable rather than trailing off.
        const out = classify('308', '');
        expect(out).toContain('an unnamed location');
    });

    it('AND A 200 STILL PASSES — the guard on the guard', () => {
        /*
         *   The way this fix becomes an outage: a comparison that caught
         *   everything would fail every healthy run, and the first response
         *   would be to switch the schedule off again, which is exactly how the
         *   779 failures ended.
         */
        expect(classify('200', '{"success":true,"processed":12}')).toBe('');
    });

    it('AND A 4xx IS STILL CLASSIFIED, not swallowed by the redirect branch', () => {
        //   The two guards run in order; the redirect one must not shadow the
        //   one after it.
        expect(classify('404', EDGE_404)).toContain('NOTHING IS DEPLOYED AT PRODUCTION_URL');
        expect(classify('500', '{}')).toContain('returned HTTP 500');
    });
});

describe('#632 — and the values the classifier reads are the ones curl writes', () => {
    /*
     *   THE CLASSIFIER WAS TESTED AND ITS PLUMBING WAS NOT. Every case above
     *   sets `http_code` and `redirect_url` itself, so a mutant that stopped
     *   curl from EMITTING the redirect target survived them all — the messages
     *   would silently degrade to "an unnamed location" on every redirect, which
     *   is precisely the field that tells somebody what to fix.
     *
     *   curl cannot be run against a live host from here, so what is checked is
     *   the CONTRACT between the two lines: the format string writes exactly the
     *   values the `read` destructures, in that order.
     */
    function curlFormat(): string {
        const yaml = readFileSync(join(process.cwd(), WORKFLOW), 'utf8');
        const m = /-w '([^']+)'/.exec(yaml);
        expect(m).not.toBeNull();
        return m![1];
    }

    function readVariables(): string[] {
        const yaml = readFileSync(join(process.cwd(), WORKFLOW), 'utf8');
        const m = /read -r ([\w ]+) <<</.exec(yaml);
        expect(m).not.toBeNull();
        return m![1].trim().split(/\s+/);
    }

    it('CURL WRITES ONE VALUE FOR EACH VARIABLE THE SHELL READS', () => {
        const placeholders = [...curlFormat().matchAll(/%\{(\w+)\}/g)].map(x => x[1]);
        const variables = readVariables();

        expect(placeholders).toEqual(['http_code', 'redirect_url']);
        expect(variables).toEqual(['http_code', 'redirect_url']);
        //   The count is the part that breaks silently: one fewer value and the
        //   last variable is simply empty, with nothing to say so.
        expect(placeholders).toHaveLength(variables.length);
    });

    it('AND THE PARSE REALLY DOES SPLIT THEM — run, not assumed', () => {
        //   The `read <<<` line executed against what curl would produce.
        const sample = '308 https://www.easysalesexport.com/api/cron/process-email-queue';
        const out = execFileSync('bash', ['-c',
            `read -r ${readVariables().join(' ')} <<< "${sample}"; echo "[$http_code][$redirect_url]"`,
        ], { encoding: 'utf8' }).trim();

        expect(out).toBe('[308][https://www.easysalesexport.com/api/cron/process-email-queue]');
    });

    it('AND A 200 WITH NO REDIRECT LEAVES THE SECOND EMPTY, not unset-and-noisy', () => {
        //   curl emits an empty redirect_url on a non-3xx, so the trailing space
        //   is normal and must parse cleanly rather than tripping `read`.
        const out = execFileSync('bash', ['-c',
            `read -r ${readVariables().join(' ')} <<< "200 "; echo "[$http_code][$redirect_url]"`,
        ], { encoding: 'utf8' }).trim();

        expect(out).toBe('[200][]');
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
 *     #631 every failure is the generic message again                KILLED
 *     #631 the edge 404 is classified as a missing route             KILLED
 *     #631 the refused-secret case is dropped                        KILLED
 *     #631 the app-404 case is dropped                               KILLED
 *     #631 the generic fallback is dropped                           KILLED
 *     #631 the edge check matches EVERYTHING                         KILLED
 *     #632 a 3xx passes again (job never runs, reports green)        KILLED
 *     #632 the redirect guard swallows healthy runs too              KILLED
 *     #632 the redirect guard shadows the 4xx classifier             KILLED
 *     #632 the redirect message stops naming the location            KILLED
 *     #632 curl stops capturing the redirect target                  KILLED
 *     the schedule is commented out again                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   "The redirect guard swallows healthy runs too" is the way #632 becomes an
 *   outage rather than a fix: a comparison that caught every response would fail
 *   every healthy run, and the first response to that would be to switch the
 *   schedule off — which is exactly how the 779 failures ended.
 *
 * ── TWO OF THESE ONLY DIED AFTER THE TEST WAS REPAIRED ──────────────────────
 *
 *   The extraction sliced to the FIRST `exit 1`, which was the end of everything
 *   until #632 put a new guard in front of it. Four cases then ran against a
 *   script that no longer contained the branch they were named for — and said
 *   nothing, because an empty branch produces no output and every assertion was
 *   `not.toContain`. It spans both guards now, with `exit` neutralised so the
 *   second is genuinely reachable.
 *
 *   And the classifier was tested while its PLUMBING was not: every case set
 *   `http_code` and `redirect_url` by hand, so a mutant that stopped curl
 *   emitting the redirect target survived all of them. The messages would have
 *   degraded to "an unnamed location" on every redirect — the one field that
 *   tells somebody what to fix. The format string and the `read` that consumes
 *   it are now pinned to each other, and the parse is executed rather than
 *   assumed.
 */
