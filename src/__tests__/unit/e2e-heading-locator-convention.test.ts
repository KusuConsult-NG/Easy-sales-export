/**
 * @jest-environment node
 */

/**
 * Browser specs must not assert on a bare `page.locator('h1')`.
 *
 * WHY — THREE RANDOM FAILURES IN THREE CONSECUTIVE RUNS
 * ----------------------------------------------------
 * `locator('h1')` is strict: two matches is an error, not a "pick the first".
 * And during hydration this application briefly HAS two, because React holds
 * the server-rendered element and its replacement at the same time while it
 * reconciles. Measured rather than assumed — sampling
 * document.querySelectorAll('h1').length every 50ms from navigation-commit
 * produces a series like 1,2,1,1,1... The server sends one, the source contains
 * one, and the settled page has one.
 *
 * So any spec asserting on locator('h1') fails whenever it happens to look
 * inside that window. It is a coin toss, and it landed differently three runs
 * in a row:
 *
 *   run 3  e2e/marketplace-critical-flows.spec.ts   "Guest user can browse products"
 *   run 6  tests/e2e/escrow.spec.ts                 "should display feature toggles page"
 *   run 6  tests/e2e/rbac-security.spec.ts          "admin users SHOULD access admin dashboard"
 *
 * All three had passed in some earlier run. A suite that fails somewhere
 * different each time teaches people to re-run it rather than read it, which is
 * how a real regression ends up dismissed as "just flaky".
 *
 * THE FIX, AND WHY IT IS NOT A WORKAROUND
 * ---------------------------------------
 * getByRole('heading', { level: 1 }) resolves through the ACCESSIBILITY TREE,
 * which contains only one of the two — Playwright's own error messages name the
 * survivor getByRole('heading', ...) and the transient getByText(...).nth(N),
 * and the captured aria snapshots list a single heading.
 *
 * It is also the better assertion on its own merits: it checks what a user and a
 * screen reader actually perceive as the page heading, rather than which tag the
 * markup happens to use.
 *
 * `.first()` is NOT the fix. It would silence a genuine duplicate heading, which
 * is a real accessibility defect this audit has already had to find once.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SPEC_DIRS = [join(process.cwd(), 'e2e'), join(process.cwd(), 'tests', 'e2e')];

function specFiles(): string[] {
    const found: string[] = [];
    for (const dir of SPEC_DIRS) {
        for (const entry of readdirSync(dir)) {
            if (entry.endsWith('.spec.ts')) found.push(join(dir, entry));
        }
    }
    return found;
}

/** Comments stripped, so the explanations in the specs are not read as code. */
function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter(line => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('e2e specs address headings through the accessibility tree', () => {
    const files = specFiles().map(file => ({ file, code: codeOf(file) }));

    it('found the specs (sanity)', () => {
        // Without this, a moved directory empties the check and it passes having
        // read nothing.
        expect(files.length).toBeGreaterThan(15);
    });

    it("no spec asserts on a bare page.locator('h1')", () => {
        const offenders = files
            .filter(f => /page\.locator\(\s*['"]h1['"]\s*\)/.test(f.code))
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(
            offenders.length === 0
                ? 'ok'
                : `These will fail at random: locator('h1') is strict and this app briefly ` +
                  `renders two h1 elements during hydration. Use ` +
                  `getByRole('heading', { level: 1 }) — NOT .first(), which would hide a ` +
                  `genuine duplicate heading: ${offenders.join(', ')}`
        ).toBe('ok');
    });

    it('the role-based form is actually in use (vacuity guard)', () => {
        // The check above also passes if every heading assertion was simply
        // deleted. At least several specs must still assert on a heading.
        const users = files.filter(f =>
            /getByRole\(\s*['"]heading['"]/.test(f.code)
        ).length;

        expect(users).toBeGreaterThanOrEqual(8);
    });
});
