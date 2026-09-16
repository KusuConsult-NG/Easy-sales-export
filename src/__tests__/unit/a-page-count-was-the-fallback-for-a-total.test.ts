/**
 * @jest-environment node
 */

/**
 *   #830 A PAGE COUNT WAS THE FALLBACK FOR A PLATFORM TOTAL, ON TWO MORE CARDS.
 *
 *   The owner: "ensure that all data reflecting for all modules … renders the
 *   correct numbers for all the cards", and then named the two screens still
 *   outstanding — Farm Nation land verification, and the marketplace
 *   buyer/seller cards.
 *
 *   #822 swept this shape across the admin surface and fixed the MAIN paths.
 *   Both of these screens kept it in their FALLBACK:
 *
 *       const stats = meta?.stats || {
 *           total: users.length,                      ← the PAGE
 *           buyerOnly: users.filter(…).length,
 *           …
 *       };
 *
 *   `users` and `verifications` are the rows currently on screen — twenty, or
 *   fifty. So whenever the real stats were missing, these cards silently became
 *   a tally of one page and presented it as the size of the platform.
 *
 *   THE LAND SCREEN'S OWN COMMENT SAID "fall back to local page counts WHILE
 *   LOADING", and that is half true. The fallback also fires when both reads
 *   FAIL, and then it never clears — a broken stats endpoint shows a page count
 *   as the platform total indefinitely, and says nothing. Both halves of #822
 *   in one line: a page is not a total, and a failed read is not a zero.
 *
 *   A correct rule applied to some of the places it names — this time to the
 *   main path of a screen and not to its fallback, which is the same file.
 *
 * ── WHAT THE CARDS SHOW NOW ─────────────────────────────────────────────────
 *
 *       COUNTED     the database answered        "1,284"
 *       NOT YET     the read has not come back   "—"
 *       UNREADABLE  it failed                    "Unavailable"
 *
 *   lib/admin-stat-display makes that choice once, and a page count is none of
 *   the three.
 *
 *   AND THE NUMBERS THEMSELVES ARE REAL. The land action runs `.count()`
 *   aggregates; the marketplace action computes over the whole fetched cohort
 *   BEFORE the role filter and before paging. Neither was wrong on its happy
 *   path — which is exactly why the fallback went unnoticed.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the page-count fallback restored on either screen             KILLED
 *     the OBJECT guarded instead of each field                      KILLED
 *     statText replaced by String(value)                            KILLED
 *     the failure flag dropped, so a failed read reads "—"          KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { statText } from '@/lib/admin-stat-display';

const ROOT = process.cwd();

/**
 * Stripped — the comments recording this finding quote the very expression
 * they replaced, which is the #741 trap this suite would otherwise fail on.
 */
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const SCREENS = [
    ['the marketplace buyers/sellers cards', 'src/app/admin/marketplace/buyers/page.tsx'],
    ['the Farm Nation land verification cards', 'src/app/admin/farm-nation/land-verification/page.tsx'],
] as const;

describe('#830 — no card falls back to counting the page', () => {
    it.each(SCREENS)('%s no longer tallies the rows on screen', (_label, file) => {
        const src = code(file);

        /*
         *   THE PROPERTY, not the spelling: no stats object may be built from
         *   `.length` or `.filter(...).length` over the paged array. Both
         *   screens named their array differently, so this checks the shape
         *   rather than a variable.
         */
        expect(src).not.toMatch(/stats\s*=\s*[^;]*\|\|\s*\{[\s\S]{0,400}?\.length/);
        expect(src).not.toMatch(/total:\s*(?:users|verifications)\.length/);
    });

    it.each(SCREENS)('%s asks lib/admin-stat-display instead', (_label, file) => {
        const src = code(file);

        expect(src).toContain('statText');
        //   Used on the CARDS, not merely imported — #822 recorded a mutant
        //   surviving because a constant stayed imported while the expression
        //   using it was replaced.
        expect(src).toMatch(/value:\s*statText\(/);
    });

    it.each(SCREENS)('%s reads the field optionally', (_label, file) => {
        /*
         *   #822's trap was `stats ? stats.pending.toLocaleString() : "—"` — a
         *   partial payload is TRUTHY, so the guard passes and the `.toLocale`
         *   on undefined throws, taking the whole admin screen down.
         *
         *   RECORDED HONESTLY: a mutant replacing `stats?.total` with
         *   `stats ? stats.total : undefined` SURVIVES, and it should. statText
         *   accepts undefined and answers "—", so the two spellings are
         *   indistinguishable now — the danger #822 found lived in the
         *   `.toLocaleString()`, which is inside the helper and no longer at
         *   the call site. This asserts the shape that is easy to keep right;
         *   the behaviour it protects is executed in the describe below.
         */
        const src = code(file);

        expect(src).toMatch(/statText\(stats\?\./);
        expect(src).not.toMatch(/statText\(stats\.[a-zA-Z]/);
    });

    it.each(SCREENS)('%s distinguishes "not yet" from "could not" ON EVERY CARD', (_label, file) => {
        /*
         *   EVERY card, and the first draft did not say so. It asserted that
         *   `statText(…, Boolean(fetchError))` appeared SOMEWHERE in the file,
         *   and mutation killed it: dropping the flag from ONE call left the
         *   others matching and this suite green. That is the trap this audit
         *   has met more than any other — an assertion satisfied by the wrong
         *   occurrence — and the remedy is to count rather than to find.
         *
         *   Without the flag a broken endpoint renders the same dash as a slow
         *   one, which is the confusion #786 is about.
         */
        const src = code(file);

        const calls = [...src.matchAll(/statText\([^)]*\)/g)].map((m) => m[0]);
        expect(calls.length).toBeGreaterThanOrEqual(4);

        const unflagged = calls.filter((c) => !/Boolean\(fetchError\)/.test(c));
        expect({ file, unflagged }).toEqual({ file, unflagged: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#830 — and the three states are what they claim to be', () => {
    /*
     *   Executed rather than asserted about source. The assertions above are
     *   structural by necessity — these are React pages with a dozen
     *   dependencies each — so the DECISION they delegate to is exercised here
     *   directly, which is where the behaviour actually lives.
     */
    it('A REAL COUNT IS FORMATTED, INCLUDING ZERO', () => {
        expect(statText(1284)).toBe('1,284');
        //   Zero is a real answer when the database gave it. The defect is
        //   inventing zero, not reporting one.
        expect(statText(0)).toBe('0');
    });

    it('A MISSING FIGURE IS A DASH, NOT A NUMBER', () => {
        expect(statText(undefined)).toBe('—');
        expect(statText(null)).toBe('—');
    });

    it('AND A FAILED READ SAYS SO', () => {
        expect(statText(undefined, true)).toBe('Unavailable');
        expect(statText(null, true)).toBe('Unavailable');
    });

    it('CONTROL: A COUNT THAT ARRIVED IS SHOWN EVEN IF SOMETHING ELSE FAILED', () => {
        //   The flag must not suppress a number the database actually gave,
        //   or one failing panel would blank the others — the mistake #822
        //   made in its first shipments change.
        expect(statText(42, true)).toBe('42');
    });

    it('CONTROL: A NON-NUMBER IS NEVER PRINTED AS ONE', () => {
        //   NaN is the shape a page count arrives as when the array is absent,
        //   and "NaN" on an admin card is worse than a dash.
        expect(statText(Number.NaN)).toBe('—');
        expect(statText('12' as unknown)).toBe('—');
    });
});
