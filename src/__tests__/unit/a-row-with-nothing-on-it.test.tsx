/**
 * @jest-environment jsdom
 */

/**
 *   #596 A STATUS FIELD NOBODY WROTE TOOK THE PAGE DOWN — TWENTY-ONE TIMES, IN
 *        TWENTY-ONE SPELLINGS.
 *
 *   #589 found one member without an occupation crashing the whole cooperative
 *   directory, and left a FLOOR: screens proven to survive a document that
 *   carries almost nothing, a number that may only go up. This is that floor
 *   being raised, and what raising it found.
 *
 *   Nineteen screens were rendered with a bare row — `{ id: 'x' }` and nothing
 *   else — and SEVEN of them threw during render. A throw in render is not a
 *   missing badge; React unmounts the tree and the person gets a blank page:
 *
 *     cooperatives/history        t.type.replace('_', ' ')
 *     wave/shipments              shipment.status.replace("_", " ")
 *     dashboard/reviews           review.productId.slice(0, 16)
 *                                 review.status.charAt(0)…
 *     farm-nation/my-purchases    escrowStatus.charAt(0)…
 *     marketplace/orders/[id]     order.deliveryAddress.recipientName  ← and
 *                                 four more lines of the same address
 *     buyer/orders/[id]           order.items.map(…)
 *     seller/orders/[id]          order.items.map(…)
 *
 *   THE ORDER SCREENS ARE THE ONES THAT MATTER. `/marketplace/orders/[id]` is
 *   where a buyer is redirected the moment they finish paying, and it read five
 *   fields off `order.deliveryAddress` with no guard at all. The two order
 *   detail screens map over `order.items` the same way. An order row missing
 *   either does not lose a panel — it loses the page, on the screen a person
 *   goes to when they want to know what they just bought.
 *
 *   A sweep then found ten more unguarded `.replace("_", " ")` and `.charAt(0)`
 *   calls on stored fields across ten further screens: loans, withdrawals,
 *   course detail, investment detail, WAVE certificates, WAVE earnings, WAVE
 *   training, the village-market event page, the dispute form and the WAVE
 *   application review step. Twenty-one call sites in all.
 *
 * ── ONE READING, NOT TWENTY-ONE ─────────────────────────────────────────────
 *
 *   #439's lesson, which this codebase keeps paying for. The twenty-one already
 *   disagreed with each other:
 *
 *     `replace("_", " ")`   replaces the FIRST underscore only, so
 *                           `pending_manual_review` rendered as
 *                           "pending manual_review" — a live cosmetic bug at
 *                           several of these sites, quite apart from the crash.
 *     `replace(/_/g, " ")`  the same idea, spelled correctly, elsewhere.
 *     `.charAt(0).toUpperCase() + …slice(1)`  capitalised, or upper-cased, or
 *                           neither, depending on the file.
 *
 *   lib/humanise is the one reading now: every underscore, never a throw, and
 *   an em dash rather than the word "undefined" when the field is not there.
 *
 * ── HOW LIKELY, HONESTLY ────────────────────────────────────────────────────
 *
 *   THE CRASHES ARE LATENT, NOT FIRING TODAY, and saying otherwise would be the
 *   louder, falser finding. I checked the writers rather than assuming: every
 *   writer of COOPERATIVE_TRANSACTIONS sets `type` (six of them, in
 *   _payment, _coop_admin_money, _coop_money twice, verify-payment and
 *   create-fixed-savings); every writer of PRODUCT_REVIEWS sets `status`.
 *
 *   They are fixed for the reason #589's escrow-id note gives: the consequence
 *   is total and silent — a blank page rather than a blank field — and the fix
 *   costs nothing. These are also the collections that acquire rows from
 *   migrations, admin back-fills and partial writes, which is how #563, #573
 *   and #589 each arrived.
 *
 *   THE `replace("_", " ")` COSMETIC BUG IS NOT LATENT. Any status with two
 *   underscores renders wrong today, and `pending_manual_review`,
 *   `payment_received` and `fixed_savings_lock` are all real stored values.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   NO READER WAS CHANGED AND NO DOCUMENT WAS TOUCHED. Every fix is on the
 *   screen, and every field that was being drawn is still drawn.
 *
 *   THE ADMIN SCREENS WERE OUT OF SCOPE HERE, as in #545, #588 and #589 — "a
 *   handful of staff, not every member" — and this file recorded the debt as a
 *   number, 26, rather than letting the exclusion sit unmeasured. #600 PAID IT:
 *   all twenty-six are fixed, admin is inside the scan, and what is left is the
 *   two the rule cannot read. The number in that test is 2 now, and the reason
 *   the exclusion existed at all did not survive being written down — these are
 *   the screens where a withdrawal is approved and an escrow released.
 *
 *   NINETEEN SCREENS IS NOT EVERY SCREEN. The floor says what has been proven,
 *   never what is safe.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { humanise, humaniseCapitalised, humaniseUpper, shortId } from '@/lib/humanise';

const ROOT = process.cwd();

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
//   One router object, not a new one per call: Next's own is stable, and a
//   screen whose load effect depends on `[router]` reloads itself forever
//   against a mock that is not. #595's suite lost ten minutes to that.
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({ id: 'x' }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', roles: [] } }, status: 'authenticated' }),
    signOut: jest.fn(),
}));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));

/**
 * Every server action answers "read nothing", so the SEED is the only data the
 * screen has and the bare row is what gets rendered.
 */
//   Written out one by one rather than through a shared factory: jest.mock is
//   HOISTED above every const in the file, so a factory declared here is not
//   initialised when the mock runs. An inline arrow closes over nothing and is
//   fine.
const empty = async () => ({ success: true, error: null, data: null });
jest.mock('@/app/actions/marketplace', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/cooperative', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/reviews', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/wave', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/my-data', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/village-market', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/health', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/messages', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/land-listings', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/farm-nation', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/export-products', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/export', () => new Proxy({}, { get: () => empty }));
jest.mock('@/app/actions/export-booking', () => new Proxy({}, { get: () => empty }));

/**
 * THE FLOOR. Each entry is a screen rendered with a document that carries an id
 * and nothing else, and watched not to throw.
 *
 * It may only go up. A subject that never breaks is still worth having: it
 * records that the screen's safety is deliberate rather than accidental, and it
 * fails the day somebody removes the guard that was quietly holding it up.
 */
const BARE_ROW_SUBJECTS: [string, string, () => any][] = [
    //   The seven that threw.
    ['cooperatives/history', '@/app/cooperatives/(member)/history/CooperativeHistoryClient', () => ({ initial: [{ id: 't1' }] })],
    ['wave/shipments', '@/app/wave/(member)/shipments/WaveShipmentsClient', () => ({ initial: [{ id: 's1' }] })],
    ['dashboard/reviews', '@/app/dashboard/reviews/MyReviewsClient', () => ({ initial: [{ id: 'r1' }] })],
    ['farm-nation/my-purchases', '@/app/farm-nation/(member)/my-purchases/MyPurchasesClient', () => ({ initial: [{ id: 'pr1' }] })],
    ['marketplace/orders/[id]', '@/app/marketplace/orders/[id]/OrderConfirmationClient', () => ({ initial: { id: 'o1' } })],
    ['marketplace/buyer/orders/[id]', '@/app/marketplace/buyer/orders/[id]/BuyerOrderDetailClient', () => ({ initial: { id: 'o1' } })],
    ['marketplace/seller/orders/[id]', '@/app/marketplace/seller/orders/[id]/SellerOrderDetailClient', () => ({ initial: { orderResult: { success: true, error: null, data: { order: { id: 'o1' } } }, trackingResult: null } })],
    //   And the twelve that already survived, kept as subjects for the reason
    //   above: today's safety is recorded rather than assumed.
    ['marketplace/buyer/orders', '@/app/marketplace/buyer/orders/BuyerOrdersClient', () => ({ initial: [{ id: 'o1' }] })],
    ['marketplace/seller/orders', '@/app/marketplace/seller/orders/SellerOrdersClient', () => ({ initial: [{ id: 'o1' }] })],
    ['marketplace/seller/products', '@/app/marketplace/seller/products/SellerProductsClient', () => ({ initial: { products: [{ id: 'p1' }], lastId: undefined, hasMore: false } })],
    ['dashboard/disputes', '@/app/dashboard/disputes/DisputesClient', () => ({ initial: [{ id: 'd1' }] })],
    ['dashboard/notifications', '@/app/dashboard/notifications/NotificationsClient', () => ({ initial: [{ id: 'n1' }] })],
    ['dashboard/certificates', '@/app/dashboard/certificates/CertificatesClient', () => ({ initial: { uploaded: [{ id: 'u1' }], academy: [{ id: 'a1' }] } })],
    ['marketplace/village-market/seller', '@/app/marketplace/village-market/seller/VillageMarketSellerClient', () => ({ initial: [{ id: 'e1' }] })],
    ['export/(app)/products', '@/app/export/(app)/products/MyExportProductsClient', () => ({ initial: [{ id: 'p1' }] })],
    ['export/(app)/bookings', '@/app/export/(app)/bookings/ExportBookingsClient', () => ({ initial: [{ id: 'b1' }] })],
    ['export/(app)/portfolio', '@/app/export/(app)/portfolio/ExportPortfolioClient', () => ({ initial: [{ id: 'i1' }] })],
    ['cooperatives/my-savings', '@/app/cooperatives/(member)/my-savings/MySavingsClient', () => ({ initial: [{ id: 'sv1' }] })],
    ['farm-nation/properties', '@/app/farm-nation/properties/PropertiesClient', () => ({ initial: [{ id: 'l1' }] })],
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#596 — one reading of a stored status', () => {
    it('EVERY UNDERSCORE, NOT JUST THE FIRST', () => {
        /**
         *   THE COSMETIC HALF, AND IT IS NOT LATENT. `replace("_", " ")`
         *   replaces one underscore, so a two-word status came out half done.
         *   `pending_manual_review`, `payment_received` and
         *   `fixed_savings_lock` are all values this application stores.
         */
        expect(humanise('pending_manual_review')).toBe('pending manual review');
        expect(humanise('payment_received')).toBe('payment received');
        expect(humanise('delivered')).toBe('delivered');
    });

    it('AND A ROW WITHOUT THE FIELD GETS A DASH, NOT A CRASH AND NOT THE WORD "undefined"', () => {
        for (const value of [undefined, null, '', '   ', 42, {}, []]) {
            expect({ value, out: humanise(value) }).toEqual({ value, out: '—' });
        }
        expect(humanise(undefined, 'Unknown')).toBe('Unknown');
    });

    it('AND CAPITALISED MEANS ONE INITIAL, NOT TITLE CASE', () => {
        expect(humaniseCapitalised('in_transit')).toBe('In transit');
        expect(humaniseCapitalised(undefined)).toBe('—');
        //   A SURVIVING MUTANT IS WHY THIS LINE EXISTS. Capitalising the
        //   fallback too is invisible while the fallback is an em dash, and
        //   wrong the moment a caller passes words: the fallback is the
        //   caller's sentence and is returned as written.
        expect(humaniseCapitalised(undefined, 'not recorded')).toBe('not recorded');
        expect(humaniseUpper(undefined, 'not recorded')).toBe('not recorded');
        expect(humaniseUpper('payment_received')).toBe('PAYMENT RECEIVED');
        expect(humaniseUpper(null)).toBe('—');
    });

    it('AND A SHORT ID IS SHORT, OR A DASH', () => {
        expect(shortId('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
        expect(shortId('abc')).toBe('abc');
        expect(shortId(undefined)).toBe('—');
        expect(shortId('')).toBe('—');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#596 — the floor: screens proven against a document with nothing on it', () => {
    for (const [name, mod, props] of BARE_ROW_SUBJECTS) {
        it(`${name} RENDERS A ROW THAT CARRIES ONLY AN ID`, async () => {
            const { default: Screen } = await import(mod);
            //   Rendering IS the assertion: a throw here is a blank page for a
            //   person, and React gives no second chance during render.
            const { container } = render(<Screen {...props()} />);
            expect(container).toBeTruthy();
        });
    }

    it('AND THE FLOOR IS NINETEEN SUBJECTS, NAMED', () => {
        //   Named and counted, so "nineteen screens are proven" cannot become
        //   true by deleting a case.
        expect(BARE_ROW_SUBJECTS).toHaveLength(19);
        expect(new Set(BARE_ROW_SUBJECTS.map(s => s[0])).size).toBe(19);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#596 — and no member-facing screen humanises a stored field by hand', () => {
    /**
     * A value read off an object — `something.field` — with `.replace("_"…)` or
     * `.charAt(0)` called straight on it, and no optional chain in the way.
     *
     * Deliberately narrow. It does not try to prove a screen is safe; it counts
     * the ONE spelling that this finding is about, so that the next hand-written
     * copy of the rule fails a test instead of waiting for a row without the
     * field.
     */
    /**
     * The one file whose `.replace` sits behind a `typeof x === "string"` test
     * the pattern cannot see. Two sites, both on a `category` that may be an
     * array, an object or a string, and both already guarded.
     */
    const GUARDED_BY_A_TYPEOF = ['src/app/admin/farm-nation/land-verification/page.tsx'];

    function handWrittenHumanisers(src: string): string[] {
        const re = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\.\s*(?:replace\s*\(\s*["'/]_|charAt\s*\(\s*0\s*\))/g;
        return (src.match(re) ?? []).filter(hit => !hit.includes('?.'));
    }

    function scan(): { file: string; hits: string[] }[] {
        const found: { file: string; hits: string[] }[] = [];
        let seen = 0;
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    //   #600 — ADMIN IS IN SCOPE NOW. It was excluded here on
                    //   "a handful of staff, not every member", and that reads
                    //   differently once you notice these are the screens where
                    //   a withdrawal is approved and an escrow released: a blank
                    //   admin page is a seller who does not get paid.
                    walk(full);
                } else if (entry.endsWith('.tsx')) {
                    seen += 1;
                    const rel = full.slice(ROOT.length + 1);
                    if (GUARDED_BY_A_TYPEOF.includes(rel)) continue;
                    const hits = handWrittenHumanisers(readFileSync(full, 'utf-8'));
                    if (hits.length) found.push({ file: rel, hits });
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        lastSeen = seen;
        return found;
    }
    let lastSeen = 0;

    it('THE COUNT IS ZERO, EXACTLY', () => {
        //   Exact, not `<=`: #588's ratchet could be raised to any number
        //   without a test failing, which is this audit's own "a check that
        //   cannot fail" wearing the instrument's clothes.
        expect(scan()).toEqual([]);
    });

    it('AND THE SCAN CAN STILL FIND ONE — the guard that zero needs', () => {
        /**
         *   #484's shape, and at zero it is the whole question: a scan pointed
         *   at the wrong directory finds nothing for the same reason a fixed
         *   codebase does. So the walk has to have READ something, and the
         *   predicate has to still fire on the exact text it was built for.
         */
        scan();
        expect(lastSeen).toBeGreaterThan(100);

        expect(handWrittenHumanisers('{shipment.status.replace("_", " ")}')).toHaveLength(1);
        expect(handWrittenHumanisers("{t.type.replace('_', ' ')}")).toHaveLength(1);
        expect(handWrittenHumanisers('{review.status.charAt(0).toUpperCase()}')).toHaveLength(1);
        //   And the shapes it must NOT claim: a guarded read, a local string,
        //   and the helper itself.
        expect(handWrittenHumanisers('{shipment.status?.replace("_", " ")}')).toHaveLength(0);
        expect(handWrittenHumanisers('{status.replace("_", " ")}')).toHaveLength(0);
        expect(handWrittenHumanisers('{humanise(shipment.status)}')).toHaveLength(0);
    });

    it('AND THE ADMIN DEBT THIS FILE RECORDED IS PAID', () => {
        /**
         *   #600. This test used to assert `hits === 26` under src/app/admin —
         *   a stated debt with a size on it, excluded from the scan above. The
         *   twenty-six are fixed and admin is inside the main scan now, so what
         *   is left here is the TWO the rule cannot read: both are on
         *   /admin/farm-nation/land-verification, both sit behind a
         *   `typeof x === "string"` the regex cannot see, and neither can throw.
         *
         *   Named rather than regexed away, and capped, for the same reason
         *   #595's NOT_A_READ_LIST is capped.
         */
        let hits = 0;
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full);
                else if (entry.endsWith('.tsx')) hits += handWrittenHumanisers(readFileSync(full, 'utf-8')).length;
            }
        };
        walk(join(ROOT, 'src/app/admin'));

        expect(hits).toBe(2);
        expect(GUARDED_BY_A_TYPEOF).toEqual(['src/app/admin/farm-nation/land-verification/page.tsx']);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     humanise: only the first underscore again        KILLED
 *     humanise: a non-string passed through            KILLED (2 tests)
 *     humanise: an empty string is not the fallback    KILLED
 *     humaniseCapitalised: the fallback capitalised too KILLED  ← see below
 *     shortId: the guard dropped                       KILLED
 *     order confirmation: the address guard removed    KILLED
 *     order confirmation: items map unguarded again    KILLED
 *     buyer order detail: items map unguarded again    KILLED
 *     seller order detail: items map unguarded again   KILLED
 *     history: the hand-written humaniser back         KILLED (2)
 *     shipments: the hand-written humaniser back       KILLED (2)
 *     reviews: the raw slice back                      KILLED
 *     my-purchases: the raw charAt back                KILLED
 *     ratchet: the admin debt number raised            KILLED
 *     ratchet: the scan pointed at another directory   KILLED
 *     ratchet: a subject dropped from the floor        KILLED (2)
 *     ledger: a name added to #589's PROVEN without a
 *             render being added here                  KILLED (2)
 *     reword this header                               SURVIVED, as intended
 *
 *   ONE SURVIVED THE FIRST RUN. Capitalising the FALLBACK as well as the value
 *   is invisible while the fallback is an em dash — `"—".toUpperCase()` is
 *   `"—"` — and wrong the moment a caller passes words, because the fallback is
 *   the caller's own sentence. There is a test with a worded fallback now.
 */
