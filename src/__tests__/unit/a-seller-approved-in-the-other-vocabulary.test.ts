/**
 * @jest-environment node
 */

/**
 *   #885 THE PLATFORM APPROVED A SELLER IN ONE VOCABULARY AND ASKED ABOUT IT IN
 *        THE OTHER.
 *
 *   THE OWNER, twice, a day apart: "sellers still can't edit products".
 *
 *   MEASURED FIRST, and both reads a seller's own screens make were SOUND — run
 *   against the real local PostgreSQL with the seeded seller's 74 land listings
 *   and 55 products:
 *
 *       getMyLandListings        success=true  count=74
 *       getSellerProductsAction  success=true  count=20
 *
 *   So she can see her products, and the edit form opens and prefills, because
 *   neither read has a gate. The refusal is at the WRITE, and only there.
 *
 * ── THE TWO RECORDS OF ONE FACT ─────────────────────────────────────────────
 *
 *       serviceRegistrations.marketplace.status   the V2 field, and what
 *                                                 checkMarketplaceStatus
 *                                                 returns — so it is what the
 *                                                 onboarding screen, the seller
 *                                                 dashboard and the sidebar all
 *                                                 believe.
 *       sellerVerificationStatus                  the legacy field.
 *                                                 _mp_onboarding.ts calls it
 *                                                 exactly that: "FALLBACK 2:
 *                                                 Check legacy
 *                                                 sellerVerificationStatus".
 *
 *   Five doors gated on the legacy field alone, and the onboarding SELF-HEAL
 *   wrote only the V2 one — not the legacy field, not the `seller` role — while
 *   both admin approval doors write all three together. Its three fallbacks
 *   copy legacy -> V2 and never V2 -> legacy, so once a seller was healed
 *   through that door the two records disagreed permanently.
 *
 *   WHAT THAT IS LIKE TO USE. Every screen says approved. The products list.
 *   The edit form opens filled in. Save says "Your seller account must be
 *   approved first" — a sentence nothing else on the platform agrees with, and
 *   one she cannot act on.
 *
 * ── BOTH HALVES ARE FIXED, DELIBERATELY ─────────────────────────────────────
 *
 *   The gates accept either record, AND the heal completes the row. A gate that
 *   tolerates a half-written row leaves it half-written for the next reader —
 *   and #488's lesson on this platform is that the next reader is the one
 *   nobody remembered.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { sellerIsApproved, hasSellerRole, sellerRefusal } from '@/lib/seller-approval';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#885 — "is this an approved seller" has one answer', () => {
    it('THE REPORTED CASE: approved in the V2 record alone is approved', () => {
        /*
         *   The shape the onboarding self-heal produced, and the one every
         *   selling door refused.
         */
        expect(sellerIsApproved({
            serviceRegistrations: { marketplace: { status: 'approved' } },
        })).toBe(true);
    });

    it('AND APPROVED IN THE LEGACY FIELD ALONE IS STILL APPROVED — the control', () => {
        //   The half that already worked. If this ever fails, the fix broke the
        //   sellers it was not about.
        expect(sellerIsApproved({ sellerVerificationStatus: 'approved' })).toBe(true);
    });

    it('AND "active" COUNTS, because that is the other word the platform uses', () => {
        //   getPostLoginRedirect accepts exactly `approved` and `active` for a
        //   module registration. A third vocabulary is what this finding is.
        expect(sellerIsApproved({
            serviceRegistrations: { marketplace: { status: 'active' } },
        })).toBe(true);
    });

    it('AND A SUSPENDED SELLER IS STILL REFUSED — the property that must not break', () => {
        /*
         *   suspend-seller writes BOTH fields, and its own note records why:
         *   "SUSPENSION SUSPENDED NOTHING […] a suspended seller kept creating
         *   and editing products". Widening the gate must not re-open the door
         *   that finding closed.
         */
        for (const row of [
            { sellerVerificationStatus: 'suspended' },
            { serviceRegistrations: { marketplace: { status: 'suspended' } } },
            {
                sellerVerificationStatus: 'suspended',
                serviceRegistrations: { marketplace: { status: 'suspended' } },
            },
        ]) {
            expect({ row, approved: sellerIsApproved(row) }).toEqual({ row, approved: false });
        }
    });

    it('AND PENDING, REJECTED, MISSING AND NULL ARE ALL "NO"', () => {
        for (const row of [
            { sellerVerificationStatus: 'pending' },
            { sellerVerificationStatus: 'rejected' },
            { serviceRegistrations: { marketplace: { status: 'pending' } } },
            { serviceRegistrations: {} },
            {},
            null,
            undefined,
        ]) {
            expect({ row, approved: sellerIsApproved(row) }).toEqual({ row, approved: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#885 — and the selling role has two spellings', () => {
    it('BOTH SPELLINGS COUNT', () => {
        /*
         *   `marketplace_seller` is a first-class UserRole — types/roles.ts
         *   calls it "the new standardized role" — and it is NOT in
         *   LEGACY_ROLE_MAP, so canonicalRoles leaves it alone and
         *   `hasRole(roles, "seller")` was false for its holder.
         */
        expect(hasSellerRole(['seller'])).toBe(true);
        expect(hasSellerRole(['marketplace_seller'])).toBe(true);
    });

    it('AND THE LEGACY `vendor` STILL RESOLVES, through canonicalRoles', () => {
        //   LEGACY_ROLE_MAP.vendor = "seller". role-aliases exists because a
        //   vendor "could reach the seller app and simultaneously fail
        //   hasRole(roles, 'seller')".
        expect(hasSellerRole(['vendor'])).toBe(true);
    });

    it('AND A BUYER IS NOT A SELLER — the control', () => {
        for (const roles of [['buyer'], ['marketplace_buyer'], ['general_user'], [], null, 'seller']) {
            expect({ roles, seller: hasSellerRole(roles) }).toEqual({ roles, seller: false });
        }
    });

    it('AND module-access-check CARRIES BOTH SPELLINGS TOO', () => {
        /*
         *   Its marketplace list had `marketplace_buyer` beside `buyer` and then
         *   `seller` alone — half a pair. Layer 2.5 compares with a raw
         *   `.includes()`, so no canonicalisation could cover for it.
         */
        //   ANCHORED TO APP_TO_ROLES. A bare indexOf('marketplace:') finds the
        //   module-NAME map declared above it, which is a different table — the
        //   same mis-anchoring this suite's author has already made once.
        const src = code('src/lib/module-access-check.ts');
        const spec = src.slice(src.indexOf('APP_TO_ROLES'));
        const at = spec.indexOf('marketplace:');
        const list = spec.slice(at, at + 140);

        expect(at).toBeGreaterThan(-1);

        expect(list).toContain('marketplace_seller');
        expect(list).toContain('marketplace_buyer');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#885 — one refusal, in one order, for every door', () => {
    it('AN APPROVED SELLER IS NOT REFUSED', () => {
        expect(sellerRefusal({
            roles: ['seller'],
            serviceRegistrations: { marketplace: { status: 'approved' } },
        })).toBeNull();
    });

    it('AND THE ROLE IS OPTIONAL, because two doors never asked for it', () => {
        //   The Village Market join and the create-product route both gate on
        //   approval alone. Widening a gate is not this finding's business.
        const approvedNoRole = { roles: [], sellerVerificationStatus: 'approved' };

        expect(sellerRefusal(approvedNoRole)).not.toBeNull();
        expect(sellerRefusal(approvedNoRole, { requireRole: false })).toBeNull();
    });

    it('AND AN ABSENT USER DOCUMENT IS A REFUSAL, not a pass', () => {
        expect(sellerRefusal(null)).not.toBeNull();
        expect(sellerRefusal(undefined)).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#885 — every door asks the shared question', () => {
    it('NO SELLING DOOR COMPARES sellerVerificationStatus BY HAND', () => {
        /*
         *   The five that did. A source scan rather than an execution, because
         *   the defect is a clause that must not come back — and this is the
         *   shape the audit keeps finding: a rule applied to some of the places
         *   it names.
         */
        for (const rel of [
            'src/app/actions/marketplace/_mp_products.ts',
            'src/app/api/marketplace/create-product/route.ts',
            'src/app/actions/village-market.ts',
        ]) {
            const src = code(rel);
            expect({ rel, handWritten: src.includes('sellerVerificationStatus !== "approved"') })
                .toEqual({ rel, handWritten: false });
            expect({ rel, shared: /seller-approval/.test(src) })
                .toEqual({ rel, shared: true });
        }
    });

    it('AND NO SELLING DOOR ASKS hasRole(..., "seller") ANY MORE', () => {
        for (const rel of [
            'src/app/actions/marketplace/_mp_products.ts',
            'src/app/actions/order-management.ts',
        ]) {
            expect({ rel, narrow: code(rel).includes('hasRole(userData?.roles || [], "seller")') })
                .toEqual({ rel, narrow: false });
        }
    });

    it('AND BOTH PRODUCT DOORS ARE COVERED, not just the reported one', () => {
        //   The owner reported EDIT. Create had the identical two clauses, and
        //   fixing only the reported one is how this codebase's defects survive.
        /*
         *   COUNTED BY CALL, NOT BY EXACT TEXT. The first version of this line
         *   pinned `sellerRefusal(userData)` character for character and went to
         *   zero the moment each door was given its own verb — the literal-
         *   pinning habit this suite criticises two describes above, committed
         *   in the same file.
         */
        const src = code('src/app/actions/marketplace/_mp_products.ts');
        const calls = src.match(/sellerRefusal\(\s*userData/g) ?? [];

        expect(calls).toHaveLength(2);
        //   And each door keeps its own wording, which is why the verb exists.
        expect(src).toContain('verb: "create"');
        expect(src).toContain('verb: "update"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#885 — and the heal writes the whole row', () => {
    let store: any;

    const SELLER = 'seller-1';

    beforeEach(() => {
        jest.resetModules();
    });

    async function healFor(accountType: string, roles: string[] = ['general_user']) {
        jest.doMock('@/lib/redis', () => ({
            getCached: async () => null, setCache: async () => undefined,
            deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
            CacheKeys: new Proxy({}, { get: () => (...a: any[]) => a.join(':') }),
            CacheTTL: new Proxy({}, { get: () => 60 }),
        }));
        jest.doMock('@/lib/cache-invalidation', () => ({
            invalidateServiceCache: async () => undefined,
            invalidateUserCache: async () => undefined,
        }));
        jest.doMock('next/cache', () => ({
            revalidateTag: () => undefined, revalidatePath: () => undefined,
            updateTag: () => undefined, unstable_cache: (fn: any) => fn,
        }));
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: SELLER, roles, email: 's@e.com', name: 'S' } },
                error: null,
            }),
        }));

        const { installFakeDb } = require('@/lib/testing/fake-db');
        const { COLLECTIONS } = require('@/lib/types/firestore');
        store = installFakeDb();

        //   The row the self-heal meets: an approved verification, and a user
        //   document that has not caught up.
        store.seed(COLLECTIONS.USERS, SELLER, {
            id: SELLER, email: 's@e.com', roles,
            sellerVerificationId: 'ver-1',
            serviceRegistrations: { marketplace: { status: 'pending', verificationId: 'ver-1' } },
        });
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'ver-1', {
            id: 'ver-1', userId: SELLER, status: 'approved', accountType,
        });

        const { checkMarketplaceStatusAction } = await import('@/app/actions/marketplace/_mp_onboarding');
        const res: any = await checkMarketplaceStatusAction();

        const row = store.get(COLLECTIONS.USERS, SELLER);
        return { res, row };
    }

    it('THE ROOT CAUSE: an approved seller comes out approved in BOTH records', async () => {
        const { res, row } = await healFor('seller');

        expect(res.success).toBe(true);
        expect(res.data.status).toBe('approved');

        //   What it always wrote.
        expect(row.serviceRegistrations.marketplace.status).toBe('approved');
        //   What it never wrote, and what every selling door reads.
        expect(row.sellerVerificationStatus).toBe('approved');
        expect(row.roles).toContain('seller');
    });

    it('AND THE HEALED ROW NOW PASSES THE DOOR THAT REFUSED HER', async () => {
        //   The two halves joined: heal the row, then ask the gate about it.
        const { row } = await healFor('seller');

        expect(sellerRefusal(row)).toBeNull();
    });

    it('AND "both" GETS BOTH ROLES — #844\'s rule, not re-broken', async () => {
        const { row } = await healFor('both');

        expect(row.roles).toContain('seller');
        expect(row.sellerVerificationStatus).toBe('approved');
    });

    it('AND A BUYER-ONLY APPROVAL IS NOT GRANTED SELLING RIGHTS', async () => {
        /*
         *   The direction that would make this fix a security defect. Somebody
         *   approved to BUY must not come out of a heal able to sell.
         */
        const { row } = await healFor('buyer');

        expect(row.roles).not.toContain('seller');
        expect(row.sellerVerificationStatus).toBeUndefined();
        expect(row.roles).toContain('marketplace_buyer');
    });

    it('AND RUNNING IT TWICE CHANGES NOTHING — it must be safe to repeat', async () => {
        const first = await healFor('seller');
        const rolesAfterOne = [...first.row.roles];

        const { checkMarketplaceStatusAction } = await import('@/app/actions/marketplace/_mp_onboarding');
        await checkMarketplaceStatusAction();

        const { COLLECTIONS } = require('@/lib/types/firestore');
        const row = store.get(COLLECTIONS.USERS, SELLER);

        expect(row.roles.sort()).toEqual(rolesAfterOne.sort());
        expect(row.sellerVerificationStatus).toBe('approved');
    });
});
