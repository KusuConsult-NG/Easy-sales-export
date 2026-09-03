/**
 * @jest-environment node
 */

/**
 *   #347 A MALFORMED VALUE IN localStorage TOOK DOWN THREE SCREENS,
 *        INCLUDING THE DASHBOARD AND THE CHECKOUT.
 *
 *        Three components read browser storage and parsed it without a usable
 *        guard. In a "use client" effect a throw is not a missing feature — it
 *        unmounts the tree to the nearest error boundary, so the member sees
 *        the error page instead of the screen, on every visit, until they
 *        clear site data.
 *
 *          AnnouncementBanner        /dashboard, the screen every signed-in
 *                                    member lands on:
 *                                      const stored = localStorage.getItem(...);
 *                                      if (stored) setDismissed(new Set(JSON.parse(stored)));
 *                                    Three throws in one statement — localStorage
 *                                    itself (Safari private browsing, blocked
 *                                    site data), JSON.parse, and `new Set(5)`
 *                                    on a value that parsed perfectly well.
 *                                    All to remember which banners were
 *                                    dismissed.
 *
 *          marketplace/checkout      the same unguarded parse, on the buyer's
 *                                    cart. The guest-cart migration TWELVE
 *                                    LINES ABOVE is wrapped in a try/catch and
 *                                    checks Array.isArray — the author knew,
 *                                    and the guard went on the less important
 *                                    half.
 *
 *          ExportCartContext         had a try/catch that CAUGHT NOTHING:
 *                                      setTimeout(() => setCart(JSON.parse(saved)), 0)
 *                                    The parse was deferred into a timer
 *                                    callback, which runs on a later tick with
 *                                    an empty stack, outside the try. The guard
 *                                    read as present and did nothing.
 *
 *        THE COMMON ERROR is treating a value that came out of the browser as
 *        trusted input. It is not: it survives across sessions, can be edited,
 *        truncated by a quota failure, or written by an older version of the
 *        code. Each of these three stores a CONVENIENCE — which banners were
 *        dismissed, what was in a cart — so the honest fallback in every case
 *        is "nothing", which each screen already handles.
 *
 *        Three sibling reads were checked and are genuinely guarded:
 *        cooperatives/onboarding, marketplace/products/[id] and
 *        village-market/[id]. The ratchet at the bottom keeps them that way.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const BANNER = 'src/components/AnnouncementBanner.tsx';
const CHECKOUT = 'src/app/marketplace/checkout/page.tsx';
const EXPORT_CART = 'src/contexts/ExportCartContext.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#347 — the dashboard banner survives anything in storage', () => {
    const code = source(BANNER);

    it('THE READ IS INSIDE A try', () => {
        // THE test. This component renders on /dashboard.
        expect(code).toMatch(/try \{[\s\S]{0,200}?localStorage\.getItem\("dismissed_announcements"\)/);
    });

    it('and a value that is not an ARRAY never reaches new Set()', () => {
        // `"5"` is valid JSON, and `new Set(5)` is a TypeError. Parsing
        // successfully is not the same as being usable.
        expect(code).toContain('Array.isArray(parsed)');
        expect(code).not.toMatch(/new Set\(JSON\.parse\(/);
    });

    it('the bad value is dropped, so the next visit is clean', () => {
        expect(code).toContain('localStorage.removeItem("dismissed_announcements")');
    });

    it('and the WRITE is guarded too — a blocked store or a full quota', () => {
        expect(code).toMatch(/try \{[\s\S]{0,200}?localStorage\.setItem\("dismissed_announcements"/);
    });

    it('it is still rendered on the dashboard, so this is not academic', () => {
        expect(source('src/app/dashboard/page.tsx')).toContain('<AnnouncementBanner />');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#347 — the checkout page survives its own cart', () => {
    const code = source(CHECKOUT);

    it('THE CART READ IS GUARDED, AND THE SHAPE IS CHECKED', () => {
        expect(code).toMatch(/try \{[\s\S]{0,200}?JSON\.parse\(savedCart\)/);
        expect(code).toContain('Array.isArray(parsedCart)');
    });

    it('and an unreadable cart sends the buyer back rather than crashing', () => {
        // The fallback the page already had for an EMPTY cart, now reached by
        // an unreadable one as well.
        expect(code).toMatch(/Array\.isArray\(parsedCart\)[\s\S]{0,400}?router\.push\("\/marketplace"\)/);
    });

    it('estimateCartWeight is only called on a real array', () => {
        // The second throw: it iterates its argument.
        expect(code).toMatch(/if \(Array\.isArray\(parsedCart\)[\s\S]{0,160}?estimateCartWeight\(parsedCart\)/);
    });

    it('and the guest-cart migration’s own storage calls are guarded', () => {
        // getItem/removeItem sat outside the try that wrapped the parse.
        expect(code).toMatch(/try \{ guestCart = localStorage\.getItem\("marketplace_cart"\); \}/);
        expect(code).toMatch(/try \{ localStorage\.removeItem\("marketplace_cart"\); \}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#347 — the export cart’s guard now covers the parse', () => {
    const code = source(EXPORT_CART);

    it('THE PARSE HAPPENS BEFORE THE setTimeout, NOT INSIDE IT', () => {
        // THE test. A try/catch cannot catch a throw on a later tick.
        expect(code).not.toMatch(/setTimeout\(\(\) => setCart\(JSON\.parse\(/);
        expect(code).toMatch(/const parsed = JSON\.parse\(saved\);/);
        expect(code).toContain('setTimeout(() => setCart(parsed), 0)');
    });

    it('and only a real array is restored', () => {
        expect(code).toContain('Array.isArray(parsed)');
    });

    it('the try still covers the getItem it always covered', () => {
        // Vacuity guard: the fix must not have narrowed the guard.
        expect(code).toMatch(/try \{[\s\S]{0,120}?localStorage\.getItem\(STORAGE_KEY\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#347 — the ratchet: no browser-storage parse is left unguarded', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/\.tsx?$/.test(full)) out.push(full);
        }
        return out;
    }

    const files = walk(join(process.cwd(), 'src'))
        .map((f) => f.slice(process.cwd().length + 1))
        .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

    it('finds the app files, so this is not vacuous', () => {
        expect(files.length).toBeGreaterThan(200);
    });

    it('EVERY JSON.parse OF A STORAGE VALUE SITS INSIDE A try', () => {
        // Derived, because three of six reads had this and the differences
        // between them were accidental. A parse of a browser-supplied string
        // outside a try is the shape, wherever it appears next.
        const offenders: string[] = [];

        for (const f of files) {
            const code = stripComments(readFileSync(join(process.cwd(), f), 'utf-8'));
            const lines = code.split('\n');

            lines.forEach((line, i) => {
                if (!/JSON\.parse\(/.test(line)) return;

                // Is this parse operating on something that came out of
                // storage? Either directly, or via a variable assigned from
                // getItem within the preceding 12 lines.
                const direct = /JSON\.parse\((local|session)Storage\.getItem/.test(line);
                const window = lines.slice(Math.max(0, i - 12), i).join('\n');
                const named = /JSON\.parse\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(line);
                const viaVar = Boolean(named
                    && new RegExp(`\\b${named[1]}\\b[^\\n]*(local|session)Storage\\.getItem`).test(window));

                if (!direct && !viaVar) return;

                // A `try {` in the preceding 12 lines with no intervening
                // `catch`/`}` closing it is the guard we require.
                const guardWindow = lines.slice(Math.max(0, i - 12), i).join('\n');
                const lastTry = guardWindow.lastIndexOf('try {');
                const closed = lastTry >= 0 && /\bcatch\b/.test(guardWindow.slice(lastTry));
                if (lastTry >= 0 && !closed) return;

                offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
            });
        }

        // Was: AnnouncementBanner.tsx, marketplace/checkout/page.tsx and
        // ExportCartContext.tsx (whose try did not cover its parse).
        expect(offenders).toEqual([]);
    });
});
