/**
 * @jest-environment node
 */

/**
 *   #677 THE WORST THING THE PAYMENT RECONCILIATION CAN FIND WAS REPORTED AS
 *   SUCCESS.
 *
 *   `reconcile-paystack` compares what Paystack says it collected against what
 *   this database records, and grades the result:
 *
 *       0 discrepancies        ok
 *       1–3                    warning
 *       more than 3            CRITICAL
 *
 *   `critical` means MORE THAN THREE PAYMENTS EXIST IN PAYSTACK THAT ARE
 *   MISSING FROM THIS DATABASE — money the platform took and has no record of.
 *   It is the single most important thing this job exists to detect.
 *
 *   IT ANSWERED HTTP 200. The mapping was
 *
 *       ok      → 200
 *       warning → 200
 *       error   → 500
 *       everything else → 200
 *
 *   and `critical` is everything else. The 500 fired only when an exception had
 *   been thrown, so a run that completed perfectly and found fifty missing
 *   payments returned success.
 *
 *   AND NOTHING ELSE WAS WATCHING. The result is written to
 *   `system_health/paystack_reconciliation`, and that collection is read by NO
 *   screen, NO action and NO other route in this repository — the sweep below
 *   is that claim, kept honest. So the finding went into a document nobody
 *   opens, and the one process that does look at this job — the scheduled
 *   workflow, whose only lever is the HTTP status — was told the run succeeded.
 *
 *   Two of this audit's recurring shapes stacked on the money path: a check
 *   that cannot fail, and a record nothing consults. Every six hours, for ever.
 *
 * ── WHAT IS AND IS NOT CHANGED ──────────────────────────────────────────────
 *
 *   `warning` STAYS AT 200. One to three unmatched references is the ordinary
 *   noise of a payment window straddling a run boundary, and the workflow's own
 *   config-check records the principle in its comments: a failure every few
 *   hours is a failure nobody reads, one a day is a failure somebody fixes. The
 *   alarm is kept for the case that warrants one.
 *
 *   AND IT IS 409, NOT 500. #631 established that this workflow must say which
 *   KIND of failure it met. A reconciliation that RAN CORRECTLY and found a
 *   discrepancy is a third kind — the job is healthy and the data is not — and
 *   500 would say the endpoint broke, which is the one thing that did not
 *   happen.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const ROUTE = 'src/app/api/cron/reconcile-paystack/route.ts';
const WORKFLOW = '.github/workflows/scheduled-jobs.yml';

/** YAML comments at `#`, stripped the same way every other format is. */
const stripHash = (src: string) =>
    src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

/** The status mapping's own body, so an assertion about it cannot be satisfied elsewhere. */
const mapping = (): string => {
    const src = code(ROUTE);
    const at = src.indexOf('const httpStatus');
    expect(`mapping found: ${at >= 0}`).toBe('mapping found: true');
    return src.slice(at, src.indexOf(';', src.indexOf('200', at)) + 1);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#677 — a critical reconciliation is no longer a 200', () => {
    it('CRITICAL ANSWERS 409', () => {
        //   THE defect. `critical` fell through every arm of the conditional to
        //   the trailing 200.
        expect(mapping()).toContain('results.status === "critical" ? 409');
    });

    it('AND A THROWN ERROR IS STILL A 500, WHICH IS A DIFFERENT THING', () => {
        /*
         *   The distinction #631 exists for. "The endpoint broke" and "the
         *   endpoint worked and the money does not add up" need different
         *   people to do different things, and collapsing them into one code
         *   would undo that.
         */
        expect(mapping()).toContain('results.error                 ? 500');
    });

    it('AND ok AND warning ARE STILL 200', () => {
        /*
         *   THE control, and the reason this is not "make the job fail". One to
         *   three unmatched references is ordinary — a payment window
         *   straddling a run boundary — and a job that went red every six hours
         *   would be switched off, which is exactly what happened to this
         *   schedule once before (#631: 779 failures, then somebody commented
         *   the cron out).
         *
         *   Asserted through the mapping rather than by absence: a version that
         *   returned 409 for everything would satisfy the two lines above.
         */
        const m = mapping();
        expect(m).not.toContain('results.status === "warning"  ? 409');
        expect(m.trimEnd().endsWith('200;')).toBe(true);
    });

    it('AND THE GRADING THAT FEEDS IT IS UNCHANGED', () => {
        //   The mapping is only worth anything if `critical` still means what
        //   it meant. Four or more unmatched references.
        const src = code(ROUTE);
        expect(src).toContain('results.discrepancies === 0 ? "ok"');
        expect(src).toContain('results.discrepancies <= 3  ? "warning" :');
        expect(src).toContain('"critical"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#677 — and the workflow says which kind of failure a 409 is', () => {
    const wf = stripHash(read(WORKFLOW));

    it('IT HAS A BRANCH FOR IT', () => {
        /*
         *   Without this the run goes red with "returned HTTP 409", which reads
         *   as a broken endpoint — the exact misreading #631 spent three weeks
         *   and 779 failed runs on, when "HTTP 404" meant "nothing is deployed"
         *   and everybody read it as "the route is missing".
         */
        expect(wf).toContain('elif [ "$http_code" = "409" ]; then');
        expect(wf).toContain('THE JOB RAN AND FOUND A PROBLEM WITH THE DATA');
    });

    it('AND A 409 STILL FAILS THE RUN', () => {
        /*
         *   THE whole point. A branch that printed a friendly message and
         *   exited 0 would be the defect again with better wording.
         *
         *   The `exit 1` is shared by every arm of that if, so this asserts it
         *   sits after the 409 branch rather than that a `exit 1` exists
         *   somewhere in the file.
         */
        const at = wf.indexOf('elif [ "$http_code" = "409" ]; then');
        expect(at).toBeGreaterThan(-1);

        //   To the end of the enclosing `if`, not a fixed window — and the
        //   absence of an early exit, not merely the presence of `exit 1`.
        //   The first version asked `toContain('exit 1')` over 1,200
        //   characters, which an `exit 0` INSIDE the branch would have
        //   satisfied: both strings would be in the slice. Asserting that a
        //   good thing appears somewhere nearby is not asserting that the bad
        //   thing does not.
        const branch = wf.slice(at, wf.indexOf('exit 1', at));

        expect(branch).not.toContain('exit 0');
        expect(wf.slice(at)).toContain('exit 1');
    });

    it('AND THE BODY IS PRINTED, BECAUSE THE FINDING IS IN IT', () => {
        //   The 409 message points at the response body for the list of
        //   references. If the body stopped being printed the alarm would name
        //   a problem and show none of it.
        expect(wf).toContain('head -c 4000 /tmp/body.json');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#677 — and the claim that nothing reads system_health is measured', () => {
    /** Every application source file — not the tests, which discuss it. */
    const sources = (): string[] => {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
            }
        };
        for (const top of ['src', 'packages']) {
            try { walk(join(ROOT, top)); } catch { /* absent tree is not a finding */ }
        }
        return out;
    };

    const FILES = sources();

    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   The control every "nothing matches" assertion needs, or an empty
        //   file list proves the claim perfectly and means nothing.
        expect(FILES.length).toBeGreaterThan(500);
        expect(FILES.some((f) => f.endsWith(join('api', 'cron', 'reconcile-paystack', 'route.ts')))).toBe(true);
    });

    it('AND THE ONLY FILE THAT TOUCHES system_health IS THE ONE THAT WRITES IT', () => {
        /*
         *   The finding's second half, kept honest rather than asserted once in
         *   prose. If somebody builds a screen for this, this test fails and
         *   asks them to reconsider whether the 409 is still the only alarm —
         *   which is the right conversation to force.
         */
        const touching = FILES
            .filter((f) => /["'`]system_health["'`]/.test(stripComments(readFileSync(f, 'utf8'), { label: f })))
            .map((f) => relative(ROOT, f));

        expect(touching).toEqual([ROUTE]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: critical goes back to 200                           KILLED
 *     critical is reported as 500 instead                             KILLED
 *     warning starts failing the run too                              KILLED
 *     a thrown error stops being a 500                                KILLED
 *     the grading stops calling four discrepancies critical           KILLED
 *     the workflow's 409 branch is removed                            KILLED
 *     the 409 branch prints a message and exits 0                     KILLED
 *       — SURVIVED the first run twice over. The mutant inserted a
 *         SECOND `elif 409` after the real one, which shell never
 *         reaches, so nothing was mutated. But re-running it properly —
 *         an `exit 0` INSIDE the branch — showed the assertion was weak
 *         too: it asked `toContain('exit 1')` over a fixed window, and a
 *         slice holding both strings satisfies that. Asserting a good
 *         thing appears nearby is not asserting the bad thing is absent.
 *     the response body stops being printed                           KILLED
 *     the system_health sweep is narrowed to nothing                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The eight cron routes were read for how they report a bad outcome.
 *   reconcile-paystack was the only one with no `status: 500` at all, which is
 *   what drew attention to it; the other seven return a 500 from their catch.
 *   Whether anything reads the result it writes instead was then swept across
 *   src and packages rather than assumed, and the sweep is kept as a test.
 */
