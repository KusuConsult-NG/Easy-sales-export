/**
 * @jest-environment node
 */

/**
 * "OTHER MODULE ADMINS CAN'T LOGIN WHY?"
 *
 * Because they could not be MADE.
 *
 * lib/schemas.ts held a hand-written enum of 14 role names, and none of the six
 * module admin roles was among them:
 *
 *   academy_admin  wave_admin  marketplace_admin
 *   cooperative_admin  export_admin  farm_nation_admin
 *
 * That enum gates UpdateUserRolesSchema, which admin/_users.ts parses before it
 * writes. Executed as a super_admin, before the change, every one of the six
 * came back:
 *
 *   Invalid option: expected one of "general_user"|"buyer"|"marketplace_buyer"|
 *   "seller"|"land_owner"|"farmer"|"investor"|"export_participant"|
 *   "cooperative_member"|"wave_participant"|"academy_participant"|
 *   "field_officer"|"admin"|"super_admin"
 *
 * EVERY OTHER LAYER WAS READY FOR THEM, which is why nothing else looked wrong.
 * Executed for all six: isAdmin() is true (it is derived from
 * PERMISSION_MATRIX, which has an entry per module admin), so admin/layout.tsx
 * admits them; getPostLoginRedirect routes each to its own /admin/<module>;
 * canAccessAdminRoute has a silo branch per role. The whole chain worked for an
 * account that could not exist.
 *
 * AND IT LOCKED THE ONES WHO ALREADY EXIST. The action writes the array
 * wholesale, so editing anything about a module admin means sending their
 * current role back through the enum. ["general_user","academy_admin"] was
 * refused exactly as ["academy_admin"] was.
 *
 * `marketplace_seller` was missing too — the role #381 found the product gates
 * refusing, and the reason an approved seller could not simply be granted it.
 *
 * THE SHARED LIST ALREADY EXISTED AND THIS WAS THE COPY THAT MISSED IT.
 * lib/types/roles.ts::ALL_USER_ROLES is the value form of the UserRole union,
 * held exhaustive by a compile-time check in that file. Its header names the
 * six lists that disagreed, and names THIS one, described exactly as it still
 * was: "schemas.ts UserRoleSchema — 14 — has marketplace_buyer, not
 * marketplace_seller". api/admin/add-roles was migrated onto ALL_USER_ROLES.
 * write-guard.ts was migrated onto ALL_USER_ROLES — and that is the guard this
 * same action writes THROUGH, so the write guard accepted the role the schema
 * in front of it refused.
 *
 * WHAT IS RECORDED HERE AND NOT CHANGED
 * -------------------------------------
 * A plain `admin` can now appoint five of the six module admins and is refused
 * the sixth: cooperative_admin holds `cooperatives:manage_products`, which
 * `admin` does not, so PRIVILEGED_ROLES — which is derived as "admin,
 * super_admin, and anything with a permission beyond admin's" — contains it.
 * `admin` holds every other module admin's manage permission
 * (marketplace:manage_village_market, wave:manage_training,
 * academy:manage_courses), so the omission looks like an oversight rather than
 * a policy. Granting a permission is the owner's call, not a correction to make
 * in passing, so the current behaviour is pinned below with its reason instead
 * of being quietly changed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ALL_USER_ROLES } from '@/lib/types/roles';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isAdmin, hasAdminPermission, ALL_ADMIN_ROLES, PRIVILEGED_ROLES } from '@/lib/admin-permissions';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => undefined),
}));

declare const global: any;

const MODULE_ADMIN_ROLES = [
    'academy_admin', 'wave_admin', 'marketplace_admin',
    'cooperative_admin', 'export_admin', 'farm_nation_admin',
] as const;

const TARGET = 'u1';
let store: FakeDbHandle;

function actAs(roles: string[]) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'actor', roles, email: 'actor@example.com' } },
        error: null,
    }));
}

async function assign(roles: string[]) {
    const { updateUserRolesAction } = await import('@/app/actions/admin/_users');
    return updateUserRolesAction(TARGET, roles as any) as any;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, TARGET, { email: 'u1@example.com', roles: ['general_user'] });
    actAs(['super_admin']);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a module admin can be appointed', () => {
    it.each(MODULE_ADMIN_ROLES)('%s — this was refused as an invalid option', async (role) => {
        const res = await assign([role]);

        expect(res.success).toBe(true);
        // The write actually landed. `success: true` on its own would also be
        // returned by a guard that accepted the request and dropped the field.
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual([role]);
    });

    it('and marketplace_seller, once the account is an approved seller', async () => {
        // The role #381 found the product gates refusing. It is assignable now
        // — and still subject to the seller integrity rule, which is the
        // section below.
        store.seed(COLLECTIONS.USERS, TARGET, {
            email: 'u1@example.com', roles: ['general_user'],
            sellerVerificationStatus: 'approved',
        });

        const res = await assign(['marketplace_seller']);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['marketplace_seller']);
    });

    it('and an existing module admin\'s roles can be edited without stripping the role', async () => {
        // The action writes the array wholesale, so keeping a role means sending
        // it back through the schema. This is the case that locked out the
        // module admins who already existed.
        const res = await assign(['general_user', 'academy_admin']);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['general_user', 'academy_admin']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the rest of the chain was always ready for them', () => {
    it.each(MODULE_ADMIN_ROLES)('%s passes the /admin layout gate', (role) => {
        // admin/layout.tsx admits on isAdmin(roles) alone. It was never the
        // obstacle — which is why the obstacle took this long to find.
        expect(isAdmin([role])).toBe(true);
    });

    it('each is one of the platform\'s admin roles, from the matrix that defines them', () => {
        for (const role of MODULE_ADMIN_ROLES) {
            expect(ALL_ADMIN_ROLES).toContain(role);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the schema is still a gate', () => {
    it('every role the platform has is accepted', async () => {
        // Not "the six were added": the list is the canonical one, so a role
        // added to UserRole later arrives here without a second edit.
        //
        // The target is seeded as an approved seller and a cooperative member
        // because userService.ts's integrity rules refuse a seller role without
        // an approval and a `farmer` role without a cooperative mapping. Those
        // are deliberate rules about the DATA, not about the role list, and
        // leaving them unsatisfied here would test them instead of the schema.
        store.seed(COLLECTIONS.USERS, TARGET, {
            email: 'u1@example.com', roles: ['general_user'],
            sellerVerificationStatus: 'approved', cooperativeMembershipId: 'coop-1',
        });

        for (const role of ALL_USER_ROLES) {
            const res = await assign([role]);
            expect({ role, ok: res.success, err: res.error }).toEqual({ role, ok: true, err: null });
        }
    });

    it('and a name that is not a role is refused', async () => {
        const res = await assign(['platform_owner']);

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['general_user']);
    });

    it('and an empty array is refused — a user with no roles at all', async () => {
        const res = await assign([]);

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['general_user']);
    });

    it('and nothing it accepts is then refused by the write guard behind it', async () => {
        // The defect in one sentence: two lists in front of one write, and the
        // outer one was narrower than the inner one. Both read ALL_USER_ROLES
        // now, and this is what says so.
        const { UserRolesWriteSchema } = await import('@/lib/write-guard');
        for (const role of ALL_USER_ROLES) {
            expect(UserRolesWriteSchema.safeParse({ roles: [role] }).success).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the privilege guard is untouched', () => {
    it('a plain admin still cannot grant admin or super_admin', async () => {
        // Widening the role list must not widen who may hand out authority.
        actAs(['admin']);

        for (const role of ['admin', 'super_admin']) {
            const res = await assign([role]);
            expect(res.success).toBe(false);
            expect(res.error).toBe('Only a super admin can grant admin roles');
        }
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['general_user']);
    });

    it('a plain admin MAY appoint five of the six module admins', async () => {
        actAs(['admin']);

        for (const role of MODULE_ADMIN_ROLES.filter(r => r !== 'cooperative_admin')) {
            const res = await assign([role]);
            expect({ role, ok: res.success }).toEqual({ role, ok: true });
        }
    });

    it('and is refused cooperative_admin, for a reason worth stating', async () => {
        // RECORDED, NOT CHANGED. PRIVILEGED_ROLES is derived: admin, super_admin,
        // and any role holding a permission `admin` does not. cooperative_admin
        // holds `cooperatives:manage_products` and `admin` does not — while
        // `admin` DOES hold every other module admin's manage permission. So the
        // asymmetry comes from one missing entry in the matrix, and widening a
        // permission is the owner's decision rather than a correction to make in
        // passing. If that entry is ever added, this test is the thing that will
        // notice and it should be updated with the reason.
        expect(hasAdminPermission(['cooperative_admin'], 'cooperatives:manage_products')).toBe(true);
        expect(hasAdminPermission(['admin'], 'cooperatives:manage_products')).toBe(false);
        // While `admin` DOES hold every other module admin's manage permission.
        expect(hasAdminPermission(['admin'], 'marketplace:manage_village_market')).toBe(true);
        expect(hasAdminPermission(['admin'], 'wave:manage_training')).toBe(true);
        expect(hasAdminPermission(['admin'], 'academy:manage_courses')).toBe(true);
        expect(PRIVILEGED_ROLES).toContain('cooperative_admin');

        actAs(['admin']);
        const res = await assign(['cooperative_admin']);

        expect(res.success).toBe(false);
        expect(res.error).toBe('Only a super admin can grant admin roles');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the list is not copied out again', () => {
    it('the schema reads ALL_USER_ROLES rather than restating it', () => {
        const code = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/schemas.ts'), 'utf-8');
        expect(code).toContain('z.enum(ALL_USER_ROLES)');
    });

    it('and the legacy-onboarding form, its other consumer, gained them too', async () => {
        // LegacyOnboardingSchema shares UserRoleSchema, so an admin onboarding a
        // legacy member could not give them a module admin role either.
        const { LegacyOnboardingSchema } = await import('@/lib/schemas');
        const parsed = LegacyOnboardingSchema.safeParse({
            fullName: 'Ada Obi', email: 'ada@example.com', phone: '08011111111',
            roles: ['academy_admin'],
        });
        expect(parsed.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the seller integrity rule reads both vocabularies', () => {
    // userService.ts refuses the seller role to an account whose seller
    // application was not approved. It asked for the literal "seller" and the
    // literal `sellerVerificationStatus`, and each half was wrong in a
    // different direction — the pair #381 found the product gates getting
    // wrong. lib/seller-approval.ts answers both questions now, so the screen
    // that GRANTS the role and the screens that USE it cannot disagree about
    // who is a seller.

    function seedTarget(extra: Record<string, unknown>) {
        store.seed(COLLECTIONS.USERS, TARGET, {
            email: 'u1@example.com', roles: ['general_user'], ...extra,
        });
    }

    it('marketplace_seller cannot skip the approval that `seller` needs', async () => {
        // The hole this opened: #383 made marketplace_seller assignable, and
        // the rule only knew the other spelling.
        seedTarget({});

        const res = await assign(['marketplace_seller']);

        expect(res.success).toBe(false);
        expect(res.error).toContain('without \'approved\' verification status');
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['general_user']);
    });

    it('and `seller` is granted to an account approved in the CANONICAL vocabulary', async () => {
        // _mp_onboarding.ts heals an approved seller by writing only
        // serviceRegistrations.marketplace.status. This refused the role to
        // somebody the platform's own record calls an approved seller.
        seedTarget({
            serviceRegistrations: { marketplace: { status: 'approved', accountType: 'seller' } },
        });

        const res = await assign(['seller']);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).toEqual(['seller']);
    });

    it('and an unapproved account is still refused, under either spelling', async () => {
        // The rule must still be a rule. Both directions were widened; neither
        // was removed.
        for (const role of ['seller', 'marketplace_seller']) {
            seedTarget({ sellerVerificationStatus: 'pending' });
            const res = await assign([role]);
            expect({ role, ok: res.success }).toEqual({ role, ok: false });
        }
    });

    it('and an existing seller\'s other roles can still be edited', async () => {
        // The guard fires on the TRANSITION, not on the merged document — a
        // property an earlier finding established and this must not undo.
        seedTarget({ roles: ['seller'], sellerVerificationStatus: 'pending' });

        const res = await assign(['seller', 'general_user']);

        expect(res.success).toBe(true);
    });
});
