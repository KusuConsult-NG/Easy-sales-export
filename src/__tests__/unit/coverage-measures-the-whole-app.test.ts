/**
 * @jest-environment node
 */

/**
 *   #436 THE COVERAGE GATE COULD NOT SEE THE 121 FILES REACHABLE FROM THE
 *   INTERNET.
 *
 *   Found while answering "how much is left to do", which turned out to be a
 *   question about the denominator rather than the numerator. collectCoverageFrom
 *   named three roots:
 *
 *       src/app/actions/**\/*.ts
 *       src/lib/**\/*.ts
 *       src/components/**\/*.{ts,tsx}
 *
 *   src/app/api was not among them. 121 route files — the server-side entry
 *   points, carrying the admin gates, the payment verifications and the money
 *   writes — were absent from the number CI enforces a floor against.
 *
 *   WHAT THAT WAS HIDING, MEASURED
 *
 *       API route files                121
 *       at 0% statements                87
 *       API surface, statements      25.8%   (1,457 / 5,649)
 *
 *   Adding them moved the headline from 67.3% to 61.7% statements and 55.8% to
 *   51.6% branches. Not a regression — the same suite, measured honestly.
 *
 *   AND LISTING THE DIRECTORIES FOUND MORE. Reading the config tells you what
 *   is in it; only the filesystem tells you what is missing. src/services (five
 *   modules that call getAdminDb() for the analytics, finance and user-metrics
 *   figures), src/hooks (13), src/contexts (3), src/infrastructure (4) and
 *   src/config were all outside the denominator too.
 *
 *   #74 found this same gate declaring 70% while the truth was 32%, because no
 *   command passed --coverage. This is its sibling and its harder half: the
 *   command runs now, and it was measuring the safest part of the codebase.
 *
 *   PAGES STAY OUT — A DECISION WITH ITS NUMBER ATTACHED. Adding
 *   src/app/**\/*.tsx (246 pages and layouts) gives 43.8% statements, 35.4%
 *   branches, 30.1% functions, 44% lines. Every one is below the floor, so
 *   including them means LOWERING the floor by ten to twenty-five points —
 *   trading a gate that bites for a bigger denominator. src/components (437
 *   files) already carries the logic those pages compose. Recorded here so it
 *   is a decision someone can revisit rather than an omission nobody noticed.
 *
 *   THE FLOOR IS RE-SET AGAINST THE WIDER DENOMINATOR, at the measured figure
 *   with one to two points of headroom. My first pass put functions at 56
 *   against a real 56.06 — a gate a single new uncovered function turns red for
 *   no defect. A floor that flaps gets lowered by whoever it inconveniences,
 *   which is how #74's 70%-against-32% came about in the first place.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     src/app/api dropped from the denominator      KILLED
 *     src/services dropped                          KILLED
 *     the floor lowered to the old numbers          KILLED
 *     the floor raised above the measured figure    KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

/**
 * The config's own declarations, read from source.
 *
 * jest.config.js exports next/jest's wrapper, and CALLING it inside a test
 * throws — it loads next.config and mutates a frozen object
 * ("Cannot add property supportsImmutableAssets, object is not extensible").
 * So these read the literals the file declares, which is what the gate is
 * configured from either way.
 */
const CONFIG_SRC = readFileSync(join(ROOT, 'jest.config.js'), 'utf-8');

function coverageFromPatterns(): string[] {
    const block = CONFIG_SRC.match(/collectCoverageFrom:\s*\[([\s\S]*?)\n    \],/);
    if (!block) throw new Error('collectCoverageFrom not found in jest.config.js');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function floor(): Record<string, number> {
    const block = CONFIG_SRC.match(/coverageThreshold:\s*\{[\s\S]*?global:\s*\{([\s\S]*?)\n        \},/);
    if (!block) throw new Error('coverageThreshold.global not found in jest.config.js');
    const out: Record<string, number> = {};
    for (const m of block[1].matchAll(/(\w+):\s*([\d.]+),/g)) out[m[1]] = Number(m[2]);
    return out;
}

/**
 * Directories under src/ that hold executable source and are deliberately NOT
 * measured, each with the reason.
 */
const DELIBERATELY_OUT: Record<string, string> = {
    // Pages and layouts. See the header: including them forces the floor down
    // by ten to twenty-five points.
    app: 'partially measured — actions and api only; pages are excluded with their number recorded',
    // Types carry no executable statements to cover.
    types: 'type declarations only',
    // Maintenance scripts have their own gate: #328 brought them under tsc and
    // eslint, and #329 gave them a dry-run contract. Coverage of a script that
    // is run by hand against a database measures nothing useful.
    scripts: 'maintenance scripts, gated by #328/#329 instead',
};

function sourceDirsUnderSrc(): string[] {
    return readdirSync(join(ROOT, 'src'))
        .filter((name) => {
            // src/__tests__ and src/__mocks__ are the suite itself, not the app.
            if (name.startsWith('__')) return false;
            const p = join(ROOT, 'src', name);
            if (!statSync(p).isDirectory()) return false;
            return countSources(p) > 0;
        })
        .sort();
}

function countSources(dir: string): number {
    let n = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
            n += countSources(p);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            n += 1;
        }
    }
    return n;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#436 — the denominator', () => {
    it('INCLUDES src/app/api — the 121 files reachable from the internet', () => {
        expect(coverageFromPatterns()).toContain('src/app/api/**/*.ts');
    });

    it('and EVERY executable directory under src is measured or explained', () => {
        // Computed from the filesystem, not from the config. Reading the config
        // tells you what is in it; only this tells you what is missing — which
        // is how src/services, hooks, contexts and infrastructure were found
        // after src/app/api was.
        const patterns = coverageFromPatterns().filter((p) => !p.startsWith('!'));

        const unaccounted = sourceDirsUnderSrc().filter((dir) => {
            if (dir in DELIBERATELY_OUT) return false;
            return !patterns.some((p) => p.startsWith(`src/${dir}/`));
        });

        expect({ unaccounted }).toEqual({ unaccounted: [] });
    });

    it('and each deliberate exclusion carries a reason, not just a name', () => {
        for (const [dir, reason] of Object.entries(DELIBERATELY_OUT)) {
            expect({ dir, hasReason: reason.trim().length > 20 }).toEqual({ dir, hasReason: true });
        }
    });

    it('and the excluded page layer is named in the config where a reader meets it', () => {
        // The number that makes the exclusion a decision rather than an
        // oversight has to live beside the exclusion.
        const src = readFileSync(join(ROOT, 'jest.config.js'), 'utf-8');
        expect(src).toMatch(/PAGES ARE STILL OUT|Pages are still out/i);
        expect(src).toMatch(/43\.8%/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#436 — the floor', () => {
    /**
     * The figures this floor was set from, measured on the wider denominator.
     * If the suite improves, these move up; the point of pinning them is that
     * the floor must sit just BELOW the truth, never far below it and never
     * above.
     */
    const MEASURED = { statements: 60.62, branches: 50.72, functions: 56.06, lines: 61.48 };

    it('SITS BELOW THE MEASURED FIGURE — a gate that cannot pass is not a gate', () => {
        const f = floor();
        for (const key of Object.keys(MEASURED) as (keyof typeof MEASURED)[]) {
            expect({ key, belowTruth: f[key] <= MEASURED[key] }).toEqual({ key, belowTruth: true });
        }
    });

    it('and NOT FAR below it — within three points, so it actually ratchets', () => {
        // #74's defect was the opposite direction: 70% declared against 32%
        // real. This one guards the direction that makes a gate decorative.
        const f = floor();
        for (const key of Object.keys(MEASURED) as (keyof typeof MEASURED)[]) {
            const slack = Number((MEASURED[key] - f[key]).toFixed(2));
            expect({ key, withinThreePoints: slack <= 3 }).toEqual({ key, withinThreePoints: true });
        }
    });

    it('and is not so tight that one uncovered function turns CI red', () => {
        // My first pass set functions to 56 against a real 56.06.
        const f = floor();
        for (const key of Object.keys(MEASURED) as (keyof typeof MEASURED)[]) {
            const slack = Number((MEASURED[key] - f[key]).toFixed(2));
            expect({ key, hasHeadroom: slack >= 0.5 }).toEqual({ key, hasHeadroom: true });
        }
    });
});
