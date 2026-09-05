/**
 * @jest-environment node
 */

/**
 *   #392 A jest.mock THAT NEVER MOCKED — AND A SUITE THAT HAD BEEN ASSERTING
 *        THE PRODUCTION DEFAULT WHILE ITS OWN MOCK SAID SOMETHING ELSE.
 *
 *   THE MECHANISM, MEASURED RATHER THAN ASSUMED
 *   -------------------------------------------
 *   jest.mock is hoisted above a module's imports so the mock registry is set
 *   before anything is loaded. That hoist happens only when `jest` is the
 *   GLOBAL. Taking it from '@jest/globals' in the same file defeats it: the
 *   imports run first, the real module is already in the registry, and the
 *   jest.mock call lands too late to change anything. It throws nothing and
 *   logs nothing.
 *
 *   Two one-line probes settled it — identical files but for where `jest` came
 *   from, each mocking a module it then imported directly:
 *
 *       import { jest } from '@jest/globals'   isMockFunction -> false
 *       the global jest                        isMockFunction -> true
 *
 *   WHAT IT HAD COST
 *   ----------------
 *   delivery-fee.test.ts mocked getPlatformFees to return baseDeliveryFee 1500
 *   and then asserted a fee of 2000 — and passed, because the mock did nothing
 *   and DEFAULT_DELIVERY_FEES.baseDeliveryFee happens to be 2000. So the suite
 *   proved the formula against one hardcoded configuration, which is exactly
 *   what mocking the settings was meant to avoid; #317 made that fee editable
 *   from an admin screen. Its expectations are now derived from the mocked
 *   fees, so a changed RULE fails the suite and a changed DEFAULT does not.
 *
 *   qoreid-identity-matching.test.ts mocked the logger, which is harmless in
 *   effect — but a mock that does not mock is a claim the suite cannot back,
 *   and it is indistinguishable from one that matters until somebody checks.
 *
 *   MY FIRST SCAN REPORTED A FOURTH, AND IT WAS WRONG
 *   -------------------------------------------------
 *   paystack-verify-no-mock.test.ts came up as a direct hit. It is not: the
 *   jest.mock the scanner found is inside a COMMENT explaining that this suite
 *   deliberately does NOT mock paystack-server. The scanner was reading raw
 *   text. Recorded rather than quietly dropped — a scan that cannot tell code
 *   from prose reports correct files as broken, which is the worst kind of
 *   false positive because it reads like a finding. That is the same tombstone
 *   trap as #383 and #384, in a new place, and it is why the detector below
 *   strips comments before it looks.
 *
 *   WHAT THIS RATCHET DOES
 *   ----------------------
 *   For every suite that calls jest.mock while importing `jest` from
 *   '@jest/globals', it walks the static import graph of that suite and fails
 *   if any mocked module is reachable — because then the mock is registered
 *   after the module it targets has already loaded.
 *
 *   Suites that import the module under test DYNAMICALLY (`await import(...)`
 *   inside a test or helper) are unaffected and are the established pattern in
 *   this codebase; the walk only follows static imports, which is what the
 *   hoist race is about.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     delivery-fee takes jest from @jest/globals again    KILLED
 *     qoreid reverts to the importing form                KILLED
 *     the rule stops reading outsideCityDeliveryFee       KILLED
 *     change a DEFAULT fee the suite no longer depends on SURVIVED, as intended
 *
 *   The control is the point of the whole repair: before this, changing
 *   DEFAULT_DELIVERY_FEES.baseDeliveryFee broke the delivery-fee suite, because
 *   the suite was reading the default rather than its own mock. Now it does not.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, normalize } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) {
        try {
            cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
        } catch {
            cache.set(p, '');
        }
    }
    return cache.get(p)!;
};

/** `@/x` and relative specifiers to a file on disk; anything else is null. */
function resolve(spec: string, from: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = normalize(join(dirname(from), spec));
    else return null;

    for (const candidate of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/** Static, value-level imports only — `import type` is erased and races nothing. */
const IMPORT = /^import\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
function importsOf(p: string): string[] {
    const out: string[] = [];
    for (const m of code(p).matchAll(IMPORT)) {
        if (m[1]) continue;
        out.push(m[2]);
    }
    return out;
}

function reaches(start: string, targets: Set<string>, seen = new Set<string>(), depth = 0): string | null {
    if (seen.has(start) || depth > 12) return null;
    seen.add(start);
    for (const spec of importsOf(start)) {
        const target = resolve(spec, start);
        if (!target) continue;
        if (targets.has(target)) return target;
        const deeper = reaches(target, targets, seen, depth + 1);
        if (deeper) return deeper;
    }
    return null;
}

function suites(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            suites(full, out);
        } else if (/\.test\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const SUITES = suites(SRC);

const JEST_FROM_GLOBALS = /import\s*\{[^}]*\bjest\b[^}]*\}\s*from\s*['"]@jest\/globals['"]/;
const MOCK_CALL = /jest\.mock\(\s*['"]([^'"]+)['"]/g;

interface LateMock { suite: string; mocked: string; loadedVia: string }

function lateMocks(suite: string): LateMock[] {
    const src = code(suite);
    if (!src.includes('jest.mock(')) return [];
    if (!JEST_FROM_GLOBALS.test(src)) return [];

    const mocked = new Set<string>();
    for (const m of src.matchAll(MOCK_CALL)) {
        const target = resolve(m[1], suite);
        if (target) mocked.add(target);
    }
    if (mocked.size === 0) return [];

    const found: LateMock[] = [];
    for (const spec of importsOf(suite)) {
        const target = resolve(spec, suite);
        if (!target) continue;
        const hit = mocked.has(target) ? target : reaches(target, mocked);
        if (hit) {
            found.push({
                suite: relative(ROOT, suite),
                mocked: relative(ROOT, hit),
                loadedVia: relative(ROOT, target),
            });
            break;
        }
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#392 — the detector works before it is trusted', () => {
    it('THERE ARE SUITES TO SCAN', () => {
        expect(SUITES.length).toBeGreaterThan(400);
    });

    it('and it resolves the specifiers this codebase actually writes', () => {
        expect(resolve('@/lib/system-settings', join(SRC, 'x.ts'))).not.toBeNull();
        expect(resolve('@/lib/testing/strip-comments', join(SRC, 'x.ts'))).not.toBeNull();
        // A bare package name is not ours to resolve, and a missing file is null
        // rather than a guessed path.
        expect(resolve('react', join(SRC, 'x.ts'))).toBeNull();
        expect(resolve('@/lib/there-is-no-such-module', join(SRC, 'x.ts'))).toBeNull();
    });

    it('and it follows imports TRANSITIVELY, not just direct ones', () => {
        // The case that bit #391: the suite imported an action, and the action
        // — not the suite — pulled in the mocked module.
        const action = join(SRC, 'app/actions/order-management.ts');
        const notifications = new Set([join(SRC, 'lib/marketplace-notifications.ts')]);
        expect(reaches(action, notifications)).not.toBeNull();
    });

    it('and it reads CODE, not comments', () => {
        // paystack-verify-no-mock.test.ts explains in prose that it deliberately
        // does not mock paystack-server. A raw-text scan called that a finding.
        const suite = join(SRC, '__tests__/unit/paystack-verify-no-mock.test.ts');
        expect(code(suite).includes('jest.mock(')).toBe(false);
        expect(readFileSync(suite, 'utf-8').includes('jest.mock(')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#392 — every jest.mock in this repository takes effect', () => {
    it('NO SUITE REGISTERS A MOCK AFTER ITS TARGET HAS ALREADY LOADED', () => {
        const late = SUITES.flatMap(lateMocks);

        // Each entry means: this suite mocks that module, but loads it first
        // through this import — so the mock does nothing and the suite is
        // testing the real thing while claiming otherwise. The fix is to stop
        // importing `jest` from '@jest/globals' in that file, so jest.mock
        // hoists; or to import the module under test dynamically.
        expect(late).toEqual([]);
    });
});
