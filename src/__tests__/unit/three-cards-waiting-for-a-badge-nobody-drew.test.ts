/**
 * @jest-environment node
 */

/**
 *   THE OWNER, from the production container:
 *
 *       [slow-action] getRecommendedProductsAction took 1033ms — 4 reads 1430ms
 *
 *   THREE CARDS ON A LANDING PAGE. The action reads the newest three visible
 *   products, then reads one user document per unique seller to resolve the
 *   verified badge live. That second step cannot be started earlier: the seller
 *   ids do not exist until the product query has come back. It is a second
 *   GENERATION of round trips, not a fourth read —
 *
 *       READ COUNT IS NOT WHAT LATENCY IS MADE OF.
 *
 * ── THE THREE THINGS THAT DID NOT WORK ──────────────────────────────────────
 *
 *   AN INDEX. The query already has one: `EXPLAIN ANALYZE` on the live
 *   database returns Index Scan, 4 rows, 3.463 ms. The database was never the
 *   thing taking a second — the network was, and an index does not shorten a
 *   chain.
 *
 *   A CACHE. Measured on the owner's own container: a Redis GET costs
 *   229–243 ms against a database read of roughly 210. Caching the badge
 *   replaces a round trip with a round trip.
 *
 *   DENORMALISING the badge onto product rows. That is precisely the design
 *   lib/seller-trust.ts exists to undo — see seller-trust-badge.test.ts, where
 *   the create-time snapshot meant "revocation did not revoke" — and
 *   _legacy.ts writes `isVerifiedBadge` a second time without sweeping any
 *   products, so the sweep would be wrong the first time it ran.
 *
 * ── WHAT ACTUALLY PAID ──────────────────────────────────────────────────────
 *
 *   NEITHER SCREEN THAT SHOWS THIS STRIP DRAWS A BADGE.
 *
 *       marketplace/page.tsx:165        {product.sellerName || SELLER_NAME_FALLBACK}
 *       buyer/dashboard/…Client.tsx:115 seller: p.sellerName || …
 *
 *   A rating, a name, a price. No shield on either. The generation of round
 *   trips was resolving a field that reached no pixel — while the screens that
 *   DO draw the shield (product detail, search, the buyer catalogue, related
 *   products) go on resolving it live, because that is where a buyer is
 *   judging a seller.
 *
 *   That is a product decision about where the badge earns its latency, and
 *   the owner made it: "drop the badge from the recommended strip."
 *
 *   The code change is one call. The care is in what replaces it: a reader
 *   that merely STOPS resolving starts serving the product's create-time
 *   snapshot, so a revoked seller would keep a badge on the landing page after
 *   losing it everywhere else. `withoutSellerBadge` writes `false` explicitly.
 *   Absent, not stale.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const PRODUCTS = COLLECTIONS.PRODUCTS;
const USERS = COLLECTIONS.USERS;

/** What the strip costs now. One query, and nothing waits on it. */
const CEILING = { reads: 1, depth: 1 };

let store: FakeDbHandle;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
});

const catalog = () => import('@/app/actions/marketplace/_mp_catalog');

/**
 * Three visible products across two sellers, one of whom holds the badge.
 *
 * Two sellers and not three deliberately: hydrateSellerTrust reads once per
 * UNIQUE seller, so three products from one seller would have cost one read
 * either way and the figures would flatter the change.
 */
function seedStrip(): void {
    const sellers = ['seller-a', 'seller-b', 'seller-a'];
    sellers.forEach((sellerId, i) => {
        store.seed(PRODUCTS, `p${i}`, {
            sellerId,
            sellerName: 'Ada Farms',
            // The snapshot. Granted at create time, revoked since — which is
            // the state the user documents below describe.
            sellerVerified: true,
            title: `Product ${i}`,
            description: 'From the farm',
            category: 'grains',
            status: 'active',
            availableQuantity: 10,
            unit: 'kg',
            pricingTiers: [{ minQuantity: 1, price: 1000 }],
            images: ['/images/p.jpg'],
            createdAt: new Date(2026, 0, 10 - i).toISOString(),
        });
    });

    store.seed(USERS, 'seller-a', { name: 'Ada Farms', isVerifiedBadge: false });
    store.seed(USERS, 'seller-b', { name: 'Bala Grains', isVerifiedBadge: true });
}

describe('what the recommended strip waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        /*
         *   The control. Without it, a ceiling of one generation passes on a
         *   harness that cannot see a second one.
         */
        const g = global as any;

        const serial = measureReadDepth();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        expect({ reads: serial.reads, depth: serial.depth }).toEqual({ reads: 2, depth: 2 });

        const together = measureReadDepth();
        await Promise.all([g.mockFirestoreGet(), g.mockFirestoreGet()]);
        expect({ reads: together.reads, depth: together.depth }).toEqual({ reads: 2, depth: 1 });
    });

    it('THE STRIP WAITS ONCE, not twice', async () => {
        seedStrip();
        const { getRecommendedProductsAction } = await catalog();
        const seen = measureReadDepth();

        const result: any = await getRecommendedProductsAction(3);

        expect(result.success).toBe(true);
        expect(result.data.products).toHaveLength(3);
        expect({ reads: seen.reads, depth: seen.depth }).toEqual(CEILING);
    });

    it('and the second generation it used to spend was USERS, so it is gone', async () => {
        seedStrip();
        const { getRecommendedProductsAction } = await catalog();

        await getRecommendedProductsAction(3);

        expect(store.reads.filter((r) => r.collection === USERS)).toEqual([]);
        expect(store.reads.filter((r) => r.collection === PRODUCTS)).toHaveLength(1);
    });

    it('THE CONTROL THAT MATTERS: the catalogue still pays for the live badge', async () => {
        /*
         *   Two generations, one of them USERS — the exact cost the strip no
         *   longer pays. If this ever measures one, the badge has been dropped
         *   from a screen that draws it, and that is not what was asked for.
         */
        seedStrip();
        const { getMarketplaceProductsAction } = await catalog();
        const seen = measureReadDepth();

        const result: any = await getMarketplaceProductsAction({ limit: 3 });

        expect(result.success).toBe(true);
        expect(seen.depth).toBe(2);
        expect(store.reads.filter((r) => r.collection === USERS).length).toBeGreaterThan(0);
    });
});

describe('what the buyer is shown instead', () => {
    it('no badge at all — not the stored one', async () => {
        //   seller-b HOLDS the badge and seller-a has lost it. Neither shows
        //   here, and that is the decision. What must not happen is the
        //   create-time `sellerVerified: true` on every row reaching the page.
        seedStrip();
        const { getRecommendedProductsAction } = await catalog();

        const result: any = await getRecommendedProductsAction(3);

        expect(result.data.products.map((p: any) => p.sellerVerified)).toEqual([false, false, false]);
    });

    it('and the seller name still reaches the card', async () => {
        //   The name is what those two screens actually render. Dropping the
        //   badge must not blank the line it sits on.
        seedStrip();
        const { getRecommendedProductsAction } = await catalog();

        const result: any = await getRecommendedProductsAction(3);

        expect(result.data.products.map((p: any) => p.sellerName)).toEqual([
            'Ada Farms', 'Ada Farms', 'Ada Farms',
        ]);
    });
});
