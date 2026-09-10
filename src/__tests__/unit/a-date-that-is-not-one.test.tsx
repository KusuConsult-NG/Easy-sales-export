/**
 * @jest-environment jsdom
 */

/**
 *   #597 SEVEN COPIES OF "FORMAT A DATE", NONE OF WHICH SURVIVED A DATE THAT
 *        WAS NOT ONE — AND THREE MORE SCREENS THAT DIED ON A BARE ROW.
 *
 *   #596 raised #589's floor from four screens to twenty-two by rendering each
 *   with a document carrying only an id, and seven of nineteen threw. This does
 *   the same for twenty-two more, and FOUR threw:
 *
 *     cooperatives/withdrawals   RangeError: Invalid time value
 *     export/opportunities       window.slotPrice.toLocaleString()
 *     marketplace/seller/analytics  stats.averageRating.toFixed(1)
 *     farm-nation/dashboard      stats.recentListings.length
 *
 * ── THE DATE ONE IS A CLASS, AND IT IS THE INTERESTING ONE ──────────────────
 *
 *   `Intl.DateTimeFormat.prototype.format` THROWS a RangeError on an Invalid
 *   Date. It does not return "Invalid Date" the way `Date.prototype.toString`
 *   does, which is why this reads as harmless and is not.
 *
 *   Ten member-facing screens built one by hand, in seven local helpers:
 *
 *     four guard `if (!val) return "—"`  — undefined, and nothing else. A
 *                                         stored `""`, a malformed ISO string
 *                                         or a `{_seconds}` shape that lost its
 *                                         methods crossing the server boundary
 *                                         all still throw.
 *     three guard nothing at all        — /cooperatives/withdrawals,
 *                                         /cooperatives/my-savings and
 *                                         /cooperatives/my-loans each declare
 *                                         `formatDate(date: Date)` and are handed
 *                                         whatever the document held. A
 *                                         TypeScript annotation is not a runtime
 *                                         check on JSON.
 *     one guards nothing and is inline  — /dashboard formats `event.date`
 *                                         directly in the JSX.
 *
 *   And `toDateOrNull` — which already knew how to read a Firestore Timestamp,
 *   a `_seconds` shape, an ISO string and a number — had been sitting in
 *   lib/date-utils the whole time. #439's lesson again: a rule stated by hand at
 *   every call site is a rule applied at most of them.
 *
 *   NOT `toDate`, WHICH THE OBVIOUS FIX WOULD HAVE USED. It falls back to
 *   `new Date()`, so a missing date renders as TODAY — a quieter lie than a
 *   crash, and still a lie on a withdrawal request or a loan maturity date.
 *   `formatDateOrDash` returns a dash.
 *
 * ── AND THREE NUMBERS ───────────────────────────────────────────────────────
 *
 *   `/export/opportunities` is the screen a member browses to decide where to
 *   put money, and it read `window.slotPrice`, `window.currentVolume` and
 *   `window.targetVolume` straight off each document inside a `.map`. One
 *   window missing any of the three took the LIST down, not its own card.
 *
 *   `/marketplace/seller/analytics` is a different fault with the same effect:
 *   `setStats({ ...defaults, ...analyticsData })` spread a THREE-KEY defaults
 *   object, not the nine-key shape the state was initialised with, so a server
 *   answer missing `averageRating` left the state without it and
 *   `stats.averageRating.toFixed(1)` threw. The full shape is named once now
 *   and used in both places.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   THE CRASHES ARE LATENT — none of them is firing on today's data, and every
 *   one of them was found by rendering rather than by reading. They are fixed on
 *   #589's escrow-id reasoning: the consequence is total and silent, a blank
 *   page rather than a blank field, and the fix costs nothing.
 *
 *   NO READER, ROUTE OR DOCUMENT WAS TOUCHED. Every fix is on the screen or in
 *   a shared lib, and every field that was drawn is still drawn.
 *
 *   `numberOrZero` REPLACES NOTHING THAT WAS WORKING. The three private copies
 *   it consolidates — `counter` in export-window-funding, `positiveNumber` in
 *   export-catalog-reader, and `Number(x) || 0` by hand — are left where they
 *   are in this commit; the new module is the one place for the NEXT one, and
 *   that is stated rather than implied.
 *
 *   THE FLOOR IS FORTY-FOUR SCREENS — #589's four, #596's nineteen and these
 *   twenty-two, with /export/(app)/products counted once in both lists. That is
 *   what has been PROVEN, never what is safe.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { formatDateOrDash, formatDateTimeOrDash } from '@/lib/date-utils';
import { numberOrZero, firstNumber, numberOrDash } from '@/lib/numbers';

const ROOT = process.cwd();

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({ id: 'x', propertyId: 'x', courseId: 'x', certificateId: 'x', moduleId: 'x' }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', roles: [] } }, status: 'authenticated' }),
    signOut: jest.fn(),
}));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));
jest.mock('@/hooks/useMembershipStatus', () => ({ useMembershipStatus: () => ({ status: 'approved', loading: false }) }));

//   Every server read answers "nothing", so the SEED is the only data these
//   screens have and the bare row is what actually gets rendered.
const empty = async () => ({ success: true, error: null, data: null });
for (const m of ['marketplace', 'cooperative', 'reviews', 'wave', 'my-data', 'village-market', 'health',
    'messages', 'land-listings', 'farm-nation', 'export-products', 'export', 'export-booking', 'academy',
    'export-investments', 'export-payment', 'saved-items', 'orders', 'order-management', 'loan-actions',
    'loan-products', 'disputes', 'land-actions', 'profile', 'user', 'wallet', 'course-actions',
    'certificates', 'notifications', 'feature-toggles', 'payments', 'kyc']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({}, { get: () => empty }));
}

const ROW = { id: 'x' };
const ok = (data: any) => ({ success: true, error: null, data });

/**
 * THE FLOOR, RAISED AGAIN. #589 named four, #596 nineteen, these are the last
 * twenty-two. Each is a screen rendered with a document carrying an id and
 * nothing else, and watched not to throw.
 */
const BARE_ROW_SUBJECTS: [string, string, any][] = [
    //   The four that threw.
    ['cooperatives/withdrawals', '@/app/cooperatives/(member)/withdrawals/WithdrawalsClient', { initial: [ROW] }],
    ['export/opportunities', '@/app/export/(app)/opportunities/ExportOpportunitiesClient', { initial: ok([ROW]) }],
    ['marketplace/seller/analytics', '@/app/marketplace/seller/analytics/SellerAnalyticsClient', { initial: ok({ analytics: {} }) }],
    ['farm-nation/dashboard', '@/app/farm-nation/(member)/dashboard/FarmNationDashboardClient', { initial: ROW }],
    //   And the eighteen that already survived.
    ['marketplace/products', '@/app/marketplace/products/MarketplaceProductsClient', { initial: ok({ products: [ROW] }) }],
    ['marketplace/products/[id]', '@/app/marketplace/products/[id]/ProductDetailClient', { initial: { productRes: ok({ product: ROW }), relatedRes: ok({ products: [ROW] }) } }],
    ['marketplace/buyer/products', '@/app/marketplace/buyer/products/BuyerProductsClient', { initial: { productsRes: ok({ products: [ROW] }), flashRes: ok([]) } }],
    ['marketplace/buyer/quotes', '@/app/marketplace/buyer/quotes/BuyerQuotesClient', { initial: [ROW] }],
    ['marketplace/seller/quotes', '@/app/marketplace/seller/quotes/SellerQuotesClient', { initial: [ROW] }],
    ['marketplace/buyer/saved', '@/app/marketplace/buyer/saved/SavedSellersClient', { initial: [ROW] }],
    ['marketplace/sell', '@/app/marketplace/sell/SellerHomeClient', { initial: { productsRes: ok({ products: [ROW] }), verificationRes: ok(null) } }],
    ['escrow/[id]', '@/app/escrow/[id]/EscrowDetailClient', { initial: ROW }],
    ['cooperatives/dashboard', '@/app/cooperatives/(member)/dashboard/CooperativeDashboardClient', { initial: { membership: ROW, transactions: [ROW] } }],
    ['cooperatives/loans', '@/app/cooperatives/(member)/loans/LoansClient', { initial: { membership: { isMember: true, status: 'approved' }, products: [ROW], applications: [ROW] } }],
    ['cooperatives/my-loans', '@/app/cooperatives/(member)/my-loans/MyLoansClient', { initial: { membershipRes: ok({ membership: ROW }), loanApplications: [ROW] } }],
    ['export/transactions', '@/app/export/(app)/transactions/ExportTransactionsClient', { initial: ok([ROW]) }],
    ['export/investments/[id]', '@/app/export/(app)/investments/[id]/InvestmentDetailClient', { initial: ok([ROW]) }],
    ['farm-nation/inquiries', '@/app/farm-nation/(member)/inquiries/InquiriesClient', { initial: [ROW] }],
    ['farm-nation/property/[id]', '@/app/farm-nation/property/[id]/PropertyDetailsClient', { initial: ROW }],
    ['farm-nation/saved', '@/app/farm-nation/saved/SavedPropertiesClient', { initial: [ROW] }],
    ['academy/my-courses', '@/app/academy/(learner)/my-courses/MyCoursesClient', { initial: [ROW] }],
    ['academy/progress', '@/app/academy/(learner)/progress/ProgressClient', { initial: { aggResult: ok({}), streakResult: ok({}) } }],
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#597 — one reading of a stored date', () => {
    it('A DATE THAT DOES NOT PARSE IS A DASH, NOT A RangeError', () => {
        /**
         *   THE defect, in one line. `Intl.DateTimeFormat.format` THROWS on an
         *   Invalid Date, and the whole screen goes with it.
         */
        for (const value of [undefined, null, '', '   ', 'not a date', {}, [], NaN, 'yesterday']) {
            expect({ value, out: formatDateOrDash(value) }).toEqual({ value, out: '—' });
        }
        //   And the naked version really would throw, which is what makes the
        //   line above a claim rather than a decoration.
        expect(() => new Intl.DateTimeFormat('en-NG').format(new Date('not a date'))).toThrow();
    });

    it('AND A DATE THAT DOES PARSE IS FORMATTED, IN EVERY SHAPE THIS APP STORES', () => {
        const iso = '2026-03-04T10:30:00.000Z';
        expect(formatDateOrDash(iso)).toMatch(/2026/);
        //   A Firestore Timestamp, client-side.
        expect(formatDateOrDash({ seconds: Date.parse(iso) / 1000 })).toMatch(/2026/);
        //   And the `_seconds` shape a Timestamp becomes when it loses its
        //   methods crossing the server boundary — the one four of the seven
        //   hand-written copies could not read at all.
        expect(formatDateOrDash({ _seconds: Date.parse(iso) / 1000 })).toMatch(/2026/);
        expect(formatDateOrDash(new Date(iso))).toMatch(/2026/);
        expect(formatDateOrDash(Date.parse(iso))).toMatch(/2026/);
        expect(formatDateTimeOrDash(iso)).toMatch(/2026|Mar/);
    });

    it('AND A MISSING DATE IS NOT RENDERED AS TODAY', () => {
        /**
         *   The obvious fix was `toDate`, which falls back to `new Date()`. That
         *   turns a crash into a quieter lie: a withdrawal with no requested-at
         *   date would say it was requested today, and a loan with no maturity
         *   would say it matures today.
         */
        const today = new Intl.DateTimeFormat('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })
            .format(new Date());
        expect(formatDateOrDash(undefined)).not.toBe(today);
        expect(formatDateOrDash(null)).toBe('—');
    });

    it('AND A FORMATTER THAT CANNOT BE BUILT IS A DASH TOO', () => {
        /**
         *   A SURVIVING MUTANT IS WHY THIS TEST EXISTS. Removing the try/catch
         *   changed nothing, because a VALID Date never makes `.format` throw —
         *   so the catch was covering the other way in: `Intl.DateTimeFormat`
         *   itself throws a RangeError on an options object it cannot honour,
         *   at CONSTRUCTION, before any date is involved. Untested is untested,
         *   whichever half of the try it is.
         */
        expect(() => new Intl.DateTimeFormat('en-NG', { year: 'bogus' } as any)).toThrow();
        expect(formatDateOrDash('2026-03-04T10:30:00.000Z', { year: 'bogus' } as any)).toBe('—');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#597 — one reading of a stored number', () => {
    it('AN ABSENT FIGURE IS ZERO, NOT A TypeError', () => {
        for (const value of [undefined, null, 'abc', {}, NaN, Infinity]) {
            expect({ value, out: numberOrZero(value) }).toEqual({ value, out: 0 });
        }
        expect(numberOrZero(0)).toBe(0);
        expect(numberOrZero('1500')).toBe(1500);
        expect(numberOrZero(-4)).toBe(-4);
        //   A SURVIVING MUTANT IS WHY THESE TWO LINES EXIST. Dropping the
        //   null/undefined guard is invisible at the default fallback, because
        //   `Number(null)` is 0 and `Number(undefined)` is NaN which the finite
        //   check catches anyway. It is only visible when a caller asks for a
        //   fallback that is not zero — which is what the parameter is for.
        expect(numberOrZero(undefined, 5)).toBe(5);
        expect(numberOrZero(null, 5)).toBe(5);
    });

    it('AND A FIELD STORED UNDER TWO NAMES IS READ UNDER BOTH', () => {
        //   #589's finding: a window's raised amount is `fundedAmount` on new
        //   rows and `currentFunding` on old ones, and five readers each spelled
        //   their own fallback chain slightly differently.
        expect(firstNumber(undefined, 300)).toBe(300);
        expect(firstNumber(500, 300)).toBe(500);
        expect(firstNumber(null, '', undefined)).toBe(0);
        expect(firstNumber(0, 99)).toBe(0);
    });

    it('AND A FIGURE NOBODY WROTE IS A DASH, NOT A ZERO', () => {
        //   Zero and "not recorded" are different claims about money, which is
        //   #588's whole finding in a different place.
        expect(numberOrDash(undefined)).toBe('—');
        expect(numberOrDash(null)).toBe('—');
        expect(numberOrDash(0)).toBe('0');
        expect(numberOrDash(1500000)).toBe('1,500,000');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#597 — the floor, raised to forty-four', () => {
    for (const [name, mod, props] of BARE_ROW_SUBJECTS) {
        it(`${name} RENDERS A ROW THAT CARRIES ONLY AN ID`, async () => {
            const { default: Screen } = await import(mod);
            //   Rendering IS the assertion: a throw here is a blank page.
            const { container } = render(<Screen {...props} />);
            expect(container).toBeTruthy();
        });
    }

    it('AND THIS BATCH IS TWENTY-TWO SUBJECTS, NAMED', () => {
        expect(BARE_ROW_SUBJECTS).toHaveLength(22);
        expect(new Set(BARE_ROW_SUBJECTS.map(s => s[0])).size).toBe(22);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#597 — and no member-facing screen builds a date formatter by hand', () => {
    function handWrittenFormatters(src: string): string[] {
        //   `new Intl.DateTimeFormat(…)` anywhere outside lib/date-utils. The
        //   hazard is not the options object, it is `.format()` on a Date
        //   nobody checked, and every one of the ten call sites got there by
        //   constructing its own formatter.
        return src.match(/new\s+Intl\.DateTimeFormat\s*\(/g) ?? [];
    }

    let lastSeen = 0;
    function scan(): string[] {
        const found: string[] = [];
        let seen = 0;
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    //   Admin is a separate pass, as in #545, #588, #589 and #596.
                    if (entry !== 'admin') walk(full);
                } else if (entry.endsWith('.tsx')) {
                    seen += 1;
                    if (handWrittenFormatters(readFileSync(full, 'utf-8')).length) {
                        found.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        lastSeen = seen;
        return found.sort();
    }

    it('THE COUNT IS ZERO, EXACTLY', () => {
        //   Exact, not `<=`: a cap that can be raised without a test failing is
        //   the "check that cannot fail" this audit keeps finding, and #588's
        //   own ratchet had it.
        expect(scan()).toEqual([]);
    });

    it('AND THE SCAN CAN STILL FIND ONE — the guard that zero needs', () => {
        //   #484's shape. At zero, a scan pointed at the wrong directory is
        //   indistinguishable from a fixed codebase, so the walk has to have
        //   read something and the predicate has to still fire.
        scan();
        expect(lastSeen).toBeGreaterThan(100);
        expect(handWrittenFormatters('new Intl.DateTimeFormat("en-NG", {}).format(d)')).toHaveLength(1);
        expect(handWrittenFormatters('formatDateOrDash(value)')).toHaveLength(0);
    });

    it('AND lib/date-utils IS WHERE THE ONE FORMATTER LIVES', () => {
        //   The negative of the rule: the shared module must still contain what
        //   everything else was banned from doing, or the ban is satisfied by
        //   nobody formatting dates at all.
        const utils = readFileSync(join(ROOT, 'src/lib/date-utils.ts'), 'utf-8');
        expect(handWrittenFormatters(utils).length).toBeGreaterThan(0);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     date: toDate instead of toDateOrNull, so a
 *           missing date renders as TODAY               KILLED (2 tests)
 *     date: the try/catch removed                       KILLED  ← see below
 *     numbers: a non-finite value passed through        KILLED
 *     numbers: the null/undefined guard dropped         KILLED  ← see below
 *     numbers: firstNumber stops at the first candidate KILLED
 *     numbers: numberOrDash returns 0 for a missing
 *              figure instead of a dash                 KILLED
 *     withdrawals: the hand-written formatter back      KILLED (2)
 *     opportunities: slotPrice unguarded again          KILLED
 *     opportunities: the volumes unguarded again        KILLED
 *     analytics: the three-key defaults back            KILLED
 *     farm dashboard: the list guard removed            KILLED
 *     id-card: the shared formatter swapped back        KILLED
 *     ratchet: the scan pointed at another directory    KILLED
 *     ratchet: a subject dropped from this batch        KILLED (2)
 *     ledger: a name added to #589's PROVEN without a
 *             render being added here                   KILLED (2)
 *     reword this header                                SURVIVED, as intended
 *
 *   TWO SURVIVED THE FIRST RUN AND NOW DO NOT, and both were untested halves of
 *   a guard rather than untested behaviour:
 *
 *     Removing the try/catch changed nothing, because a VALID Date never makes
 *     `.format` throw — the catch is covering the other way in, an options
 *     object `Intl.DateTimeFormat` cannot honour, which throws at CONSTRUCTION.
 *
 *     Dropping `numberOrZero`'s null guard changed nothing at the default
 *     fallback, because `Number(null)` is 0 and `Number(undefined)` is NaN which
 *     the finite check catches. It is only visible when a caller asks for a
 *     fallback that is not zero, which is what the parameter exists for.
 *
 *   AND ONE EQUIVALENT MUTANT, RECORDED AS EQUIVALENT AND NOT COUNTED AS
 *   COVERAGE. Replacing `if (!d) return fallback` with a second
 *   `new Date(String(value))` attempt survives, and it survives BECAUSE of the
 *   try/catch: the retry produces an Invalid Date, `.format` throws, and the
 *   catch returns the same dash. The explicit guard stays because it says what
 *   the function means rather than relying on an exception to mean it, but no
 *   test can tell the two apart and pretending otherwise would be the kind of
 *   coverage claim this audit exists to catch.
 */
