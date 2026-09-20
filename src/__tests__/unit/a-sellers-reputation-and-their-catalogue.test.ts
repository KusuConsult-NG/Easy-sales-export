/**
 * @jest-environment node
 */

/**
 *   MARKETPLACE — EIGHT READS, AND TWO OF THEM ARE WHAT A BUYER DECIDES ON.
 *
 *   The module was mostly swept already (8 bare against 30 resolved), and the
 *   eight that remained were not leftovers of one kind. Two matter to somebody
 *   other than the seller:
 *
 *     THE SELLER'S REPUTATION. getSellerReviews read SELLER_REVIEWS by one
 *     id, so a seller whose profile was superseded showed HALF their reviews —
 *     and a rating is the thing a buyer is deciding on. Nothing looks broken:
 *     the page renders, with fewer reviews and a different average.
 *
 *     THE SELLER'S CATALOGUE. Setting a seller's category denormalises it onto
 *     every product they own, and _mp_products reads it back as the filter for
 *     the wholesale and the retail views. A product listed under a superseded
 *     profile kept the stale category and dropped out of the view its seller
 *     had just been moved into.
 *
 * ── AND ONE THAT IS DELIBERATELY LEFT ALONE ─────────────────────────────────
 *
 *   The duplicate-review check widens `buyerId` and not `sellerId`. The buyer
 *   is the owner — one person with two profiles must not review the same order
 *   twice — while the seller is the counterparty and the row is already pinned
 *   by `orderId`. Widening it would scope the check across a seller's whole
 *   profile history for an order belonging to one of them.
 *
 *   The last test here pins that asymmetry, because it reads like an oversight
 *   and is not.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LIVE = 'live-seller';
const OLD = 'superseded-seller';
const STRANGER = 'another-seller';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'seller@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'seller@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    (global as any).mockRequireSession.mockImplementation(() =>
        Promise.resolve({ session: { user: { id: LIVE, email: 'seller@example.com', roles: [] } }, error: null }));
});

describe('a seller\'s reputation is not split by their profile history', () => {
    //   The real export, named outright. `getSellerReviewsAction` does not
    //   exist — reaching for a plausible name is how the academy fixture ran
    //   nothing three times over.
    async function summary(id: string) {
        const { getSellerReviewSummaryAction } = await import('@/app/actions/marketplace/_reviews');
        const r = await getSellerReviewSummaryAction(id) as any;
        return r?.data?.summary ?? null;
    }

    it('THE test — reviews left under the old profile still count', async () => {
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-old', {
            sellerId: OLD, buyerId: 'b1', rating: 5, status: 'approved', comment: 'Excellent',
        });
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-new', {
            sellerId: LIVE, buyerId: 'b2', rating: 4, status: 'approved', comment: 'Good',
        });

        const sum = await summary(LIVE);

        //   Both reviews counted, and the average is theirs: (5 + 4) / 2.
        expect(sum).toMatchObject({ totalReviews: 2, averageRating: 4.5 });
    });

    it('and asking by the SUPERSEDED id gives the same answer', async () => {
        //   A catalogue link minted before the profiles were settled still
        //   carries the old id, so the forward walk has to run first.
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-old', {
            sellerId: OLD, buyerId: 'b1', rating: 5, status: 'approved', comment: 'Excellent',
        });
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-new', {
            sellerId: LIVE, buyerId: 'b2', rating: 4, status: 'approved', comment: 'Good',
        });

        const sum = await summary(OLD);

        expect(sum).toMatchObject({ totalReviews: 2, averageRating: 4.5 });
    });

    it('and never another seller\'s reviews', async () => {
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-x', {
            sellerId: STRANGER, buyerId: 'b3', rating: 1, status: 'approved', comment: 'Bad',
        });

        const sum = await summary(LIVE);

        expect(sum).toMatchObject({ totalReviews: 0 });
    });

    it('and an unapproved review is still withheld — the vacuity control', async () => {
        //   A widening that returned everything would pass all three above.
        store.seed(COLLECTIONS.SELLER_REVIEWS, 'r-pending', {
            sellerId: OLD, buyerId: 'b1', rating: 5, status: 'pending', comment: 'Not yet live',
        });

        const sum = await summary(LIVE);

        expect(sum).toMatchObject({ totalReviews: 0 });
    });
});

describe('and the module is swept', () => {
    it('NO UNRESOLVED OWNER READ REMAINS, except the one that is documented', () => {
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("\\(userId\\|sellerId\\|buyerId\\|ownerId\\)", *"==" *,' `
            + `src/app/actions/marketplace --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim().split('\n').filter(Boolean);

        //   The duplicate-review counterparty read, and only it. It is pinned
        //   by orderId and widening it would be wrong — see the header.
        expect(out.map((l: string) => l.split(':')[0])).toEqual(
            ['src/app/actions/marketplace/_reviews.ts'],
        );
    });

    it('VACUITY GUARD: the search finds bare reads where they still exist', () => {
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("userId", *"==" *,' src/app/actions --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect(out.length).toBeGreaterThan(0);
    });
});
