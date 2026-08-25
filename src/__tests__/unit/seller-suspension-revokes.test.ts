/**
 * @jest-environment node
 */

/**
 *   #242 SUSPENDING A SELLER SUSPENDED NOTHING.
 *
 *        The suspend route wrote "suspended" onto the seller VERIFICATION and
 *        the marketplace_sellers row — and stopped. Every seller ACTION gates
 *        on the USER document: `sellerVerificationStatus === "approved"` in
 *        _mp_products.ts and its siblings. That field was left saying
 *        "approved", so a suspended seller kept creating and editing products,
 *        answering quotes and receiving payouts. The admin pressing Suspend
 *        changed a word on the admin's own screen and nothing else — the exact
 *        fault the cooperative suspension had before #210 taught it to revoke.
 *
 *        The reject route wrote the user-doc status (so seller actions did
 *        stop) but left the `seller` ROLE — and rejecting an APPROVED
 *        verification is that route's revoke path: nothing guards the
 *        from-status, and the permission it demands is
 *        marketplace:suspend_sellers.
 *
 *        Both now revoke the role too. Reversible: approve-seller re-grants it
 *        with arrayUnion("seller"). This is the seventh and, per the sweep of
 *        every arrayUnion role-grant site, the last instance of the
 *        decision-changes-a-label shape (#210, #229, #242).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
    invalidateSellerCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

jest.mock('@/lib/email-notifications', () => ({
    sendSellerRejectionEmail: jest.fn(async () => undefined),
    sendSellerApprovalEmail: jest.fn(async () => undefined),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const ADMIN = 'admin-1';
const USERS = COLLECTIONS.USERS;
const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;

const asAdmin = () => mockRequireSession.mockResolvedValue({
    session: { user: { id: ADMIN, email: 'admin@e.com', roles: ['marketplace_admin'] } },
    error: null,
});

/** An APPROVED, selling seller — the state a suspension must actually end. */
const seedApprovedSeller = () => {
    store.seed(USERS, SELLER, {
        email: 'seller@e.com',
        roles: ['general_user', 'seller'],
        sellerVerificationStatus: 'approved',
        serviceRegistrations: { marketplace: { status: 'approved' } },
    });
    store.seed(VERIFICATIONS, 'ver-1', {
        userId: SELLER, status: 'approved', email: 'seller@e.com',
    });
    store.seed(COLLECTIONS.MARKETPLACE_SELLERS, SELLER, {
        userId: SELLER, verificationStatus: 'approved',
    });
};

const post = async (route: 'suspend-seller' | 'reject-seller') => {
    const mod = await import(`@/app/api/admin/marketplace/${route}/route`);
    const req = new Request(`http://localhost/api/admin/marketplace/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationId: 'ver-1', reason: 'Repeated policy violations' }),
    });
    const res = await mod.POST(req as never);
    return { status: res.status, body: await res.json() as any };
};

const seller = () => store.get(USERS, SELLER) as Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    asAdmin();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#242 — suspending a seller actually suspends them', () => {
    it('WRITES THE STATUS THE SELLER ACTIONS GATE ON', async () => {
        seedApprovedSeller();

        const { status } = await post('suspend-seller');

        expect(status).toBe(200);
        // Was: still "approved" — products, quotes and payouts all kept working.
        expect(seller().sellerVerificationStatus).toBe('suspended');
        expect(seller().serviceRegistrations.marketplace.status).toBe('suspended');
    });

    it('AND REVOKES THE ROLE', async () => {
        seedApprovedSeller();

        await post('suspend-seller');

        expect(seller().roles).not.toContain('seller');
        expect(seller().roles).toContain('general_user');
    });

    it('still marks the verification and marketplace_sellers rows, as before', async () => {
        seedApprovedSeller();

        await post('suspend-seller');

        expect(store.get(VERIFICATIONS, 'ver-1')?.status).toBe('suspended');
        expect(store.get(COLLECTIONS.MARKETPLACE_SELLERS, SELLER)?.verificationStatus).toBe('suspended');
    });

    it('still refuses a non-admin', async () => {
        seedApprovedSeller();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: SELLER, email: 'seller@e.com', roles: ['seller'] } },
            error: null,
        });

        const { status } = await post('suspend-seller');

        expect(status).toBe(403);
        expect(seller().roles).toContain('seller');
    });

    it('still 404s on a verification that does not exist', async () => {
        store.clear();
        asAdmin();
        expect((await post('suspend-seller')).status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#242 — rejecting an approved seller revokes the role too', () => {
    it('THE ROLE GOES WITH THE STATUS', async () => {
        seedApprovedSeller();

        const { status } = await post('reject-seller');

        expect(status).toBe(200);
        expect(seller().sellerVerificationStatus).toBe('rejected');
        expect(seller().serviceRegistrations.marketplace.status).toBe('rejected');
        // Was: the status flipped but the role stayed, so anything reading
        // roles alone — the module gate's Layer 1 included — still said seller.
        expect(seller().roles).not.toContain('seller');
    });

    it('and the rejection reason reaches the user document', async () => {
        seedApprovedSeller();

        await post('reject-seller');

        expect(seller().serviceRegistrations.marketplace.rejectionReason)
            .toMatch(/policy violations/i);
    });
});
