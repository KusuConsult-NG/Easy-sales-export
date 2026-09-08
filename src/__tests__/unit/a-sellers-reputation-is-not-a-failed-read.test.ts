/**
 * @jest-environment node
 */

/**
 *   #514 A FAILED READ WAS PUBLISHED AS A SELLER'S REPUTATION.
 *
 *   /api/marketplace/sellers/[sellerId] is the public storefront's data source —
 *   marketplace/sellers/[sellerId]/page.tsx fetches it, so this is a live page,
 *   not a spare endpoint. It held two catches:
 *
 *       } catch {
 *           products = [];
 *       }
 *
 *       } catch {
 *           // reviews collection may not exist yet
 *       }
 *
 *   No logger in either. A failing query became `products = []` and
 *   `avgRating: 0, reviewCount: 0`, and the page renders exactly that:
 *
 *       "No products listed yet."      "Check back soon!"
 *       Products  0                    (0 active)
 *       — and the star rating block disappears entirely, because it is gated on
 *         reviewCount > 0
 *
 *   So a transient database error turns an established, approved seller's
 *   storefront into an empty shop with no reputation, silently, on the page a
 *   buyer uses to decide whether to trust them. The endpoint already had a way
 *   to say "I don't know" — the outer catch returns 500 — and these two
 *   deliberately converted a failure into data instead.
 *
 *   `null` MEANS "COULD NOT READ" AND [] MEANS "THERE ARE NONE". They were the
 *   same value, which is the whole finding. The page distinguishes them now: it
 *   says the products could not be loaded rather than that there are none, and
 *   shows "—" rather than "0".
 *
 * ── AND THE NINTH COPY OF "WHICH RECORD IS CURRENT" ─────────────────────────
 *
 *   The route chose among a seller's approved verifications with a hand-written
 *   comparator on `createdAt` alone. Sellers resubmit — _mp_seller_verification
 *   writes `submittedAt` on each attempt and `resubmittedAt` on the profile — so
 *   two approved rows is a real state, and latestApplication ranks by
 *   submittedAt FIRST, then decided time, then document id.
 *
 *   The two rules therefore disagree precisely where it matters, and the
 *   storefront could publish the SUPERSEDED business name, logo and verification
 *   badge while every admin screen showed the new one. #504 through #507 swept
 *   eight copies of this shape out of five modules. This is the ninth, and it is
 *   the copy facing the public.
 *
 * ── ALSO ────────────────────────────────────────────────────────────────────
 *
 *   The review scan had no limit, so it ran under supabase-db's global default:
 *   an average computed over a silently truncated set. The bound is stated in
 *   the route now, which makes the truncation a decision rather than a side
 *   effect of a constant in another file.
 *
 *   WHAT WAS CHECKED AND IS NOT CLAIMED. The other two public read endpoints in
 *   this sweep came up clean. /api/academy/verify/[certificateId] resolves by id,
 *   by WAVE id and by academy certificate number, and refuses a row that is
 *   attached rather than issued. I looked for a WAVE equivalent of the
 *   by-number lookup and found the gap has no surface: no UI displays a WAVE
 *   certificate number and there is no free-text verifier, so a third party only
 *   ever follows the stamped URL, which is keyed on the document id and works.
 *   Reporting it would have been a defect with no population, which this audit
 *   has already done twice and does not intend to do again.
 *
 *   /api/marketplace/products computes `hasMore` and the cursor from the raw
 *   database page, BEFORE the in-memory inStock/search/price filters run, so it
 *   can answer with an empty array and `hasMore: true`. That is a real bug and
 *   it is NOT fixed here, deliberately: nothing in the application fetches that
 *   endpoint — no page, no component, no test — so it is a separate finding
 *   about a public API with no caller, and mixing it in would have hidden that.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a failed product read back to []               KILLED
 *     a failed review read back to 0/0               KILLED
 *     the verification choice back to createdAt      KILLED
 *     the review bound removed                       KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

const SELLER = 'seller-1';
const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;
const REVIEWS = COLLECTIONS.SELLER_REVIEWS;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(VERIFICATIONS, 'ver-1', {
        userId: SELLER,
        status: 'approved',
        businessName: 'Obi Agro Ltd',
        createdAt: new Date('2026-01-01').toISOString(),
        submittedAt: new Date('2026-01-01').toISOString(),
    });
});

async function get() {
    const { GET } = await import('@/app/api/marketplace/sellers/[sellerId]/route');
    const res = await GET(
        new Request(`https://example.com/api/marketplace/sellers/${SELLER}`) as never,
        { params: Promise.resolve({ sellerId: SELLER }) } as never,
    );
    return { status: res.status, body: (await res.json()) as any };
}

/**
 * Make ONE collection's reads throw, leaving every other read working.
 *
 * installFakeDb routes every read through globalThis.mockFirestoreGet and
 * describes the target in globalThis.__firestoreAccess, so this wraps the
 * implementation the handle installed rather than reaching past it. My first
 * attempt invented a `store.db` that FakeDbHandle does not expose — it has
 * seed/get/all/size/collections/clear and nothing else.
 */
function breakCollection(name: string): void {
    const g = globalThis as any;
    const real = g.mockFirestoreGet.getMockImplementation();
    g.mockFirestoreGet.mockImplementation((...args: any[]) => {
        if (g.__firestoreAccess?.collection === name) {
            return Promise.reject(new Error('canceling statement due to statement timeout'));
        }
        return real(...args);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#514 — an absence is not a fact', () => {
    it('A FAILED PRODUCT READ IS null, NOT AN EMPTY SHOP', async () => {
        //   THE test. `catch { products = [] }` made a database timeout
        //   indistinguishable from a seller with nothing to sell, and the page
        //   renders the second one.
        breakCollection(COLLECTIONS.PRODUCTS);

        const { body } = await get();

        expect(body.products).toBeNull();
        expect(body.unavailable).toContain('products');
    });

    it('AND A FAILED REVIEW READ IS null, NOT A ZERO RATING', async () => {
        //   The page gates its whole star block on reviewCount > 0, so a
        //   swallowed failure deleted the seller's rating without a trace.
        breakCollection(COLLECTIONS.SELLER_REVIEWS);

        const { body } = await get();

        expect(body.reviews).toBeNull();
        expect(body.unavailable).toContain('reviews');
    });

    it('AND A SELLER WITH GENUINELY NO PRODUCTS STILL READS AS []', async () => {
        //   The distinction the fix is for. If both cases were null the page
        //   would tell every new seller that the site is broken.
        const { body } = await get();

        expect(body.products).toEqual([]);
        expect(body.reviews).toEqual({ avgRating: 0, reviewCount: 0 });
        expect(body.unavailable).toEqual([]);
    });

    it('and a working read still returns the products and the average', async () => {
        //   The vacuity guard for the whole block.
        store.seed(COLLECTIONS.PRODUCTS, 'p-1', {
            sellerId: SELLER, status: 'active', title: 'Shea butter',
            price: 5000, createdAt: new Date().toISOString(),
        });
        store.seed(REVIEWS, 'r-1', { sellerId: SELLER, status: 'approved', rating: 5 });
        store.seed(REVIEWS, 'r-2', { sellerId: SELLER, status: 'approved', rating: 4 });

        const { body } = await get();

        expect(body.products).toHaveLength(1);
        expect(body.reviews).toEqual({ avgRating: 4.5, reviewCount: 2 });
    });

    it('and an unapproved review is still excluded from the average', async () => {
        //   #99's rule, which this change must not disturb: rejecting a fake
        //   one-star has to change what a buyer sees.
        store.seed(REVIEWS, 'r-1', { sellerId: SELLER, status: 'approved', rating: 5 });
        store.seed(REVIEWS, 'r-2', { sellerId: SELLER, status: 'rejected', rating: 1 });

        expect((await get()).body.reviews).toEqual({ avgRating: 5, reviewCount: 1 });
    });

    it('and an unapproved seller is still 404', async () => {
        store.clear();

        expect((await get()).status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#514 — which approved verification is current', () => {
    it('A RESUBMISSION SUPERSEDES THE ONE IT REPLACED', async () => {
        //   THE test for the ninth copy. Ordering on createdAt alone, while the
        //   shared rule ranks submittedAt first, means the storefront can
        //   publish the superseded business name and badge.
        store.seed(VERIFICATIONS, 'ver-2', {
            userId: SELLER,
            status: 'approved',
            businessName: 'Obi Agro & Sons Ltd',
            submittedAt: new Date('2026-06-01').toISOString(),
            createdAt: new Date('2026-06-01').toISOString(),
        });

        expect((await get()).body.seller.businessName).toBe('Obi Agro & Sons Ltd');
    });

    it('AND submittedAt DECIDES IT, NOT createdAt', async () => {
        //   The two keys pointed the opposite way here, which is the only
        //   arrangement that tells the rules apart. `ver-2` was created first
        //   and submitted last.
        store.seed(VERIFICATIONS, 'ver-2', {
            userId: SELLER,
            status: 'approved',
            businessName: 'Obi Agro & Sons Ltd',
            createdAt: new Date('2025-01-01').toISOString(),
            submittedAt: new Date('2026-06-01').toISOString(),
        });

        expect((await get()).body.seller.businessName).toBe('Obi Agro & Sons Ltd');
    });

    it('and the route states no comparator of its own', () => {
        //   Comments stripped: this header and the route's name the removed
        //   expression to explain it — #493's trap.
        const body = stripComments(
            readFileSync('src/app/api/marketplace/sellers/[sellerId]/route.ts', 'utf-8'),
            { label: 'sellers/[sellerId] route.ts' },
        );

        expect(body).toContain('latestApplication(verSnap.docs)');
        expect(body).not.toMatch(/verSnap\.docs\.sort/);
        expect(body).toContain('.limit(REVIEW_SCAN_LIMIT)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#514 — the page does not present the absence as a fact', () => {
    const page = () => stripComments(
        readFileSync('src/app/marketplace/sellers/[sellerId]/page.tsx', 'utf-8'),
        { label: 'sellers/[sellerId] page.tsx' },
    );

    it('IT DISTINGUISHES "COULD NOT LOAD" FROM "NONE"', () => {
        //   A rendering assertion pinned to source, and the reason is stated:
        //   this is an async server component whose data arrives over its own
        //   HTTP fetch, so exercising it here would test the fetch mock rather
        //   than the page. The behaviour it guards is asserted on the endpoint
        //   above; this pins that the page reads the distinction the endpoint
        //   now draws, which is the half a change could silently drop.
        const src = page();

        expect(src).toContain('productsUnavailable');
        expect(src).toContain('reviewsUnavailable');
        expect(src).toMatch(/couldn&apos;t load this seller&apos;s products/);
    });

    it('AND STILL SAYS "NO PRODUCTS LISTED YET" WHEN THERE GENUINELY ARE NONE', () => {
        expect(page()).toContain('No products listed yet.');
    });
});
