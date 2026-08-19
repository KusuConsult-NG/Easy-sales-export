/**
 * @jest-environment node
 */

/**
 * The marketplace admin desk, EXECUTED — seller approval, the verified badge,
 * buyer approval and product moderation.
 *
 * At 8.2%. Four of the actions here are authorisation boundaries: approving a
 * seller grants the `seller` role and writes the registration
 * marketplace/seller/layout.tsx redirects on, and product review decides what is
 * on the public catalogue.
 *
 * THREE RECORDED DEFECTS LIVE IN THIS FILE
 * ----------------------------------------
 *   - the approval wrote `serviceRegistrations.marketplace.status: "active"`
 *     while every reader tests for "approved" — including the seller layout,
 *     which redirects to onboarding when it is anything else. An approved seller
 *     locked out of their own dashboard.
 *   - approveMarketplaceUser and rejectMarketplaceUser were gated on isAdmin(),
 *     which is true for EVERY admin role, so an academy_admin could approve a
 *     marketplace buyer.
 *   - reviewProduct was the same: an export_admin could publish a product to the
 *     public catalogue.
 *
 * All three are claims about a stored value or about which roles get through, and
 * both kinds need a store to check.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

/**
 * The product state machine goes through the Postgres CAS function, which the
 * fake deliberately does not implement — see KNOWN_DIVERGENCES. Mocked here so
 * the ACTION's own decisions are testable: which statuses it accepts a move
 * from, what it writes into the patch, and what it does with a refusal.
 */
const claimStatusTransitionFromAny = jest.fn(async (_args: unknown) =>
    ({ claimed: true, status: 'pending', exists: true } as {
        claimed: boolean; status: string | null; exists?: boolean;
    }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: unknown) => claimStatusTransitionFromAny(args),
    claimStatusTransition: (args: unknown) => claimStatusTransitionFromAny(args),
}));

let store: FakeDbHandle;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    claimStatusTransitionFromAny.mockImplementation(async () =>
        ({ claimed: true, status: 'pending', exists: true }));
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/admin/_marketplace');
}

const VERIFICATION = 'ver-1';
const SELLER = 'seller-1';

function seedVerification(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION, {
        userId: SELLER,
        status: 'pending',
        businessName: 'Ada Farms',
        email: 'ada@example.com',
        phoneNumber: '08031111111',
        accountType: 'wholesale',
        ...extra,
    });
}

function seedSeller(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, SELLER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        ...extra,
    });
}

// ─── seller approval ─────────────────────────────────────────────────────────

describe('approving a seller verification', () => {
    beforeEach(() => {
        seedVerification();
        seedSeller();
    });

    it('marks the verification approved and records the reviewer', async () => {
        const { approveSellerVerificationAction } = await actions();
        const result = await approveSellerVerificationAction(VERIFICATION);

        expect(result.success).toBe(true);
        const ver = store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!;
        expect(ver.status).toBe('approved');
        expect(ver.verifiedBy).toBe('admin-1');
    });

    it('writes "approved" — NOT "active" — as the registration status', async () => {
        // THE defect. Every reader tests for "approved":
        // marketplace/seller/layout.tsx redirects to /onboarding when
        // `registration.status !== "approved"`. Writing "active" here approved a
        // seller and then locked them out of their own dashboard.
        const { approveSellerVerificationAction } = await actions();
        await approveSellerVerificationAction(VERIFICATION);

        const user = store.get(COLLECTIONS.USERS, SELLER)!;
        expect(user.serviceRegistrations.marketplace.status).toBe('approved');
        expect(user.serviceRegistrations.marketplace.status).not.toBe('active');
    });

    it('and grants the seller role with the rest of the profile', async () => {
        const { approveSellerVerificationAction } = await actions();
        await approveSellerVerificationAction(VERIFICATION);

        const user = store.get(COLLECTIONS.USERS, SELLER)!;
        expect(user.roles).toContain('seller');
        expect(user.isVerified).toBe(true);
        expect(user.sellerVerificationStatus).toBe('approved');
        expect(user.sellerVerificationId).toBe(VERIFICATION);
        expect(user.serviceRegistrations.marketplace.accountType).toBe('wholesale');
        expect(user.verificationProfile.status).toBe('approved');
    });

    it('copying the bank details onto the profile, which is where payouts read them', async () => {
        // The seller supplied them once, during verification. A payout path
        // reading user.bankDetails finds nothing unless they are replicated.
        seedVerification({
            bankAccount: {
                accountNumber: '0123456789',
                bankName: 'Zenith',
                accountName: 'Ada Obi',
                bankCode: '057',
            },
        });

        const { approveSellerVerificationAction } = await actions();
        await approveSellerVerificationAction(VERIFICATION);

        expect(store.get(COLLECTIONS.USERS, SELLER)!.bankDetails).toMatchObject({
            accountNumber: '0123456789', bankName: 'Zenith', bankCode: '057',
        });
    });

    it('and the address, without inventing one when the verification has none', async () => {
        // The spread is conditional. An unconditional one would write an address
        // of empty strings over whatever the member already had.
        const { approveSellerVerificationAction } = await actions();
        await approveSellerVerificationAction(VERIFICATION);
        expect(store.get(COLLECTIONS.USERS, SELLER)!.address).toBeUndefined();

        store.clear();
        seedSeller();
        seedVerification({ location: { address: '1 Market Road', state: 'Lagos', lga: 'Ikeja' } });
        await approveSellerVerificationAction(VERIFICATION);

        const user = store.get(COLLECTIONS.USERS, SELLER)!;
        expect(user.address).toMatchObject({ street: '1 Market Road', state: 'Lagos', lga: 'Ikeja' });
        expect(user.stateOfOrigin).toBe('Lagos');
    });

    it('refusing a verification that does not exist', async () => {
        const { approveSellerVerificationAction } = await actions();
        const result = await approveSellerVerificationAction('no-such-verification');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
        expect(store.get(COLLECTIONS.USERS, SELLER)!.roles).not.toContain('seller');
    });

    it('and one with no userId, rather than granting a role to nobody', async () => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'orphan', { status: 'pending' });

        const { approveSellerVerificationAction } = await actions();
        const result = await approveSellerVerificationAction('orphan');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Missing User ID/i);
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, 'orphan')!.status).toBe('pending');
    });
});

// ─── the verified badge ──────────────────────────────────────────────────────

describe('the verified badge', () => {
    beforeEach(() => {
        seedVerification();
        seedSeller();
    });

    it('toggles on, and syncs onto the seller’s profile', async () => {
        // Two documents, one truth. The storefront reads the badge from the USER
        // record, so writing it only onto the verification grants a badge nobody
        // ever sees.
        const { toggleVerifiedBadgeAction } = await actions();
        const result = await toggleVerifiedBadgeAction(VERIFICATION);

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!.isVerifiedBadge).toBe(true);
        expect(store.get(COLLECTIONS.USERS, SELLER)!.isVerifiedBadge).toBe(true);
    });

    it('and off again, clearing the grant timestamp', async () => {
        const { toggleVerifiedBadgeAction } = await actions();
        await toggleVerifiedBadgeAction(VERIFICATION);
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!.badgeGrantedAt).toBeTruthy();

        await toggleVerifiedBadgeAction(VERIFICATION);

        const ver = store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!;
        expect(ver.isVerifiedBadge).toBe(false);
        expect(ver.badgeGrantedAt).toBeNull();
        expect(store.get(COLLECTIONS.USERS, SELLER)!.isVerifiedBadge).toBe(false);
    });

    it('recording who granted it', async () => {
        actAs('admin-55', ['super_admin']);
        const { toggleVerifiedBadgeAction } = await actions();
        await toggleVerifiedBadgeAction(VERIFICATION);

        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!.badgeGrantedBy)
            .toBe('admin-55');
    });

    it('and refusing a record that does not exist', async () => {
        const { toggleVerifiedBadgeAction } = await actions();
        const result = await toggleVerifiedBadgeAction('nope');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
    });

    it('a verification with no userId toggles the badge without erroring', async () => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'no-user', { status: 'approved' });

        const { toggleVerifiedBadgeAction } = await actions();
        const result = await toggleVerifiedBadgeAction('no-user');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, 'no-user')!.isVerifiedBadge).toBe(true);
    });
});

// ─── buyer approval, and the permission that used to be isAdmin() ────────────

describe('approving and rejecting a marketplace buyer', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, 'buyer-1', { email: 'b@example.com', status: 'pending' });
    });

    it('approval sets the account active', async () => {
        const { approveMarketplaceUserAction } = await actions();
        const result = await approveMarketplaceUserAction('buyer-1');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, 'buyer-1')!.status).toBe('active');
    });

    it('rejection records the reason', async () => {
        const { rejectMarketplaceUserAction } = await actions();
        const result = await rejectMarketplaceUserAction({
            userId: 'buyer-1', reason: 'Duplicate account',
        });

        expect(result.success).toBe(true);
        const user = store.get(COLLECTIONS.USERS, 'buyer-1')!;
        expect(user.status).toBe('rejected');
        expect(user.rejectionReason).toBe('Duplicate account');
    });

    it('and an admin of ANOTHER module cannot do either', async () => {
        // THE defect. isAdmin() is true for every admin role, so an academy_admin
        // could approve a marketplace buyer. The matrix grants
        // marketplace:approve_sellers to super_admin, admin and marketplace_admin.
        const { hasAdminPermission, isAdmin } = await import('@/lib/admin-permissions');
        expect(isAdmin(['academy_admin'])).toBe(true);
        expect(hasAdminPermission(['academy_admin'], 'marketplace:approve_sellers')).toBe(false);

        actAs('academy-admin', ['academy_admin']);
        const a = await actions();

        expect((await a.approveMarketplaceUserAction('buyer-1')).success).toBe(false);
        expect((await a.rejectMarketplaceUserAction({ userId: 'buyer-1', reason: 'x' })).success)
            .toBe(false);
        expect(store.get(COLLECTIONS.USERS, 'buyer-1')!.status).toBe('pending');
    });

    it('while a marketplace_admin can, so the refusal is not vacuous', async () => {
        actAs('mp-admin', ['marketplace_admin']);
        const { approveMarketplaceUserAction } = await actions();

        expect((await approveMarketplaceUserAction('buyer-1')).success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, 'buyer-1')!.status).toBe('active');
    });
});

// ─── product moderation ──────────────────────────────────────────────────────

describe('reviewing a product', () => {
    it('approving moves it to active', async () => {
        const { reviewProductAction } = await actions();
        const result = await reviewProductAction({ productId: 'p1', action: 'approve' });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ status: 'active' });
    });

    it('and clears any previous rejection reason', async () => {
        // A product approved after a rejection must not keep the old reason —
        // the seller's page renders it.
        const { reviewProductAction } = await actions();
        await reviewProductAction({ productId: 'p1', action: 'approve' });

        const [[args]] = claimStatusTransitionFromAny.mock.calls as unknown as [[{
            patch: Record<string, unknown>; to: string; fromAny: string[];
        }]];
        expect(args.to).toBe('active');
        expect(args.patch.rejectionReason).toBeNull();
        expect(args.patch.reviewedBy).toBe('admin-1');
    });

    it('rejecting and suspending demand a reason of at least five characters', async () => {
        // A dead listing with no explanation leaves the seller nothing to fix.
        const { reviewProductAction } = await actions();

        for (const action of ['reject', 'suspend'] as const) {
            const result = await reviewProductAction({ productId: 'p1', action, reason: 'bad' });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/at least 5 characters/i);
        }
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('and carry the reason through when it is long enough', async () => {
        const { reviewProductAction } = await actions();
        const result = await reviewProductAction({
            productId: 'p1', action: 'reject', reason: 'Photographs do not match the description',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ status: 'rejected' });
        const [[args]] = claimStatusTransitionFromAny.mock.calls as unknown as [[{
            patch: Record<string, unknown>;
        }]];
        expect(args.patch.rejectionReason).toBe('Photographs do not match the description');
    });

    it('approving and rejecting start from DIFFERENT states', async () => {
        // A product cannot be approved from every state, and cannot be rejected
        // from every state. Sharing one list would let a rejected product be
        // rejected again, or an active one be approved out of nowhere.
        const { reviewProductAction } = await actions();

        await reviewProductAction({ productId: 'p1', action: 'approve' });
        const approveFrom = (claimStatusTransitionFromAny.mock.calls[0][0] as { fromAny: string[] }).fromAny;

        claimStatusTransitionFromAny.mockClear();
        await reviewProductAction({ productId: 'p1', action: 'reject', reason: 'A long enough reason' });
        const rejectFrom = (claimStatusTransitionFromAny.mock.calls[0][0] as { fromAny: string[] }).fromAny;

        expect(approveFrom.length).toBeGreaterThan(0);
        expect(rejectFrom.length).toBeGreaterThan(0);
        expect(approveFrom).not.toEqual(rejectFrom);
    });

    it('refusing an empty product id', async () => {
        const { reviewProductAction } = await actions();
        const result = await reviewProductAction({ productId: '   ', action: 'approve' });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/product id is required/i);
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('and an unknown action', async () => {
        const { reviewProductAction } = await actions();
        const result = await reviewProductAction({
            productId: 'p1', action: 'delete' as never, reason: 'A long enough reason',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unknown review action/i);
    });

    it('telling the admin WHICH state blocked the move, when the claim fails', async () => {
        // "Could not review" tells nobody anything. The current status is what
        // explains why the button did nothing.
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'archived', exists: true }));

        const { reviewProductAction } = await actions();
        const result = await reviewProductAction({ productId: 'p1', action: 'approve' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('archived');
    });

    it('distinguishing a missing product from one with no status recorded', async () => {
        // Both come back as a null status from the CAS. They are different
        // problems and an admin needs to be told which.
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: false }));
        const { reviewProductAction } = await actions();
        expect((await reviewProductAction({ productId: 'p1', action: 'approve' })).error)
            .toMatch(/not found/i);

        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: null, exists: true }));
        expect((await reviewProductAction({ productId: 'p1', action: 'approve' })).error)
            .toMatch(/no status recorded/i);
    });

    it('and an admin of another module cannot publish to the catalogue', async () => {
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        expect(hasAdminPermission(['export_admin'], 'content:approve')).toBe(false);

        actAs('export-admin', ['export_admin']);
        const { reviewProductAction } = await actions();

        const result = await reviewProductAction({ productId: 'p1', action: 'approve' });
        expect(result.success).toBe(false);
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });

    it('while a moderator can, so the refusal is not vacuous', async () => {
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        expect(hasAdminPermission(['moderator'], 'content:approve')).toBe(true);

        actAs('mod', ['moderator']);
        const { reviewProductAction } = await actions();

        expect((await reviewProductAction({ productId: 'p1', action: 'approve' })).success).toBe(true);
    });
});

// ─── the stats tile ──────────────────────────────────────────────────────────

describe('the seller stats tile', () => {
    it('counts the verifications by status', async () => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            a: { status: 'pending' },
            b: { status: 'pending' },
            c: { status: 'approved' },
            d: { status: 'rejected' },
            e: { status: 'under_review' },
        });

        const { getAdminSellerStatsAction } = await actions();
        const result = await getAdminSellerStatsAction();

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ total: 5, pending: 2, approved: 1, rejected: 1 });
    });

    it('and the parts do not have to add up to the total, which is worth knowing', async () => {
        // total counts EVERY verification; the three named statuses do not cover
        // the vocabulary. "under_review" is in neither bucket, so an admin reading
        // the tile sees a total larger than the three columns — that is the tile's
        // real behaviour, not an arithmetic error to chase.
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            a: { status: 'under_review' }, b: { status: 'approved' },
        });

        const { getAdminSellerStatsAction } = await actions();
        const { data } = await getAdminSellerStatsAction();

        expect(data!.total).toBe(2);
        expect(data!.pending + data!.approved + data!.rejected).toBe(1);
    });

    it('refusing a non-admin', async () => {
        actAs('nobody', ['user']);
        const { getAdminSellerStatsAction } = await actions();
        expect((await getAdminSellerStatsAction()).success).toBe(false);
    });
});

// ─── the guards, once, across every write ────────────────────────────────────

describe('every write refuses an unauthenticated caller', () => {
    beforeEach(() => {
        seedVerification();
        seedSeller();
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));
    });

    it('and writes nothing at all', async () => {
        const a = await actions();

        expect((await a.approveSellerVerificationAction(VERIFICATION)).success).toBe(false);
        expect((await a.toggleVerifiedBadgeAction(VERIFICATION)).success).toBe(false);
        expect((await a.approveMarketplaceUserAction(SELLER)).success).toBe(false);
        expect((await a.reviewProductAction({ productId: 'p1', action: 'approve' })).success)
            .toBe(false);

        expect(store.get(COLLECTIONS.SELLER_VERIFICATIONS, VERIFICATION)!.status).toBe('pending');
        expect(store.get(COLLECTIONS.USERS, SELLER)!.roles).not.toContain('seller');
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });
});

// ─── the three list views ────────────────────────────────────────────────────

describe('the seller verification list', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            v1: { status: 'pending', userId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
            v2: { status: 'approved', userId: 'u2', createdAt: '2026-02-01T00:00:00.000Z' },
            v3: { status: 'rejected', userId: 'u3', createdAt: '2026-03-01T00:00:00.000Z' },
            v4: { status: 'suspended', userId: 'u4', createdAt: '2026-04-01T00:00:00.000Z' },
        });
    });

    it('returns everything with no filter', async () => {
        const { getStandardSellerVerificationsAction } = await actions();
        const result = await getStandardSellerVerificationsAction('all');
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(4);
    });

    it('and narrows to one status', async () => {
        const { getStandardSellerVerificationsAction } = await actions();
        for (const status of ['pending', 'approved', 'rejected', 'suspended'] as const) {
            const result = await getStandardSellerVerificationsAction(status);
            expect(result.data).toHaveLength(1);
            expect(result.data![0].status).toBe(status);
        }
    });

    it('honouring a limit', async () => {
        const { getStandardSellerVerificationsAction } = await actions();
        const result = await getStandardSellerVerificationsAction('all', undefined, 2);
        expect(result.data!.length).toBeLessThanOrEqual(2);
    });

    it('and refusing a non-admin', async () => {
        actAs('nobody', ['user']);
        const { getStandardSellerVerificationsAction } = await actions();
        expect((await getStandardSellerVerificationsAction('all')).success).toBe(false);
    });
});

describe('the marketplace user list', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            buyerNew: { roles: ['marketplace_buyer'], email: 'a@x.com', createdAt: '2026-01-01T00:00:00.000Z' },
            buyerOld: { roles: ['buyer'], email: 'b@x.com', createdAt: '2026-02-01T00:00:00.000Z' },
            seller: { roles: ['seller'], email: 'c@x.com', createdAt: '2026-03-01T00:00:00.000Z' },
            both: { roles: ['buyer', 'seller'], email: 'd@x.com', createdAt: '2026-04-01T00:00:00.000Z' },
            unrelated: { roles: ['wave_participant'], email: 'e@x.com', createdAt: '2026-05-01T00:00:00.000Z' },
        });
    });

    it('includes BOTH buyer spellings, and excludes anyone unrelated', async () => {
        // marketplace_buyer is what new registrations write and `buyer` is the
        // legacy value. A query on one alone loses half the buyers — the same
        // shape as the audience that queried a field nothing writes.
        const { getMarketplaceUsersAction } = await actions();
        const result = await getMarketplaceUsersAction({});

        expect(result.success).toBe(true);
        const ids = (result.data as { id: string }[]).map((u) => u.id).sort();
        expect(ids).toEqual(['both', 'buyerNew', 'buyerOld', 'seller']);
        expect(ids).not.toContain('unrelated');
    });

    it('and refuses a non-admin', async () => {
        actAs('nobody', ['user']);
        const { getMarketplaceUsersAction } = await actions();
        expect((await getMarketplaceUsersAction({})).success).toBe(false);
    });
});

describe('the product moderation queue', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.PRODUCTS, {
            p1: { status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' },
            p2: { status: 'pending', createdAt: '2026-02-01T00:00:00.000Z' },
            p3: { status: 'active', createdAt: '2026-03-01T00:00:00.000Z' },
            p4: { status: 'rejected', createdAt: '2026-04-01T00:00:00.000Z' },
            p5: { status: 'suspended', createdAt: '2026-05-01T00:00:00.000Z' },
            p6: { status: 'draft', createdAt: '2026-06-01T00:00:00.000Z' },
        });
    });

    it('counts the whole backlog server-side, not the length of one page', async () => {
        // The mistake #37 and the WAVE admin list both made: a "total" that is
        // really the size of the current page, so a backlog of 400 reads as 25.
        const { getAdminProductsAction } = await actions();
        const result = await getAdminProductsAction({ limitCount: 1 });

        expect(result.success).toBe(true);
        expect(result.data!.products).toHaveLength(1);
        expect(result.data!.stats).toEqual({
            pending: 2, active: 1, rejected: 1, suspended: 1, draft: 1,
        });
    });

    it('filters to one status', async () => {
        const { getAdminProductsAction } = await actions();
        const result = await getAdminProductsAction({ status: 'pending' });
        expect(result.data!.products).toHaveLength(2);
    });

    it('and reports hasMore honestly', async () => {
        const { getAdminProductsAction } = await actions();

        const page = await getAdminProductsAction({ limitCount: 2 });
        expect(page.data!.products).toHaveLength(2);
        expect(page.data!.hasMore).toBe(true);

        const all = await getAdminProductsAction({ limitCount: 100 });
        expect(all.data!.hasMore).toBe(false);
    });

    it('clamping the page size rather than trusting the caller', async () => {
        // A caller asking for 100,000 rows is a caller who can take the admin
        // list down. Clamped to 100, and up to 1.
        const { getAdminProductsAction } = await actions();

        const huge = await getAdminProductsAction({ limitCount: 100_000 });
        expect(huge.data!.products.length).toBeLessThanOrEqual(100);

        const zero = await getAdminProductsAction({ limitCount: 0 });
        expect(zero.success).toBe(true);
        expect(zero.data!.products.length).toBeGreaterThanOrEqual(1);
    });

    it('and a READ is open to every admin role, unlike the write', async () => {
        // Deliberate asymmetry, and worth pinning as one: narrowing the read to
        // content:approve would blind marketplace_admin to its own backlog, while
        // the WRITE is narrowed precisely so another module's admin cannot publish.
        actAs('academy-admin', ['academy_admin']);
        const { getAdminProductsAction, reviewProductAction } = await actions();

        expect((await getAdminProductsAction({})).success).toBe(true);
        expect((await reviewProductAction({ productId: 'p1', action: 'approve' })).success)
            .toBe(false);
    });
});
