/**
 * @jest-environment node
 */

/**
 *   SWEEPING BY FEATURE, NOT BY DIRECTORY — AND MARKETPLACE IS WHY.
 *
 *   Tranche 7 widened getSellerReviewSummaryAction so a seller whose profile
 *   was superseded stopped showing half their reviews. It was scoped to
 *   src/app/actions/marketplace, so it could not see:
 *
 *       api/marketplace/sellers/[sellerId]   the page a BUYER lands on
 *       marketplace/seller/layout.tsx        the seller's own gate
 *       lib/verification-canonical.ts        the profile admins read and edit
 *       actions/reviews.ts                   a SECOND rating surface, on a
 *                                            different reviews collection
 *       actions/saved-items.ts               a saved seller, by a saved id
 *
 *   So the seller's own action was correct while the public page disagreed
 *   with it about the same seller. That is the third time in this sweep the
 *   SCOPE has been the defect rather than any line inside it, which is why the
 *   remaining work was organised by feature.
 *
 *   THE PUBLIC ROUTE IS THE SHARP ONE. Its id comes from the URL, so it is the
 *   surface most likely to be handed a superseded id — an old catalogue link
 *   carries one by construction — and there is no session to fall back on.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const OLD = 'a-superseded-seller';
const LIVE = 'b-live-seller';
const OTHER = 'c-another-seller';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'seller@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'seller@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, OTHER, { email: 'other@example.com' });
});

const review = (id: string, sellerId: string, rating: number) =>
    store.seed(COLLECTIONS.SELLER_REVIEWS, id, {
        sellerId, rating, status: 'approved', createdAt: new Date('2026-01-01'),
    });

const approvedVerification = (id: string, userId: string, over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.SELLER_VERIFICATIONS, id, {
        userId, status: 'approved', businessName: 'Ada Stores',
        createdAt: new Date('2026-01-01'), ...over,
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('the public seller page, which is the one a buyer decides on', () => {
    const fetchSeller = async (id: string) => {
        const { GET } = await import('@/app/api/marketplace/sellers/[sellerId]/route');
        const res = await GET({} as any, { params: Promise.resolve({ sellerId: id }) } as any);
        return { status: res.status, body: await res.json() };
    };

    it('THE test — a seller approved under the OLD profile is not a 404', async () => {
        //   The whole page, gone. `verSnap.empty` returns "Seller not found or
        //   not yet approved" before products or reviews are read at all.
        approvedVerification('ver-old', OLD);

        expect((await fetchSeller(LIVE)).status).toBe(200);
    });

    it('and an old catalogue link, carrying the SUPERSEDED id, still resolves', async () => {
        //   Why `...For` and not the session helper: this id comes from the
        //   URL, and a link minted before the profiles were settled names the
        //   old profile. Backward resolution alone would not answer this.
        approvedVerification('ver-live', LIVE);

        expect((await fetchSeller(OLD)).status).toBe(200);
    });

    it('and the star rating counts reviews from both profiles', async () => {
        //   The defect tranche 7 fixed in the action, still live on the page.
        //   Two fives under the old profile and a one under the new averages
        //   3.67 across both and 1.0 on the live id alone — a seller a buyer
        //   would avoid, built from a third of their history.
        approvedVerification('ver-live', LIVE);
        review('r1', OLD, 5);
        review('r2', OLD, 5);
        review('r3', LIVE, 1);

        const { body } = await fetchSeller(LIVE);

        expect(body.reviews.reviewCount).toBe(3);
        //   The route rounds to one decimal: (5+5+1)/3 = 3.666… → 3.7
        expect(body.reviews.avgRating).toBe(3.7);
    });

    it('and the catalogue shows products listed under either profile', async () => {
        approvedVerification('ver-live', LIVE);
        store.seed(COLLECTIONS.PRODUCTS, 'p-old', {
            sellerId: OLD, status: 'active', name: 'Rice', createdAt: new Date('2026-01-01'),
        });

        const { body } = await fetchSeller(LIVE);

        expect((body.products ?? []).map((p: any) => p.id)).toContain('p-old');
    });

    it("VACUITY CONTROL: another seller's reviews are never counted", async () => {
        approvedVerification('ver-live', LIVE);
        review('r1', LIVE, 5);
        review('r-other', OTHER, 1);

        const { body } = await fetchSeller(LIVE);

        expect(body.reviews.reviewCount).toBe(1);
        expect(body.reviews.avgRating).toBe(5);
    });

    it("VACUITY CONTROL: and another seller's products are not in the catalogue", async () => {
        approvedVerification('ver-live', LIVE);
        store.seed(COLLECTIONS.PRODUCTS, 'p-other', {
            sellerId: OTHER, status: 'active', name: 'Yam', createdAt: new Date('2026-01-01'),
        });

        const { body } = await fetchSeller(LIVE);

        expect(body.products ?? []).toHaveLength(0);
    });

    it('VACUITY CONTROL: a seller with no approved verification is still a 404', async () => {
        //   Widening must not turn the gate into a pass. An unapproved seller
        //   has no public page, under any profile.
        approvedVerification('ver-pending', OLD, { status: 'pending' });

        expect((await fetchSeller(LIVE)).status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the second rating surface, on the other reviews collection', () => {
    it('averages product reviews across both profiles', async () => {
        //   getSellerReviewSummaryAction reads SELLER_REVIEWS; this reads
        //   PRODUCT_REVIEWS. Only the first was widened, so one seller had two
        //   averages computed over different halves of their history.
        store.seed(COLLECTIONS.PRODUCT_REVIEWS, 'pr1', {
            sellerId: OLD, rating: 5, status: 'approved',
        });
        store.seed(COLLECTIONS.PRODUCT_REVIEWS, 'pr2', {
            sellerId: LIVE, rating: 3, status: 'approved',
        });

        const { getSellerRatingAction } = await import('@/app/actions/reviews');
        const r = await getSellerRatingAction(LIVE) as any;

        expect(r.data.totalReviews).toBe(2);
        expect(r.data.averageRating).toBeCloseTo(4, 2);
    });

    it("VACUITY CONTROL: and not another seller's", async () => {
        store.seed(COLLECTIONS.PRODUCT_REVIEWS, 'pr1', {
            sellerId: LIVE, rating: 5, status: 'approved',
        });
        store.seed(COLLECTIONS.PRODUCT_REVIEWS, 'pr-other', {
            sellerId: OTHER, rating: 1, status: 'approved',
        });

        const { getSellerRatingAction } = await import('@/app/actions/reviews');
        const r = await getSellerRatingAction(LIVE) as any;

        expect(r.data.totalReviews).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the canonical profile reads and writes the same rows', () => {
    it('supplements the business details from a verification under the old profile', async () => {
        store.seed(COLLECTIONS.USERS, LIVE, {
            email: 'seller@example.com', fullName: 'Ada Obi',
        });
        approvedVerification('ver-old', OLD, { businessName: 'Ada Stores', sellerCategory: 'wholesale' });

        const { getCanonicalProfile } = await import('@/lib/verification-canonical');
        const profile = await getCanonicalProfile(LIVE) as any;

        expect(profile.business?.name).toBe('Ada Stores');
        expect(profile.business?.category).toBe('wholesale');
    });

    it("VACUITY CONTROL: and never from another person's verification", async () => {
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'seller@example.com' });
        approvedVerification('ver-other', OTHER, { businessName: 'Someone Else Ltd' });

        const { getCanonicalProfile } = await import('@/lib/verification-canonical');
        const profile = await getCanonicalProfile(LIVE) as any;

        expect(profile.business?.name).not.toBe('Someone Else Ltd');
    });
});
