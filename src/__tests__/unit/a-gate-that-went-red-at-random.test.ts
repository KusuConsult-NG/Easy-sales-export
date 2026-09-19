/**
 * @jest-environment node
 */

/**
 *   #894 A FLAKY GATE REJECTED GOOD WORK, AND THE GATE IS A PUSH.
 *
 *   MEASURED ON AN UNCHANGED TREE, three consecutive runs:
 *
 *       full suite    deploy-sql-carries-what-the-code-calls   17 tests FAILED
 *       that file alone                                        12 tests passed
 *       full suite again                          all 881 files passed
 *
 *   Nothing changed between them. Jest runs many workers and several suites
 *   spawn `node scripts/…`; under that load a spawn intermittently fails to
 *   start and `execFileSync` throws before the script has run a line. Two of
 *   those spawns are in `beforeAll`, so the whole file goes red.
 *
 *   IT IS NOT MERELY NOISE. `.husky/pre-push` runs this suite, so a spawn that
 *   fails to start REJECTS A PUSH of work that is correct — which happened to
 *   this audit's own #888/#889 commit and was only noticed a round trip later,
 *   when the branch turned out not to have moved. On a platform whose owner's
 *   standing complaint is "every time we fix it, it breaks", a gate that goes
 *   red at random is worse than no gate: it teaches everybody to push past red,
 *   and then a real failure looks the same as the noise.
 *
 * ── THE DISTINCTION THIS SUITE EXISTS TO PIN ────────────────────────────────
 *
 *   A retry is only correct for ONE of the two ways a spawn can fail, and
 *   getting that wrong would hide the very defect the deploy suites catch:
 *
 *       failed to START     no `status`, an errno code (EAGAIN, ENOMEM) —
 *                           the process never ran. Retry.
 *       ran and EXITED      a numeric `status` — the script made a decision.
 *                           Never retry; that exit is the assertion.
 *
 *   deploy-sql-carries-what-the-code-calls says so in its own words: "Building
 *   it IS the first assertion: the script exits non-zero rather than emitting a
 *   file that omits a migration nobody accounted for."
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runNodeScript } from '@/lib/testing/run-node-script';

const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
describe('#894 — a script that runs is run, and its exit is respected', () => {
    it('THE ORDINARY CASE: stdout comes back', () => {
        const out = runNodeScript('-e', ['process.stdout.write("hello")'], { cwd: ROOT });

        expect(out).toBe('hello');
    });

    it('AND A NON-ZERO EXIT THROWS — it is not retried away', () => {
        /*
         *   THE PROPERTY THAT MATTERS MOST. If this ever stops throwing, the
         *   deploy suites stop catching a missing migration, which is the
         *   failure they were written for.
         */
        expect(() => runNodeScript('-e', ['process.exit(3)'], { cwd: ROOT }))
            .toThrow();
    });

    it('AND THE THROWN ERROR IS THE REAL ONE, carrying the real status', () => {
        //   Not an error invented by the wrapper — an investigator needs the
        //   script's own exit code and stderr.
        let caught: any;
        try {
            runNodeScript('-e', ['process.exit(7)'], { cwd: ROOT });
        } catch (err) { caught = err; }

        expect(caught).toBeDefined();
        expect(caught.status).toBe(7);
    });

    it('AND A NON-ZERO EXIT IS ATTEMPTED EXACTLY ONCE', () => {
        /*
         *   Retrying a real refusal would make a red run three times slower and
         *   no less red. Counted by having the script append to a file, so this
         *   measures attempts rather than trusting the implementation.
         */
        const { mkdtempSync, existsSync, readFileSync: rf } = require('fs') as typeof import('fs');
        const { tmpdir } = require('os') as typeof import('os');
        const dir = mkdtempSync(join(tmpdir(), 'runnode-'));
        const marker = join(dir, 'attempts.txt');

        try {
            runNodeScript(
                '-e',
                [`require("fs").appendFileSync(${JSON.stringify(marker)}, "x"); process.exit(4)`],
                { cwd: ROOT },
            );
        } catch { /* expected */ }

        expect(existsSync(marker)).toBe(true);
        expect(rf(marker, 'utf8')).toBe('x');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#894 — and the flaky suites go through it', () => {
    it('BOTH DEPLOY SUITES BUILD THROUGH THE RETRYING HELPER', () => {
        /*
         *   The two that were observed failing. A source assertion, because the
         *   condition being fixed — a spawn storm across Jest workers — is not
         *   reproducible inside one worker on demand.
         */
        for (const rel of [
            'src/__tests__/unit/deploy-sql-carries-what-the-code-calls.test.ts',
            'src/__tests__/unit/the-deploy-file-nobody-could-generate.test.ts',
        ]) {
            const src = readFileSync(join(ROOT, rel), 'utf8');

            expect({ rel, uses: src.includes('runNodeScript(') })
                .toEqual({ rel, uses: true });
            //   And no longer spawn the build directly.
            expect({ rel, direct: /execFileSync\(\s*['"]node['"]/.test(src) })
                .toEqual({ rel, direct: false });
        }
    });

    it('AND THE HELPER ONLY EVER RETRIES A START FAILURE', () => {
        //   Read from the source rather than assumed: a future edit that widens
        //   the retry to "any error" is the one that would hide a real refusal.
        const src = readFileSync(join(ROOT, 'src/lib/testing/run-node-script.ts'), 'utf8');

        expect(src).toContain('if (typeof e.status === "number") return false;');
        expect(src).toContain('if (!failedToStart(err)) throw err;');
    });
});
