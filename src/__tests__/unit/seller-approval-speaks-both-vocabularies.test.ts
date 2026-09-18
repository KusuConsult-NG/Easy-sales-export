/**
 * @jest-environment node
 */

/**
 * SELLERS COULD NOT EDIT THEIR PRODUCTS.
 *
 * Two independent causes, both executed against the real action before the fix.
 * Reported symptom: the marketplace screens tell a seller they are approved and
 * the product screens refuse them, from the same user document.
 *
 * CAUSE 1 — THE ROLE. `marketplace_seller` is a first-class role in
 * lib/types/roles.ts, commented there as "(new standardized role)", with a
 * hierarchy entry and a display name. admin/_marketplace.ts accepts both
 * spellings — `roles.includes("seller") || roles.includes("marketplace_seller")`
 * — and so does cms.ts. The gates deciding who may LIST or EDIT a product asked
 * for the literal "seller" alone, so a marketplace_seller was told
 * "You must have seller role to update products".
 *
 * CAUSE 2 — THE APPROVAL. marketplace/_mp_onboarding.ts heals a seller whose
 * approval lives on their SELLER_VERIFICATIONS document by writing
 *
 *     "serviceRegistrations.marketplace.status": "approved"
 *     "serviceRegistrations.marketplace.accountType": accountType
 *
 * and NOTHING ELSE — no `sellerVerificationStatus`, no `seller` role. The
 * product gates read exactly those two. `serviceRegistrations[module].status` is
 * the vocabulary the platform settled on; module-access-check.ts reads it for
 * every module's access decision and grants the module role from it when the
 * roles array has not caught up. The product gates never learned it.
 *
 * SIX GATES ASK THIS ONE QUESTION and spelled it three ways:
 *
 *     _mp_products create      hasRole(…, "seller") + sellerVerificationStatus
 *     _mp_products update      hasRole(…, "seller") + sellerVerificationStatus
 *     api/marketplace/create-product          sellerVerificationStatus
 *     village-market                          sellerVerificationStatus
 *     order-management         hasRole(…, "seller")
 *     admin/_marketplace       BOTH role spellings — the one that was right
 *
 * lib/seller-approval.ts is now the single answer, and these tests drive the
 * real actions rather than the predicate alone.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    SELLER_ROLES,
    holdsSellerRole,
    isSellerApproved,
    registrationSaysSeller,
    sellerRefusalReason,
} from '@/lib/seller-approval';
import { ALL_USER_ROLES } from '@/lib/types/roles';

jest.mock('@/lib/redis', () => ({
    redis: null, getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, CACHE_TTL: {},
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));
jest.mock('@/lib/audit-log', () => ({
    ...(jest.requireActual('@/lib/audit-log') as object),
    logAuditAction: jest.fn(async () => undefined),
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

declare const global: any;
let store: FakeDbHandle;

/** The three shapes an approved seller actually has in this database. */
const OLD_VOCABULARY = { roles: ['seller'], sellerVerificationStatus: 'approved' };
const NEW_ROLE = { roles: ['marketplace_seller'], sellerVerificationStatus: 'approved' };
const HEALED_BY_ONBOARDING = {
    roles: ['general_user'],
    serviceRegistrations: { marketplace: { status: 'approved', accountType: 'seller' } },
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 's1', roles: ['general_user'], email: 's@example.com' } },
        error: null,
    }));
    store.seed(COLLECTIONS.PRODUCTS, 'p1', {
        sellerId: 's1', name: 'Yam', price: 1000, status: 'approved',
    });
});

function editForm(): FormData {
    const f = new FormData();
    f.set('productId', 'p1');
    f.set('name', 'Yam tubers');
    f.set('description', 'Fresh yam tubers from Benue, sold by the tuber.');
    f.set('price', '1200');
    f.set('category', 'roots');
    f.set('stock', '50');
    f.set('unit', 'tuber');
    return f;
}

async function editAs(user: Record<string, unknown>) {
    store.seed(COLLECTIONS.USERS, 's1', { email: 's@example.com', ...user });
    const { updateProductAction } = await import('@/app/actions/marketplace/_mp_products');
    return (await updateProductAction(null, editForm())) as any;
}

describe('every shape an approved seller actually has', () => {
    it.each([
        ['the old vocabulary — seller role + sellerVerificationStatus', OLD_VOCABULARY],
        ['the new standardized role — marketplace_seller', NEW_ROLE],
        ['healed by _mp_onboarding — registration approved, no role granted', HEALED_BY_ONBOARDING],
    ])('MAY EDIT THEIR OWN PRODUCT: %s', async (_label, user) => {
        const res = await editAs(user);

        // The gate is what this is about, and past it the edit goes through.
        // The GATE is what this finding is about, and the action now returns
        // success rather than a refusal. Whether the fake store reflects the
        // written fields is a harness question and is deliberately not asserted
        // here — it would pass for the wrong reason.
        expect(res.error).toBeNull();
        expect(res.success).toBe(true);
    });

    it('and a member who is not a seller is still refused', async () => {
        const res = await editAs({ roles: ['general_user'] });

        expect(res.success).toBe(false);
        expect(res.error).toBe('You must have seller role to update products');
    });

    it('and a seller whose application was REJECTED is still refused', async () => {
        const res = await editAs({ roles: ['seller'], sellerVerificationStatus: 'rejected' });

        expect(res.success).toBe(false);
        expect(res.error).toBe('Your seller account must be approved first');
    });

    it('and a BUYER-only approved registration is not a seller', async () => {
        // The registration answers "may they sell", not "are they registered".
        const res = await editAs({
            roles: ['general_user'],
            serviceRegistrations: { marketplace: { status: 'approved', accountType: 'buyer' } },
        });

        expect(res.success).toBe(false);
        expect(res.error).toBe('You must have seller role to update products');
    });

    it('and an UNAPPROVED seller registration is not an approval', async () => {
        const res = await editAs({
            roles: ['general_user'],
            serviceRegistrations: { marketplace: { status: 'pending', accountType: 'seller' } },
        });

        expect(res.success).toBe(false);
    });
});

describe('the predicate itself', () => {
    it('names both role spellings, and both are real roles', () => {
        expect([...SELLER_ROLES].sort()).toEqual(['marketplace_seller', 'seller']);
        for (const role of SELLER_ROLES) {
            expect(ALL_USER_ROLES as readonly string[]).toContain(role);
        }
    });

    it('reads approval from either vocabulary', () => {
        expect(isSellerApproved({ sellerVerificationStatus: 'approved' })).toBe(true);
        expect(isSellerApproved({
            serviceRegistrations: { marketplace: { status: 'approved' } },
        })).toBe(true);
        expect(isSellerApproved({ sellerVerificationStatus: 'rejected' })).toBe(false);
        expect(isSellerApproved({})).toBe(false);
        expect(isSellerApproved(null)).toBe(false);
    });

    it('treats an approved seller registration as the role it stands for', () => {
        expect(registrationSaysSeller(HEALED_BY_ONBOARDING)).toBe(true);
        expect(registrationSaysSeller({
            serviceRegistrations: { marketplace: { status: 'approved', accountType: 'both' } },
        })).toBe(true);
        expect(registrationSaysSeller({
            serviceRegistrations: { marketplace: { status: 'pending', accountType: 'seller' } },
        })).toBe(false);
    });

    it('and survives a caller with nothing at all', () => {
        expect(holdsSellerRole(undefined)).toBe(false);
        expect(sellerRefusalReason(null, 'update')).toBe('You must have seller role to update products');
    });
});

describe('no gate asks this question by hand any more', () => {
    it.each([
        'src/app/actions/marketplace/_mp_products.ts',
        'src/app/api/marketplace/create-product/route.ts',
        'src/app/actions/village-market.ts',
    ])('%s goes through lib/seller-approval', (rel) => {
        const code = require('fs')
            .readFileSync(require('path').join(process.cwd(), rel), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        expect(code).toContain('@/lib/seller-approval');
        // The two spellings that were the defect.
        expect(code).not.toMatch(/sellerVerificationStatus\s*!==\s*"approved"/);
        expect(code).not.toMatch(/hasRole\([^)]*"seller"\)/);
    });
});
