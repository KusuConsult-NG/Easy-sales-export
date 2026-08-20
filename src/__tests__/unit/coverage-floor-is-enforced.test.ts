/**
 * @jest-environment node
 */

/**
 * The coverage thresholds read as a gate and gated nothing.
 *
 * jest.config.js declared:
 *
 *     branches: 60, functions: 60, lines: 70, statements: 70
 *
 * The actual figures were 20.46 / 27.32 / 32.26 / 31.45. Every one of those
 * thresholds failed — and nobody saw it, because a coverageThreshold applies
 * only when Jest runs with --coverage, and neither the pre-push hook nor CI
 * passed it. Both ran `npm run test`.
 *
 * So the numbers were evidence of nothing while reading as evidence that
 * coverage is enforced at 70%. That is the same defect this audit removed three
 * times elsewhere: env-validator's weak-secret check, computed only in
 * production and printed only outside it; GATED_SEGMENTS, twenty-two entries of
 * security-shaped config that nothing imported; admin buttons wired to no
 * handler. A control nothing runs is worse than an absent one, because it stops
 * anybody looking.
 *
 * WHAT WAS DONE
 * -------------
 * The thresholds are set at the measured floor with about half a point of
 * headroom, which turns them from an aspiration into a ratchet, and CI runs
 * `npm run test:coverage` so something actually applies them.
 *
 * WHY 31% IS BOTH WORSE AND BETTER THAN IT LOOKS
 * ----------------------------------------------
 * 147 of 263 unit suites read SOURCE TEXT and assert on it. That is deliberate
 * — this codebase's defects were overwhelmingly structural, and a source
 * assertion states a structural fact precisely — but such a test executes
 * almost no application code, so it contributes ~0 coverage while still being a
 * real gate.
 *
 * So the coverage figure measures how much of the app is EXERCISED, and 3,884
 * passing tests measures something else. Neither substitutes for the
 * integration, db and e2e jobs, which are the only things that run this code
 * against a real database and a browser.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/**
 * The floor as measured on 2026-08-19, after the audit.
 *
 * These may only go UP. A threshold below its entry here means somebody lowered
 * the bar, which is the thing the old aspirational numbers made invisible.
 */
const FLOOR = { branches: 20, functions: 27, lines: 32, statements: 31 } as const;

function declaredThresholds(): Record<string, number> {
    const cfg = source('jest.config.js');
    const block = cfg.slice(cfg.indexOf('coverageThreshold'), cfg.indexOf('testMatch'));
    const out: Record<string, number> = {};
    for (const m of block.matchAll(/(branches|functions|lines|statements):\s*(\d+(?:\.\d+)?)/g)) {
        out[m[1]] = Number(m[2]);
    }
    return out;
}

describe('the coverage floor is a ratchet', () => {
    it('every metric has a declared threshold', () => {
        expect(Object.keys(declaredThresholds()).sort())
            .toEqual(['branches', 'functions', 'lines', 'statements']);
    });

    it.each(Object.entries(FLOOR))('%s is at or above the recorded floor of %d', (metric, floor) => {
        // THE test. Lowering a threshold fails here, so it cannot be done
        // quietly to make a red run green.
        expect(declaredThresholds()[metric]).toBeGreaterThanOrEqual(floor as number);
    });

    it('and none of them is back to the aspirational value that was never met', () => {
        // Not "must be low" — must not be a number nobody checked. 70/60 failed
        // for an unknown length of time while reading as enforced.
        const declared = declaredThresholds();
        expect(declared.lines).not.toBe(70);
        expect(declared.statements).not.toBe(70);
        expect(declared.branches).not.toBe(60);
        expect(declared.functions).not.toBe(60);
    });
});

describe('something actually applies it', () => {
    const ci = source('.github/workflows/ci.yml');

    it('CI runs test:coverage, which is the only command that enforces a threshold', () => {
        // THE other half. A ratchet nothing turns is the defect this replaces.
        expect(ci).toMatch(/^\s*run:\s*npm run test:coverage\s*$/m);
    });

    it('and no longer runs the bare command that ignores it', () => {
        expect(ci).not.toMatch(/run:\s*npm run test\s*$/m);
    });

    it('once, not twice — coverage instruments the same suite', () => {
        // Counted on `run:` LINES, not on every mention. The step above it
        // explains itself in a comment that names the command, and counting
        // prose as an invocation is the same mistake as asserting against a
        // commented-out call — which this audit made once for real, in
        // admin/_legacy.ts.
        const runs = (ci.match(/^\s*run:\s*npm run test:coverage\s*$/gm) ?? []).length;
        expect(runs).toBe(1);
    });

    it('with the heap the build step needed, since instrumentation raises it', () => {
        // This job has already died at the default heap once, and a CI run that
        // cannot complete discards the signal for the change that triggered it.
        const at = ci.search(/^\s*run:\s*npm run test:coverage\s*$/m);
        expect(at).toBeGreaterThan(-1);
        expect(ci.slice(at, at + 200)).toContain('NODE_OPTIONS: --max-old-space-size=4096');
    });

    it('the script itself passing --coverage', () => {
        // Vacuity guard: `test:coverage` has to be the flag, not just a name.
        expect(source('package.json')).toContain('"test:coverage": "jest --coverage"');
    });
});

describe('the pre-push hook is deliberately left alone', () => {
    it('it still runs the fast command', () => {
        // A developer pushing should not wait for instrumentation, and the hook
        // is not where a coverage regression needs to be caught — CI is. Stated
        // so the difference reads as a choice rather than an oversight.
        expect(source('.husky/pre-push')).toContain('npm run test');
        expect(source('.husky/pre-push')).not.toContain('test:coverage');
    });
});

describe('the config says what the number means', () => {
    it('recording that a structural test contributes no coverage', () => {
        // The explanation matters more than the number: without it, 31% reads
        // as "barely tested" and 3,884 tests reads as "thoroughly tested", and
        // both readings are wrong.
        const cfg = source('jest.config.js');
        expect(cfg).toContain('A RATCHET, set to the true floor');
        expect(cfg).toContain('read SOURCE TEXT');
        expect(cfg).toContain('contributes ~0 coverage');
    });

    it('and pointing at the jobs that do exercise the code', () => {
        expect(source('jest.config.js')).toContain('.github/workflows/ci.yml');
    });
});
