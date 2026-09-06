/**
 * @jest-environment node
 */

/**
 *   #441 TWO TESTS IN THIS SUITE COULD NOT FAIL, AND BOTH WERE NAMED FOR
 *   PRODUCTION SECURITY BEHAVIOUR.
 *
 *   Found by sweeping all 571 suite files for tests whose only assertion holds
 *   for every possible program. Exactly two came back, both in
 *   security-checks.test.ts:
 *
 *       should fail in production mode with known-weak secret patterns
 *       should fail in production with secrets under 32 characters
 *
 *   with `expect(true).toBe(true); // placeholder` as the whole body. Their
 *   stated reason — "NODE_ENV is read-only in Next.js Jest environment" — was
 *   false, and the same file disproved it twenty lines later, where
 *   validateRequiredEnvVars's test sets NODE_ENV to 'production' and has always
 *   passed.
 *
 *   THIS IS THE RATCHET, NOT THE FINDING. Two is a small number; the point is
 *   that nothing stopped it being three. #74 found a coverage gate that gated
 *   nothing, #383 a lint gate that could not fail, #392 a jest.mock that never
 *   mocked, #440 a health screen that could not report ill health. A test that
 *   cannot fail is the same defect one level up, and it is invisible precisely
 *   because it is green.
 *
 *   THE SCANNER IS THE HARD PART, AND MINE WAS WRONG FIVE TIMES. Each version
 *   produced a confident list of false positives:
 *
 *     `it.each([...])('title', fn)` — matching the first parenthesis after the
 *        name grabs the DATA ARRAY, so every table-driven test looked empty.
 *        About twenty false hits.
 *     the word "it" in a block comment read as a declaration.
 *     a REGEX LITERAL with escaped parens unbalanced the paren matcher, so
 *        bodies were truncated at the regex and everything after it was
 *        invisible. Thirteen more, concentrated in the ratchet suites that use
 *        regexes most — the ones it would have been most embarrassing to
 *        report.
 *     a TEMPLATE LITERAL holding a test fixture read as a real declaration.
 *        The controls below are written that way, so the first run of this very
 *        suite reported three vacuous tests that are string data.
 *     `return /re/.test(x)` not recognised as a regex context — the `n` before
 *        the slash reads as division, so quotes inside the pattern opened a
 *        string that swallowed the rest of the body. Two real ratchet suites
 *        came back "no assertion at all". Five for five: every version of this
 *        scanner was wrong until it was run against the whole tree.
 *
 *   Every one of those would have been a false report had I trusted the first
 *   output, which is why the positive and negative controls below are part of
 *   the suite rather than something I checked once by hand.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a new expect(true).toBe(true)-only test appears     KILLED
 *     the scanner stops blanking comments                 KILLED
 *     the scanner stops blanking regex literals           KILLED
 *     expect-helper calls stop counting as assertions     KILLED
 *     reword the header prose                             SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { findVacuousTests, findTestBlocks, blankNonCode } from '@/lib/testing/find-vacuous-tests';

const ROOT = process.cwd();

function suiteFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules') continue;
            suiteFiles(p, out);
        } else if (/\.(test|spec)\.tsx?$/.test(name)) {
            out.push(relative(ROOT, p));
        }
    }
    return out;
}

const ALL_SUITES = [
    ...suiteFiles(join(ROOT, 'src')),
    ...suiteFiles(join(ROOT, 'tests')),
].sort();

/**
 * Tests allowed to carry no failing assertion, each with the reason.
 *
 * Empty, and that is the point: the two that were here have been written to
 * assert what they are named for. An entry may be added, but somebody has to
 * write down why — the treatment #435, #436 and #437 gave their exemption
 * lists.
 */
const ALLOWED_TO_ASSERT_NOTHING: Record<string, string> = {};

// ─────────────────────────────────────────────────────────────────────────────
describe('#441 — no test passes without asserting something', () => {
    it('THERE IS NO TEST THAT CANNOT FAIL', () => {
        const vacuous = ALL_SUITES
            .flatMap((rel) => findVacuousTests(rel, readFileSync(join(ROOT, rel), 'utf-8')))
            .filter((v) => !(`${v.file}:${v.title}` in ALLOWED_TO_ASSERT_NOTHING))
            .map((v) => `${v.file}:${v.line} — "${v.title}" (${v.reason})`);

        // A new entry here is a test that reports green on any code at all,
        // under a name that tells a reader the behaviour is covered.
        expect({ vacuous }).toEqual({ vacuous: [] });
    });

    it('and every exemption carries a reason, not just a name', () => {
        for (const [name, reason] of Object.entries(ALLOWED_TO_ASSERT_NOTHING)) {
            expect({ name, explained: reason.trim().length > 25 }).toEqual({ name, explained: true });
        }
    });

    it('VACUITY GUARD: the sweep really is reading the whole suite', () => {
        // Without this, a path that matched nothing would pass the test above
        // for the wrong reason — this audit's most repeated mistake, and one
        // this suite would be absurd to make.
        expect(ALL_SUITES.length).toBeGreaterThan(500);
        const blocks = ALL_SUITES.reduce(
            (n, rel) => n + findTestBlocks(blankNonCode(readFileSync(join(ROOT, rel), 'utf-8'))).length,
            0,
        );
        expect(blocks).toBeGreaterThan(5000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#441 — the scanner itself, which was wrong five times', () => {
    it('POSITIVE CONTROL: it finds a test whose only assertion is a tautology', () => {
        const sample = `
            it('claims to check something', () => {
                expect(true).toBe(true); // placeholder
            });
        `;
        const found = findVacuousTests('sample.test.ts', sample);
        expect(found).toHaveLength(1);
        expect(found[0].reason).toBe('ONLY TAUTOLOGICAL ASSERTIONS');
    });

    it('and one with no assertion at all', () => {
        const sample = `
            it('does some setup and forgets to check', () => {
                const x = compute();
                console.log(x);
            });
        `;
        expect(findVacuousTests('sample.test.ts', sample)[0].reason).toBe('NO ASSERTION AT ALL');
    });

    it('NEGATIVE CONTROL: it.each tables are NOT called assertion-free', () => {
        // Bug 1. Matching the first parenthesis after the name grabs the data
        // array rather than the callback, and every table-driven test in the
        // repository looked empty.
        const sample = `
            it.each([['a', 1], ['b', 2]])('handles %s', (name, value) => {
                expect(value).toBeGreaterThan(0);
            });
        `;
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });

    it('and the word "it" inside a comment is not a test', () => {
        // Bug 2.
        const sample = `
            /**
             * A previous pass deferred it ("changing them is a behaviour
             * change to working paths").
             */
            it('really does assert', () => { expect(1).toBe(2); });
        `;
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });

    it('and a REGEX LITERAL with escaped parens does not truncate the body', () => {
        // Bug 3, the worst: the body was cut off at the regex, so every
        // assertion after it was invisible. Thirteen false hits, in the ratchet
        // suites that use regexes most.
        const sample = String.raw`
            it('scans with a regex first', () => {
                const hits = src.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g);
                expect([...hits]).toEqual([]);
            });
        `;
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });

    it('and an assertion made through an expect-NAMED HELPER still counts', () => {
        // Reading only the literal `expect(` called four real tests empty.
        const sample = `
            it('asserts through a helper', async () => {
                const result = await run();
                expectNotAValidationFailure(result);
            });
        `;
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });

    it('and a test fixture inside a TEMPLATE LITERAL is string data, not a test', () => {
        // Bug 4, found by running this suite: every control above is written
        // inside backticks, and the first version counted them as real tests.
        const sample = [
            'const fixture = `',
            "    it('a fixture, not a test', () => { });",
            '`;',
            "it('the real test', () => { expect(fixture.length).toBeGreaterThan(1); });",
        ].join('\n');
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });

    it('and a test that only throws on failure is not vacuous', () => {
        // The loop-and-throw shape platform-fee-split.test.ts uses: the throw
        // IS the assertion, and its trailing expect(true).toBe(true) is only
        // there to satisfy a linter.
        const sample = `
            it('checks a property across a range', () => {
                for (let n = 0; n < 10; n++) {
                    if (f(n) !== g(n)) throw new Error('mismatch at ' + n);
                }
                expect(true).toBe(true);
            });
        `;
        expect(findVacuousTests('sample.test.ts', sample)).toEqual([]);
    });
});
