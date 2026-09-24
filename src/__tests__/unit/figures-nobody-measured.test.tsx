/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "the analytics is returning mock data, why? how many places in
 *   the entire app for users and admin have mock data, i need them removed."
 *
 * ── THE ANALYTICS ITSELF IS REAL ────────────────────────────────────────────
 *
 *   Checked first, because the answer changes what to fix. admin/analytics
 *   goes through analytics.service, which reads the database and has been
 *   hardened three times in this audit (#517 a failed month drawn as a month
 *   with no sales, #699 the Paystack sweep, #905 the serial waves).
 *   marketplace/seller/analytics goes through _mp_seller_dashboard, which
 *   sums the seller's own orders. Neither invents anything.
 *
 *   WHAT WAS INVENTED WAS THE MARKETPLACE'S PUBLIC LANDING PAGE.
 *
 * ── FOUR TILES, FOUR CLAIMS, NOTHING MEASURED ───────────────────────────────
 *
 *       5,000+   Products Listed     `|| 5000` on a failed OR ZERO count
 *       12,000+  Active Traders      `|| 12000`, the same
 *       ₦2.5B+   Total Traded        a hardcoded string
 *       4.7/5    Seller Rating       a hardcoded string
 *
 *   The first two had a real reader behind them and overwrote it whenever it
 *   returned nothing — including when the honest answer was zero, because `||`
 *   cannot tell "no answer" from "none". The last two had no reader at all:
 *   nothing in this repository computes total value traded or an average
 *   seller rating for the platform, and nothing on that page asked for either.
 *
 *   A figure about money and a figure about sellers' service, announced to the
 *   public, both made up.
 *
 * ── AND A MINIMUM INVESTMENT THE WINDOW NEVER SET ───────────────────────────
 *
 *   _ex_investments.ts read `exportData?.amount || 50000`, commented "Default
 *   fallback". A window with no amount got a ₦50,000 minimum invented at the
 *   point of taking money, and the investor was told the window required it.
 *   It fails closed now, the same direction #346 chose for the settlement
 *   account.
 *
 * ── THE SCANNER ─────────────────────────────────────────────────────────────
 *
 *   A hand-written list of screens is exactly as reliable as the person
 *   writing it — the lesson seller-trust-badge.test.ts exists for. So the last
 *   block below sweeps every screen for a figure formatted like a claim
 *   (a currency amount with a magnitude suffix, or an "N/5" rating) written as
 *   a literal, and fails on a new one.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();

const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const code = (rel: string) =>
    source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');

const LANDING = 'src/app/marketplace/page.tsx';
const INVESTMENTS = 'src/app/actions/export/_ex_investments.ts';

describe('the marketplace landing page counts what it shows', () => {
    it('THE INVENTED PRODUCT AND TRADER COUNTS ARE GONE', () => {
        const src = code(LANDING);

        expect(src).not.toContain('5000');
        expect(src).not.toContain('12000');
        //   Specifically the `||` shape, which is what turned a real zero into
        //   a five-thousand.
        expect(src).not.toMatch(/productsCount \|\|/);
        expect(src).not.toMatch(/tradersCount \|\|/);
    });

    it('AND THE TWO TILES WITH NO READER AT ALL ARE GONE', () => {
        const src = code(LANDING);

        expect(src).not.toContain('₦2.5B');
        expect(src).not.toContain('4.7/5');
        expect(src).not.toContain('Total Traded');
    });

    it('a failed read shows NO tile rather than a made-up one', () => {
        //   `stats` is null until the action answers, and the tiles render
        //   behind it. Printing zeroes instead would be a different claim, not
        //   an absence.
        const src = code(LANDING);

        expect(src).toMatch(/let stats: \{[^}]*\} \| null = null;/);
        expect(src).toContain('{stats && (');
    });

    it('and the two that remain come from the action (control)', () => {
        //   Vacuity guard: deleting the whole row would pass everything above.
        const src = code(LANDING);

        expect(src).toContain('getMarketplaceStatsAction()');
        expect(src).toContain('stats.productsCount.toLocaleString()');
        expect(src).toContain('stats.tradersCount.toLocaleString()');
    });

    it('and the seller tile says what the query actually counted', () => {
        //   The count is `sellerVerificationStatus == "approved"`, which is
        //   verified sellers — not "active traders", which nothing measures.
        expect(code(LANDING)).toContain('Verified Sellers');
        expect(code(LANDING)).not.toContain('Active Traders');
    });
});

describe('an export window states its own minimum', () => {
    it('THE ₦50,000 FALLBACK IS GONE', () => {
        const src = code(INVESTMENTS);

        expect(src).not.toContain('|| 50000');
        expect(src).not.toMatch(/amount \|\| 5000/);
    });

    it('and a window without one is REFUSED, not given a number', () => {
        const src = code(INVESTMENTS);

        expect(src).toMatch(/const statedMinimum = Number\(exportData\?\.amount\);/);
        expect(src).toMatch(/!Number\.isFinite\(statedMinimum\) \|\| statedMinimum <= 0/);
        //   Fails closed, and says so to the investor and to the log.
        expect(src).toMatch(/has not set a minimum investment yet/);
        expect(src).toMatch(/window has no minimum investment set/);
    });

    it('the real minimum is still enforced when there is one (control)', () => {
        expect(code(INVESTMENTS)).toContain('isAmountAtLeast(amount, statedMinimum)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the home page stopped counting up to a number it made up', () => {
    it('PlatformStats IS DELETED, not quietly emptied', () => {
        //   "Our Growing Community": four counters that ANIMATED over two
        //   seconds — 15,420 users, 1,247 exports, 3,856 products, 8,932
        //   courses — from a literal array, with no fetch anywhere in the
        //   component, under a badge reading "Growing 25% month-over-month".
        //   The animation was the only real thing about them.
        expect(existsSync(join(ROOT, 'src/components/hub/PlatformStats.tsx'))).toBe(false);
        expect(code('src/app/page.tsx')).not.toContain('<PlatformStats');
        expect(code('src/app/page.tsx')).not.toContain('hub/PlatformStats');
    });

    it('and the four literal tiles are gone from both public pages', () => {
        for (const rel of ['src/app/page.tsx', 'src/app/about/page.tsx']) {
            const src = code(rel);
            expect(src).not.toContain('15,420+');
            expect(src).not.toContain('₦2.5B+');
            expect(src).not.toContain('Total Exports');
            expect(src).not.toContain('Success Rate');
        }
    });

    it('and nothing claims a growth rate nobody computed', () => {
        //   The badge under the counters. A rate is the easiest of all these
        //   to state and the hardest to substantiate.
        for (const rel of ['src/app/page.tsx', 'src/app/about/page.tsx']) {
            expect(code(rel)).not.toMatch(/month-over-month/);
        }
    });

    it('the pages still render their real content (control)', () => {
        //   Vacuity guard: deleting the files would pass everything above.
        expect(code('src/app/page.tsx')).toContain('About Us');
        expect(code('src/app/about/page.tsx')).toContain('Easy Sales Export');
    });
});

describe('no screen states a figure nobody measured', () => {
    /** Every .tsx under src/app, which is every screen. */
    function screens(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (!full.includes('__tests__')) screens(full, out);
            } else if (full.endsWith('.tsx')) {
                out.push(full);
            }
        }
        return out;
    }

    const ALL = screens(join(ROOT, 'src/app'));

    it('finds screens to check (sanity)', () => {
        //   Every assertion below is a filter over this list; an empty one
        //   passes vacuously.
        expect(ALL.length).toBeGreaterThan(100);
    });

    it('NO HARDCODED STATISTIC TILE — ₦2.5B+ and 15,420+ were these', () => {
        /*
         *   THE SHAPE, not every currency literal. A stat tile is a big bold
         *   number that IS the element's whole text, with a label under it —
         *   which is what all eight removed tiles were.
         *
         *   Deliberately NOT caught, because neither is a measurement:
         *
         *     ·  a PROGRAMME TERM in a sentence — "access to ₦1M capital,
         *        ₦20M+ growth in 5 years" on the WAVE briefing. That is what
         *        the programme offers, stated as prose, and it is the owner's
         *        to state.
         *     ·  a FILTER BAND — "₦20M – ₦50M" in the Farm Nation property
         *        filters and budget bands. A choice, not a claim.
         *
         *   A figure rendered from a variable reads `{value}` and never
         *   matches.
         */
        const TILE = /className="[^"]*text-(?:2xl|3xl|4xl|5xl)[^"]*font-bold[^"]*"\s*>\s*(₦?[0-9][0-9,.]*\s*[%+KMB]?\+?)\s*</g;
        const offenders: string[] = [];

        for (const file of ALL) {
            const src = readFileSync(file, 'utf-8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .filter((l) => !l.trim().startsWith('//'))
                .join('\n');

            for (const m of src.matchAll(TILE)) {
                const value = m[1].trim();
                //   A bare small integer is a step number, not a statistic —
                //   ExportLandingClient numbers its four steps this way.
                if (/^[0-9]$/.test(value)) continue;
                offenders.push(`${relative(ROOT, file)} — ${value}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('AND NO HARDCODED RATING — 4.7/5 was the other', () => {
        const offenders: string[] = [];

        for (const file of ALL) {
            const src = readFileSync(file, 'utf-8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .filter((l) => !l.trim().startsWith('//'))
                .join('\n');

            //   `4.7/5` in JSX text. A rating rendered from a variable reads
            //   `{rating}/5` and does not match.
            for (const m of src.matchAll(/>\s*\d\.\d\s?\/\s?5\s*</g)) {
                offenders.push(`${relative(ROOT, file)} — ${m[0].trim()}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('THE SCANNER CAN SEE ONE — the positive control', () => {
        //   Both sweeps above assert an empty list, which is what a broken
        //   scanner also produces. These are the two strings that were on the
        //   landing page, run through the same patterns.
        const TILE = /className="[^"]*text-(?:2xl|3xl|4xl|5xl)[^"]*font-bold[^"]*"\s*>\s*(₦?[0-9][0-9,.]*\s*[%+KMB]?\+?)\s*</;
        expect('<div className="text-4xl font-bold text-primary mb-2">₦2.5B+</div>').toMatch(TILE);
        expect('<div className="text-4xl font-bold text-primary mb-2">15,420+</div>').toMatch(TILE);
        expect('<div className="text-4xl font-bold text-primary mb-2">98%</div>').toMatch(TILE);
        expect('<div>4.7/5</div>').toMatch(/>\s*\d\.\d\s?\/\s?5\s*</);
    });
});
