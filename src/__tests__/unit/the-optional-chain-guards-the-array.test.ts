/**
 * @jest-environment node
 */

/**
 *   #442 `X.field[0]?.y` GUARDS THE ELEMENT AND NOT THE ARRAY — AND THIS
 *   CODEBASE HAD ALREADY WRITTEN THAT SENTENCE DOWN, IN ONE FILE.
 *
 *   actions/marketplace/_buyer.ts carries it verbatim, from #130:
 *
 *       `product.pricingTiers[0]?.price` guards the ELEMENT and not the ARRAY,
 *       so a product stored without `pricingTiers` throws a TypeError here —
 *       inside the try, so the catch turns it into "Failed to fetch products"
 *       and the buyer sees an empty page rather than the other 299 products.
 *
 *   That file was fixed to `pricingTiers?.[0]?.price`. ELEVEN OTHER SITES KEPT
 *   THE DEFECT, and every one of them is in the RENDER layer, where the
 *   consequence is worse than the one #130 described. In an action the throw is
 *   caught and becomes an empty list; in a .tsx render it unwinds the route into
 *   the error boundary — which is exactly what #439 watched happen to the public
 *   property catalogue two findings ago.
 *
 *   WHERE THEY WERE
 *
 *     marketplace/checkout          SIX sites, including the subtotal reduce and
 *                                   the two places that build the order payload.
 *                                   One cart item stored without pricingTiers
 *                                   takes down checkout.
 *     marketplace/buyer/products    the price_low / price_high sort comparators.
 *                                   A comparator that throws takes the whole
 *                                   catalogue with it.
 *     marketplace/products/[id]     the related-products strip.
 *     marketplace/sell              the seller's own product list.
 *     academy/[courseId]            firstModule.lessons[0], in the Start
 *                                   Learning handler. Its guard checks
 *                                   `course.modules.length` and then indexes
 *                                   `lessons` without checking it.
 *
 *   TWO CANDIDATES WERE FALSE AND ARE NOT FIXED, WHICH IS WHY THEY ARE NAMED:
 *
 *     export/buyer's `product.grades[0]` — `grades` comes from a hardcoded
 *       array literal in that file, not from a document. Nothing can store it
 *       missing.
 *     `validation.error.issues[0]?.message` — zod guarantees `issues` is an
 *       array whenever `success === false`, which is the only branch that reads
 *       it. Fourteen sites, all safe.
 *
 *   AND ONE READING OF MINE WAS WRONG BEFORE I CHECKED IT. I thought
 *   `pricingTiers[0]?.price.toLocaleString()` had a SECOND hazard — an empty
 *   array giving `undefined.toLocaleString()`. It does not: `?.` short-circuits
 *   the whole chain, not just the next link. The only hazard is the missing
 *   array. Recorded because the fix would have looked identical either way and
 *   the reasoning would have been wrong.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     any one site reverted to field[0]?.        KILLED
 *     the allowlist emptied of its reasons       KILLED
 *     the scan stops looking at .tsx files       KILLED
 *     reword the header prose                    SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
            sourceFiles(p, out);
        } else if (/\.tsx?$/.test(name) && !/\.(d|test|spec)\.tsx?$/.test(name)) {
            out.push(relative(ROOT, p));
        }
    }
    return out;
}

const APP_SOURCES = [
    ...sourceFiles(join(ROOT, 'src/app')),
    ...sourceFiles(join(ROOT, 'src/components')),
    ...sourceFiles(join(ROOT, 'src/lib')),
    ...sourceFiles(join(ROOT, 'src/hooks')),
].sort();

/** `something.field[0]?.` — the index before the optional chain. */
const INDEX_BEFORE_CHAIN = /\.([A-Za-z_$][\w$]*)\[\s*\d+\s*\]\?\./g;

/**
 * Field names whose value is guaranteed to be an array by the thing that
 * produced it, so indexing before the optional chain cannot throw.
 *
 * Each needs a reason. The point of the list is that somebody has to know WHY a
 * particular array cannot be missing — "it always is in practice" is what #130
 * believed about pricingTiers.
 */
const ALWAYS_AN_ARRAY: Record<string, string> = {
    issues: 'zod: ZodError.issues is always an array, and it is only read on the success === false branch',
    docs: 'the adapter: a QuerySnapshot always carries a docs array, empty at worst',
    choices: 'the OpenAI response shape; the surrounding call is in a try that reports the failure',
    calls: 'jest: a mock always carries a calls array',
    results: 'jest/geocoder callbacks: the argument is an array or the branch is not taken',
};

function offendingSites(): string[] {
    const out: string[] = [];
    for (const rel of APP_SOURCES) {
        const src = stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
        for (const line of src.split('\n')) {
            for (const m of line.matchAll(INDEX_BEFORE_CHAIN)) {
                if (m[1] in ALWAYS_AN_ARRAY) continue;
                out.push(`${rel}: ${m[0]}`);
            }
        }
    }
    return [...new Set(out)].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#442 — the optional chain guards the array, not just the element', () => {
    it('NO SITE INDEXES BEFORE IT CHECKS', () => {
        // `X.field[0]?.y` throws when `field` is absent. `X.field?.[0]?.y` does
        // not. The difference is one character and, in a render, a whole page.
        expect({ offenders: offendingSites() }).toEqual({ offenders: [] });
    });

    it('and each allowlisted field says why its array cannot be missing', () => {
        for (const [field, reason] of Object.entries(ALWAYS_AN_ARRAY)) {
            expect({ field, explained: reason.trim().length > 25 }).toEqual({ field, explained: true });
        }
    });

    it('VACUITY GUARD: the scan really is reading the application', () => {
        // Without this, a bad path would report no offenders for the wrong
        // reason — the mistake this audit has made more than any other.
        expect(APP_SOURCES.length).toBeGreaterThan(600);
        const total = APP_SOURCES.reduce(
            (n, rel) => n + readFileSync(join(ROOT, rel), 'utf-8').length, 0);
        expect(total).toBeGreaterThan(1_000_000);
    });

    it('POSITIVE CONTROL: the pattern really does match the defect', () => {
        const sample = 'const price = item.pricingTiers[0]?.price || 0;';
        expect([...sample.matchAll(INDEX_BEFORE_CHAIN)].map((m) => m[1])).toEqual(['pricingTiers']);
    });

    it('NEGATIVE CONTROL: it does not match the fixed form', () => {
        const sample = 'const price = item.pricingTiers?.[0]?.price || 0;';
        expect([...sample.matchAll(INDEX_BEFORE_CHAIN)]).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#442 — the sites #130 knew about and the ones it missed', () => {
    const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

    /**
     * Every reader of pricingTiers. Pinned by file so that a new price display
     * copying an old one is visible here rather than in an error boundary.
     */
    const PRICE_READERS = [
        'src/app/actions/marketplace/_buyer.ts',
        'src/app/marketplace/buyer/products/page.tsx',
        'src/app/marketplace/checkout/page.tsx',
        'src/app/marketplace/products/[id]/page.tsx',
        'src/app/marketplace/sell/page.tsx',
    ];

    it('EVERY READER OF pricingTiers GUARDS THE ARRAY', () => {
        expect(PRICE_READERS.length).toBe(5);
        for (const rel of PRICE_READERS) {
            const src = code(rel);
            expect({ rel, unguarded: /pricingTiers\[\s*\d+\s*\]/.test(src) })
                .toEqual({ rel, unguarded: false });
        }
    });

    it('and the one file that already knew keeps its guard', () => {
        // #130 fixed this site and its comment is the reason #442 was findable
        // at all. A regression here would remove the record as well as the fix.
        expect(code('src/app/actions/marketplace/_buyer.ts'))
            .toMatch(/pricingTiers\?\.\[0\]\?\.price/);
    });

    it('and the academy Start Learning handler guards its lessons array', () => {
        // Its neighbour checks `course.modules.length` and then indexes
        // `lessons` without checking it — the same half-guard one level down.
        expect(code('src/app/academy/[courseId]/page.tsx'))
            .toMatch(/firstModule\?\.lessons\?\.\[0\]/);
    });
});
