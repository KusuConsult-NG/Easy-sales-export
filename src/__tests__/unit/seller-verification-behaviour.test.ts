/**
 * @jest-environment node
 */

/**
 * The seller KYC file, EXECUTED — submit, read, resubmit, badge, category.
 *
 * _mp_seller_verification.ts was at 36.5% statements. Four findings came out of
 * running it:
 *
 *   #114 grantSellerVerifiedBadgeAction and revokeSellerVerifiedBadgeAction
 *        wrote `isSellerVerified` and `sellerBadge`. NOTHING reads either field.
 *        The badge the storefront, the seller page, the admin table and every
 *        product card show is `isVerifiedBadge`, written by the admin module's
 *        toggleVerifiedBadgeAction and read by lib/seller-trust.ts. So granting
 *        here was invisible and — the half that matters — REVOKING HERE DID NOT
 *        REVOKE: the seller kept the trust mark an admin had just taken away.
 *
 *   #115 Three hand-written admin role lists in one file, two of them reading
 *        `session.user.roles` — the JWT — so a demoted admin kept the power
 *        until their token expired. The third re-read the user document, so the
 *        file disagreed with itself. Neither badge action recorded an audit row
 *        for granting or revoking a trust mark.
 *
 *   #116 updateSellerCategoryAction's `category: "wholesale" | "retail"` is
 *        TypeScript on a server action, erased at the wire. The value was
 *        written unchecked to the user document, the verification record and
 *        EVERY one of the seller's products, and the buyer catalogue filters on
 *        it — so one call removes a seller's entire catalogue from both views.
 *
 *   #117 resubmitSellerVerificationAction's direct-lookup branch loaded whatever
 *        `sellerVerificationId` pointed at without checking the record was the
 *        caller's, then wrote their bank details and address onto it and claimed
 *        its status.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
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

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => undefined),
}));

/** Stateful, so "cannot resubmit twice" cannot pass against a missing guard. */
let store: FakeDbHandle;
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    return { claimed: true, status: p.to };
}) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

const SELLER = 'seller-1';
const ADMIN = 'admin-1';

const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;
const USERS = COLLECTIONS.USERS;
const PRODUCTS = COLLECTIONS.PRODUCTS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

const auditLog = () => (globalThis as unknown as {
    mockCreateAdminAuditLog: jest.Mock<any>;
}).mockCreateAdminAuditLog;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(SELLER);
    store.seed(USERS, SELLER, { name: 'Ada', roles: ['general_user'] });
    store.seed(USERS, ADMIN, { name: 'Admin', roles: ['marketplace_admin'] });
});

const mod = () => import('@/app/actions/marketplace/_mp_seller_verification');

/** The shape the verify page posts. */
function form(over: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const fields: Record<string, string> = {
        phone: '+2348012345678',
        nin: '12345678901',
        bvn: '22222222222',
        accountNumber: '0123456789',
        bankName: 'GTBank',
        accountName: 'Ada Obi',
        bankCode: '058',
        address: '12 Market Road',
        city: 'Enugu',
        state: 'Enugu',
        lga: 'Enugu North',
        ...over,
    };
    for (const [k, v] of Object.entries(fields)) if (v !== '') fd.append(k, v);
    return fd;
}

/** The shape the onboarding page resubmits. */
const resubmitPayload = (over: Record<string, unknown> = {}) => ({
    phoneNumber: '+2348012345678',
    nin: '12345678901',
    bankAccount: { accountNumber: '0123456789', bankName: 'GTBank', accountName: 'Ada Obi', bankCode: '058' },
    address: { street: '12 Market Road', city: 'Enugu', state: 'Enugu', lga: 'Enugu North', country: 'Nigeria' },
    ...over,
});

const newestVerification = () => {
    const rows = store.all(VERIFICATIONS);
    return rows.length ? rows[rows.length - 1][1] as Record<string, any> : null;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('submitSellerVerificationAction', () => {
    const submit = async (fd = form()) =>
        (await (await mod()).submitSellerVerificationAction(null, fd)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await submit()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(VERIFICATIONS)).toBe(0);
    });

    it('accepts the field names the form actually sends', async () => {
        // The form posts "phone" and "address"; the record uses phoneNumber and
        // address.street. Both spellings are read.
        expect(await submit()).toMatchObject({ success: true });

        expect(newestVerification()).toMatchObject({
            userId: SELLER, status: 'pending', phoneVerified: false,
            phoneNumber: '+2348012345678',
            address: expect.objectContaining({ street: '12 Market Road', country: 'Nigeria' }),
        });
    });

    it.each([
        ['a short phone number', { phone: '12' }],
        ['a 9-digit account number', { accountNumber: '012345678' }],
        ['no bank code', { bankCode: '' }],
        ['no city', { city: '' }],
    ])('refuses %s', async (_label, over) => {
        expect(await submit(form(over))).toMatchObject({ success: false });
        expect(store.size(VERIFICATIONS)).toBe(0);
    });

    it('marks the user pending and links the record', async () => {
        await submit();

        const verificationId = store.all(VERIFICATIONS)[0][0];
        expect(store.get(USERS, SELLER)).toMatchObject({
            sellerVerificationStatus: 'pending',
            sellerVerificationId: verificationId,
        });
    });

    it('HASHES the identity numbers on the user record', async () => {
        // The readable BVN on the users table was the copy this replica made.
        // The reviewable original stays on the verification record.
        await submit();

        const user = store.get(USERS, SELLER) as Record<string, any>;
        expect(user.bvn).toBeTruthy();
        expect(user.bvn).not.toBe('22222222222');
        expect(user.nin).not.toBe('12345678901');
        expect(newestVerification()?.bvn).toBe('22222222222');
    });

    it('never claims an identity number was verified', async () => {
        // ninVerified/bvnVerified/cacVerified were set true from the presence of
        // the field, and admin/users renders each as a green "Verified" badge —
        // so the reviewer was told the identity was checked because the
        // applicant had filled the box in.
        await submit();

        const user = store.get(USERS, SELLER) as Record<string, any>;
        expect(user.ninVerified).toBeUndefined();
        expect(user.bvnVerified).toBeUndefined();
        expect(user.cacVerified).toBeUndefined();
    });

    it.each(['pending', 'approved'])('refuses a second application while one is %s', async (status) => {
        store.seed(VERIFICATIONS, 'ver-old', { userId: SELLER, status });

        expect(await submit()).toMatchObject({ success: false });
        expect(store.size(VERIFICATIONS)).toBe(1);
    });

    it('allows a fresh application after a rejection', async () => {
        store.seed(VERIFICATIONS, 'ver-old', { userId: SELLER, status: 'rejected' });

        expect(await submit()).toMatchObject({ success: true });
        expect(store.size(VERIFICATIONS)).toBe(2);
    });

    it('is not blocked by somebody else\'s pending application', async () => {
        store.seed(VERIFICATIONS, 'ver-other', { userId: 'another-seller', status: 'pending' });

        expect(await submit()).toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerVerificationAction', () => {
    const get = async () => (await (await mod()).getSellerVerificationAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await get()).toMatchObject({ success: false });
    });

    it('reports null rather than failing when there is nothing to report', async () => {
        expect(await get()).toMatchObject({ success: true, data: { verification: null } });
    });

    it('finds the record by the link on the user document', async () => {
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'approved' });
        store.seed(USERS, SELLER, { sellerVerificationId: 'ver-1' });

        const res = await get();
        expect(res.data.verification).toMatchObject({ id: 'ver-1', status: 'approved' });
    });

    it('falls back to a query, and takes the NEWEST record', async () => {
        store.seedAll(VERIFICATIONS, {
            old: { userId: SELLER, status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' },
            recent: { userId: SELLER, status: 'pending', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const res = await get();
        expect(res.data.verification).toMatchObject({ id: 'recent' });
    });

    it('never returns another user\'s verification', async () => {
        store.seed(VERIFICATIONS, 'ver-other', { userId: 'another-seller', status: 'approved' });

        expect(await get()).toMatchObject({ data: { verification: null } });
    });

    it('backfills the missing link it just had to query for', async () => {
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'pending' });

        await get();

        expect(store.get(USERS, SELLER)?.sellerVerificationId).toBe('ver-1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resubmitSellerVerificationAction', () => {
    const resubmit = async (payload: unknown = resubmitPayload()) =>
        (await (await mod()).resubmitSellerVerificationAction(payload)) as any;

    beforeEach(() => {
        store.seed(VERIFICATIONS, 'ver-1', {
            userId: SELLER, status: 'rejected',
            rejectionReason: 'The account name does not match the CAC document.',
            reviewedBy: ADMIN, reviewedAt: '2026-05-01T00:00:00.000Z',
            phoneNumber: '+2348000000000',
        });
        store.seed(USERS, SELLER, { sellerVerificationId: 'ver-1' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await resubmit()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses a payload that does not validate', async () => {
        expect(await resubmit(resubmitPayload({ phoneNumber: '1' }))).toMatchObject({ success: false });
        expect(store.get(VERIFICATIONS, 'ver-1')?.status).toBe('rejected');
    });

    it('refuses when there is no record at all', async () => {
        store.clear();
        store.seed(USERS, SELLER, {});

        expect(await resubmit()).toMatchObject({ success: false, error: 'No verification record found to resubmit.' });
    });

    it.each(['pending', 'approved'])('refuses to resubmit a %s verification', async (status) => {
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status });

        const res = await resubmit();
        expect(res.success).toBe(false);
        expect(res.error).toContain(status);
    });

    // ── #117 ────────────────────────────────────────────────────────────────
    it('REFUSES A RECORD THAT BELONGS TO SOMEBODY ELSE', async () => {
        // The direct-lookup branch trusted the pointer on the user document.
        // The update then wrote `userId` onto that record — adopting it — with
        // this caller's bank details and address.
        store.seed(VERIFICATIONS, 'ver-1', {
            userId: 'another-seller', status: 'rejected', phoneNumber: '+2349999999999',
        });

        expect(await resubmit()).toMatchObject({ success: false });

        const stolen = store.get(VERIFICATIONS, 'ver-1') as Record<string, any>;
        expect(stolen.userId).toBe('another-seller');
        expect(stolen.status).toBe('rejected');
        expect(stolen.phoneNumber).toBe('+2349999999999');
    });

    it('resubmits, moving the record back to pending', async () => {
        expect(await resubmit()).toMatchObject({ success: true, data: { verificationId: 'ver-1' } });

        expect(store.get(VERIFICATIONS, 'ver-1')).toMatchObject({
            status: 'pending', userId: SELLER, phoneNumber: '+2348012345678',
        });
    });

    it('KEEPS THE REJECTION IT IS ANSWERING', async () => {
        // This wrote rejectionReason: null and overwrote the submitted fields in
        // place, so why the application was refused — and what it said when it
        // was — was destroyed by the resubmission.
        await resubmit();

        expect(store.get(VERIFICATIONS, 'ver-1')?.previousRejection).toMatchObject({
            reason: 'The account name does not match the CAC document.',
            rejectedBy: ADMIN,
            rejectedAt: '2026-05-01T00:00:00.000Z',
        });
        expect(store.get(VERIFICATIONS, 'ver-1')?.rejectionReason).toBeNull();
    });

    it('counts the resubmissions', async () => {
        await resubmit();
        expect(store.get(VERIFICATIONS, 'ver-1')?.resubmissionCount).toBe(1);

        store.seed(VERIFICATIONS, 'ver-1', { ...store.get(VERIFICATIONS, 'ver-1'), status: 'rejected' });
        await resubmit();
        expect(store.get(VERIFICATIONS, 'ver-1')?.resubmissionCount).toBe(2);
    });

    it('cannot be resubmitted twice on one rejection', async () => {
        expect((await resubmit()).success).toBe(true);
        expect((await resubmit()).success).toBe(false);
    });

    it('puts the user back in the pending state', async () => {
        await resubmit();

        expect(store.get(USERS, SELLER)).toMatchObject({
            sellerVerificationStatus: 'pending', sellerVerificationId: 'ver-1',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the verified badge', () => {
    const grant = async (id = SELLER) => (await (await mod()).grantSellerVerifiedBadgeAction(id)) as any;
    const revoke = async (id = SELLER) => (await (await mod()).revokeSellerVerifiedBadgeAction(id)) as any;

    beforeEach(() => {
        actAs(ADMIN, ['marketplace_admin']);
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'approved' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await grant()).toMatchObject({ success: false });
    });

    // ── #115 ────────────────────────────────────────────────────────────────
    it('refuses an ordinary user', async () => {
        actAs(SELLER);
        expect(await grant()).toMatchObject({ success: false });
        expect(store.get(USERS, SELLER)?.isVerifiedBadge).toBeUndefined();
    });

    it('READS THE ROLES LIVE, not from the session', async () => {
        // Both gates tested session.user.roles, so an admin demoted an hour ago
        // kept the power until their JWT expired.
        actAs(ADMIN, ['super_admin']);                       // the token still says admin
        store.seed(USERS, ADMIN, { roles: ['general_user'] }); // the record says otherwise

        expect(await grant()).toMatchObject({ success: false });
        expect(store.get(USERS, SELLER)?.isVerifiedBadge).toBeUndefined();
    });

    it('refuses a seller who does not exist', async () => {
        expect(await grant('nobody')).toMatchObject({ success: false, error: 'Seller not found' });
    });

    // ── #114 ────────────────────────────────────────────────────────────────
    it('WRITES THE FIELD THE APPLICATION READS', async () => {
        // These wrote isSellerVerified/sellerBadge, which nothing reads. The
        // badge every surface displays is isVerifiedBadge — see seller-trust.ts.
        expect(await grant()).toMatchObject({ success: true });

        expect(store.get(USERS, SELLER)?.isVerifiedBadge).toBe(true);
        expect(store.get(VERIFICATIONS, 'ver-1')).toMatchObject({
            isVerifiedBadge: true, badgeGrantedBy: ADMIN,
        });
    });

    it('AND REVOKING ACTUALLY REVOKES IT', async () => {
        // The half that matters: revoking wrote isSellerVerified: false and left
        // isVerifiedBadge true, so the seller kept the trust mark an admin had
        // just taken away.
        await grant();
        expect(await revoke()).toMatchObject({ success: true });

        expect(store.get(USERS, SELLER)?.isVerifiedBadge).toBe(false);
        expect(store.get(VERIFICATIONS, 'ver-1')?.isVerifiedBadge).toBe(false);
    });

    it('records both decisions in the audit log', async () => {
        await grant();
        await revoke();

        expect(auditLog()).toHaveBeenCalledWith(expect.objectContaining({
            action: 'seller_badge_grant', userId: ADMIN, targetId: SELLER,
        }));
        expect(auditLog()).toHaveBeenCalledWith(expect.objectContaining({
            action: 'seller_badge_revoke', userId: ADMIN, targetId: SELLER,
        }));
    });

    // ── #118 ────────────────────────────────────────────────────────────────
    it('IS GATED ON THE MARKETPLACE PERMISSION, WHICH THE LIVE PATH ALSO USES NOW', async () => {
        // The live badge toggle — admin/_marketplace.ts, the one the seller
        // screen's Grant/Revoke button calls — required "users:update", held by
        // super_admin and admin alone. marketplace_admin does not have it, yet
        // /admin/marketplace/sellers is a route marketplace_admin is explicitly
        // allowed to reach, and the approve action beside the button uses
        // "marketplace:approve_sellers". So the role that owns the screen could
        // approve the seller and never grant the badge.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/admin/_marketplace.ts'), 'utf8'),
            { label: 'admin/_marketplace.ts' },
        );
        const start = src.indexOf('async function _toggleVerifiedBadgeAction');
        expect(start).toBeGreaterThan(-1);
        const toggle = src.slice(start, src.indexOf('newBadgeState', start));
        expect(toggle).toContain('hasAdminPermission');

        expect(toggle).toContain('marketplace:approve_sellers');
        expect(toggle).not.toContain('users:update');

        // And the role in question is actually granted it.
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        expect(hasAdminPermission(['marketplace_admin'], 'marketplace:approve_sellers')).toBe(true);
        expect(hasAdminPermission(['marketplace_admin'], 'users:update')).toBe(false);
        // Without widening it to anybody else.
        for (const role of ['moderator', 'support', 'academy_admin', 'export_admin', 'wave_admin']) {
            expect(hasAdminPermission([role], 'marketplace:approve_sellers')).toBe(false);
        }
    });

    it('still succeeds for a seller with no verification record', async () => {
        store.clear();
        store.seed(USERS, SELLER, {});
        store.seed(USERS, ADMIN, { roles: ['marketplace_admin'] });

        expect(await grant()).toMatchObject({ success: true });
        expect(store.get(USERS, SELLER)?.isVerifiedBadge).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateSellerCategoryAction', () => {
    const update = async (sellerId = SELLER, category: any = 'wholesale') =>
        (await (await mod()).updateSellerCategoryAction(sellerId, category)) as any;

    beforeEach(() => {
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'approved' });
        store.seedAll(PRODUCTS, {
            'p1': { sellerId: SELLER, title: 'Cocoa', sellerCategory: 'retail' },
            'p2': { sellerId: SELLER, title: 'Yams', sellerCategory: 'retail' },
            'p3': { sellerId: 'another-seller', title: 'Rice', sellerCategory: 'retail' },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await update()).toMatchObject({ success: false });
    });

    // ── #116 ────────────────────────────────────────────────────────────────
    it.each(['', 'WHOLESALE', 'bulk', 'wholesale ', null, 42])(
        'REFUSES THE CATEGORY %p', async (category) => {
            // The union is TypeScript on a server action and is erased at the
            // wire. This value reaches the user record, the verification record
            // and every product, and the buyer catalogue filters on it — so an
            // unrecognised string hides the seller's whole catalogue from both
            // the wholesale and the retail view at once.
            const res = await update(SELLER, category);

            expect(res.success).toBe(false);
            expect(String(res.error)).toMatch(/invalid seller category/i);
            expect(store.get(USERS, SELLER)?.sellerCategory).toBeUndefined();
            expect(store.get(PRODUCTS, 'p1')?.sellerCategory).toBe('retail');
        });

    it('refuses a call that omits the category entirely', async () => {
        const res = await (await mod()).updateSellerCategoryAction(SELLER, undefined as never) as any;

        expect(res.success).toBe(false);
        expect(store.get(PRODUCTS, 'p1')?.sellerCategory).toBe('retail');
    });

    it('refuses an ordinary user acting on another seller', async () => {
        actAs('meddler-1');
        store.seed(USERS, 'meddler-1', { roles: ['general_user'] });

        expect(await update()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(PRODUCTS, 'p1')?.sellerCategory).toBe('retail');
    });

    it('refuses an admin role without the marketplace seller permission', async () => {
        actAs('academy-1');
        store.seed(USERS, 'academy-1', { roles: ['academy_admin'] });

        expect(await update()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it.each(['wholesale', 'retail'])('lets the seller set their own category to %s', async (category) => {
        actAs(SELLER);

        expect(await update(SELLER, category)).toMatchObject({ success: true });
        expect(store.get(USERS, SELLER)?.sellerCategory).toBe(category);
    });

    it('lets a marketplace admin set it', async () => {
        actAs(ADMIN, ['marketplace_admin']);
        expect(await update()).toMatchObject({ success: true });
        expect(store.get(USERS, SELLER)?.sellerCategory).toBe('wholesale');
    });

    it('denormalises onto the verification record and the seller\'s products only', async () => {
        actAs(SELLER);
        await update();

        expect(store.get(VERIFICATIONS, 'ver-1')?.sellerCategory).toBe('wholesale');
        expect(store.get(PRODUCTS, 'p1')?.sellerCategory).toBe('wholesale');
        expect(store.get(PRODUCTS, 'p2')?.sellerCategory).toBe('wholesale');
        expect(store.get(PRODUCTS, 'p3')?.sellerCategory).toBe('retail');
    });

    it('succeeds for a seller with no products and no verification record', async () => {
        store.clear();
        store.seed(USERS, SELLER, {});
        actAs(SELLER);

        expect(await update()).toMatchObject({ success: true });
        expect(store.get(USERS, SELLER)?.sellerCategory).toBe('wholesale');
    });
});
