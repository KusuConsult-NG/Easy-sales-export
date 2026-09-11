/**
 * @jest-environment node
 */

/**
 *   #648 THE ROLE EDITOR OFFERED A CHECKBOX THE VALIDATOR REFUSED.
 *
 *   `lib/types/roles.ts` exists because "what is a valid role?" had six answers
 *   and no two agreed. Its header lists them, and names this one:
 *
 *       schemas.ts UserRoleSchema    14 — has marketplace_buyer, not
 *                                    marketplace_seller
 *
 *   ALL_USER_ROLES was built as the one true list, with a compile-time
 *   exhaustiveness check in both directions so it cannot fall behind the type.
 *   The repair reached `add-roles/route.ts`, `write-guard.ts`,
 *   `bulk-user-operations.ts` and `admin-permissions.ts` — four doors — and left
 *   `schemas.ts`, which is the fifth. The evidence was in the new file's own
 *   header the whole time.
 *
 *   `UserRoleSchema` is missing SEVEN roles: the six module admins and
 *   `marketplace_seller`. It governs two live doors —
 *   `UpdateUserRolesSchema` (the admin users screen's role editor) and
 *   `LegacyOnboardingSchema` — and it REFUSES rather than strips, so every
 *   consequence below is a failed save rather than a silent change.
 *
 * ── WHAT IT MEANT, ON A SCREEN AN ADMIN USES ────────────────────────────────
 *
 *   /admin/users offers five role checkboxes, from a SEVENTH hand-written list:
 *
 *       ROLES_LIST = ["general_user", "field_officer", "admin",
 *                     "super_admin", "academy_admin"]
 *
 *   `academy_admin` is one of them, and it is NOT in UserRoleSchema. So ticking
 *   the only module-admin box the screen has ever offered made the save fail,
 *   every time, with a raw Zod message in a toast. That checkbox has never
 *   worked.
 *
 *   AND IT IS WORSE THAN THE BOX. `handleUpdateRoles` sends the roles it does
 *   not offer straight back — deliberately, so editing a user's admin rights
 *   does not strip the modules they belong to:
 *
 *       const currentNonAssignableRoles = (user.roles ?? [])
 *           .filter(role => !ROLES_LIST.includes(role));
 *       const newRoles = [...selectedAssignableRoles, ...currentNonAssignableRoles];
 *
 *   So a user holding `export_admin`, `wave_admin`, `cooperative_admin`,
 *   `marketplace_admin`, `farm_nation_admin` or `marketplace_seller` sends that
 *   role back with every submission — and NONE of their roles can be changed
 *   through this screen at all. Not the role in question: any of them.
 *
 * ── THE WIDENING IS NOT A NEW AUTHORITY ─────────────────────────────────────
 *
 *   Deriving the enum from ALL_USER_ROLES lets the six module admins through
 *   this door. It grants the PLATFORM nothing new: `/api/admin/add-roles` — the
 *   other door onto the same operation — has validated against ALL_USER_ROLES
 *   and gated on `includesPrivilegedRole` for some time, so everything this
 *   change permits was already permitted there. What it stops is one of two
 *   doors refusing what the other performs, which is #276/#277/#279/#281/#294/
 *   #486/#497/#499's shape with the roles the other way round.
 *
 *   And the guard those doors share still decides: `PRIVILEGED_ROLES` is DERIVED
 *   as "a role that can do something a plain admin cannot", which today is
 *   `admin`, `super_admin` and `cooperative_admin` — the one module admin
 *   holding a permission the matrix withholds from `admin`. The other five give
 *   away no authority the granter lacks, which is the property that makes a
 *   grant safe. I assumed otherwise while writing this; the control below caught
 *   it, and the note there records why.
 *
 *   The screen's five checkboxes become a STATED RULE rather than an arbitrary
 *   set: an admin assigns STAFF roles, and module participation is earned by
 *   completing a module's own flow (the academy grants `academy_participant` on
 *   payment; the marketplace grants `seller` on onboarding). That rule explains
 *   four of the five that were there and is the reason the fifth was lonely.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ALL_USER_ROLES, ADMIN_ASSIGNABLE_ROLES } from '@/lib/types/roles';
import { includesPrivilegedRole } from '@/lib/admin-permissions';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));
jest.mock('@/lib/member-pii-visibility', () => ({
    mayRevealMemberPii: async () => true,
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;

function actAs(id: string, roles: string[] = ['super_admin']): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

function seedUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(USERS, id, {
        email: `${id}@example.com`, firstName: 'Ada', lastName: 'Obi',
        phone: '08012345678', roles: ['general_user'],
        createdAt: '2026-01-01T00:00:00.000Z', ...extra,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1');
});

const update = async (id: string, roles: string[]) =>
    (await (await import('@/app/actions/admin/_users')).updateUserRolesAction(id, roles)) as any;
const read = (id: string) => store.get(USERS, id) as Record<string, any>;

const MODULE_ADMINS = [
    'academy_admin', 'wave_admin', 'cooperative_admin',
    'marketplace_admin', 'farm_nation_admin', 'export_admin',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#648 — the role editor accepts every role the platform has', () => {
    it.each(MODULE_ADMINS)('A SUPER ADMIN CAN GRANT %s', async (role) => {
        //   THE DEFECT. `academy_admin` is the one the screen actually offers,
        //   so that case is a live checkbox; the other five are the rest of the
        //   set the same enum was missing.
        seedUser('u1');

        const res = await update('u1', ['general_user', role]);

        expect(res.success).toBe(true);
        expect(read('u1').roles).toEqual(expect.arrayContaining([role]));
    });

    it('AND CAN GRANT marketplace_seller — the seventh missing role', async () => {
        //   Not an admin role at all: the "new standardized" seller role, named
        //   in roles.ts's header as the specific omission from this schema.
        seedUser('u1');

        const res = await update('u1', ['general_user', 'marketplace_seller']);

        expect(res.success).toBe(true);
        expect(read('u1').roles).toEqual(expect.arrayContaining(['marketplace_seller']));
    });

    it('AND A USER WHO ALREADY HOLDS ONE CAN STILL BE EDITED', async () => {
        /*
         *   The consequence that does not need the checkbox. The screen sends
         *   back every role it does not offer, so an export_admin's submission
         *   always carried `export_admin` — and the whole save was refused.
         *   Not the role in question: ANY change to that user.
         */
        seedUser('u1', { roles: ['export_admin', 'general_user'] });

        const res = await update('u1', ['export_admin', 'general_user', 'field_officer']);

        expect(res.success).toBe(true);
        expect(read('u1').roles).toEqual(expect.arrayContaining(['field_officer', 'export_admin']));
    });

    it('AND A ROLE THAT IS NOT A ROLE IS STILL REFUSED — the control', () => {
        //   Widening a validator is only safe if it is still a validator. Every
        //   assertion above is satisfied by deleting the check.
        return (async () => {
            seedUser('u1');

            const res = await update('u1', ['general_user', 'wizard']);

            expect(res.success).toBe(false);
            expect(read('u1').roles).toEqual(['general_user']);
        })();
    });

    it('AND "moderator" AND "support" ARE STILL UNGRANTABLE', async () => {
        /*
         *   Both appear in PERMISSION_MATRIX and in isAdmin(), and in no role
         *   type and no UI list. bulk-user-operations.ts records that validating
         *   against ALL_USER_ROLES is what closed the one path that could grant
         *   them — so this door must not reopen it.
         */
        seedUser('u1');

        for (const role of ['moderator', 'support']) {
            const res = await update('u1', ['general_user', role]);
            expect({ role, success: res.success }).toEqual({ role, success: false });
        }
        expect(read('u1').roles).toEqual(['general_user']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#648 — and widening it grants a plain admin nothing new', () => {
    /*
     * ── I ASSUMED THE WRONG POLICY, AND A POSITIVE CONTROL CAUGHT IT ────────
     *
     *   The first version of this block asserted that a plain admin cannot hand
     *   out ANY module-admin role, and the control beneath it — "the privileged
     *   set really does cover all six" — FAILED. It should have: PRIVILEGED_ROLES
     *   is not a list, it is DERIVED as "a role that can do something a plain
     *   admin cannot", and today that computes to exactly
     *
     *       ["admin", "super_admin", "cooperative_admin"]
     *
     *   because `cooperative_admin` alone holds a permission the matrix
     *   withholds from `admin` (`cooperatives:manage_products`). The other five
     *   module admins hold nothing an admin does not already have, so an admin
     *   granting one gives away no authority they lack — which is the property
     *   that makes a grant safe, and precisely what that derivation encodes.
     *
     *   Written down because the assumption was reasonable and wrong, and the
     *   next reader will make it too.
     */
    it('A PLAIN ADMIN STILL CANNOT HAND OUT A ROLE WITH A SURPLUS PERMISSION', async () => {
        //   THE guard, and it is unchanged by this finding. It was simply
        //   unreachable through this door, because the parse failed first.
        actAs('admin-2', ['admin']);
        seedUser('u1');

        for (const role of ['cooperative_admin', 'admin', 'super_admin']) {
            const res = await update('u1', ['general_user', role]);
            expect({ role, success: res.success }).toEqual({ role, success: false });
            expect(String(res.error)).toMatch(/super admin/i);
        }
        expect(read('u1').roles).toEqual(['general_user']);
    });

    it('AND THE PRIVILEGED SET IS DERIVED, not listed — the control', () => {
        /*
         *   The assertion that caught my wrong assumption, kept as the thing it
         *   actually measures. `cooperative_admin` is in the set BECAUSE of a
         *   surplus permission; if the matrix ever gives another module admin
         *   one, that role joins the set and the guard above covers it with
         *   nobody remembering to come back here.
         */
        expect(includesPrivilegedRole(['cooperative_admin'])).toBe(true);
        expect(includesPrivilegedRole(['admin'])).toBe(true);
        expect(includesPrivilegedRole(['super_admin'])).toBe(true);
        //   And it is not simply true of everything.
        expect(includesPrivilegedRole(['general_user'])).toBe(false);
        expect(includesPrivilegedRole(['seller'])).toBe(false);
    });

    it('AND THIS DOOR NOW AGREES WITH THE ONE THAT WAS ALREADY OPEN', () => {
        /*
         *   /api/admin/add-roles has validated against ALL_USER_ROLES and gated
         *   on includesPrivilegedRole for some time, so a plain admin could
         *   already grant export_admin there. This finding does not widen the
         *   platform; it stops one of two doors onto the same operation
         *   refusing what the other performs — the shape recorded in #276, #277,
         *   #279, #281, #294, #486, #497 and #499, now with the two doors
         *   reading the same list.
         */
        const route = code('src/app/api/admin/add-roles/route.ts');
        expect(route).toContain('ALL_USER_ROLES');
        expect(route).toContain('includesPrivilegedRole');
        expect(code('src/lib/schemas.ts')).toContain('ALL_USER_ROLES');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#648 — one list, and the screen reads it', () => {
    it('THE SCHEMA DERIVES ITS ENUM FROM ALL_USER_ROLES', () => {
        const src = code('src/lib/schemas.ts');
        expect(src).toContain('z.enum(ALL_USER_ROLES)');
        //   Stated as an absence too: adding the derived form beside the old
        //   literal would satisfy the line above and change nothing.
        expect(src).not.toMatch(/"academy_participant",\s*\n\s*"field_officer",/);
    });

    it('AND THE SCREEN OFFERS A DECLARED SET, not a seventh copy', () => {
        const src = code('src/app/admin/users/page.tsx');
        expect(src).toContain('ROLES_LIST = ADMIN_ASSIGNABLE_ROLES');
        expect(src).not.toMatch(/ROLES_LIST\s*=\s*\[/);
    });

    it('AND THAT SET IS A RULE, not a list — every module admin is in it', () => {
        /*
         *   The screen offered ONE of the six module admins. The rule is that an
         *   admin assigns STAFF roles and module participation is earned, so
         *   either all six belong or none do.
         */
        for (const role of MODULE_ADMINS) {
            expect({ role, assignable: (ADMIN_ASSIGNABLE_ROLES as readonly string[]).includes(role) })
                .toEqual({ role, assignable: true });
        }
        expect([...ADMIN_ASSIGNABLE_ROLES]).toContain('admin');
        expect([...ADMIN_ASSIGNABLE_ROLES]).toContain('super_admin');
        expect([...ADMIN_ASSIGNABLE_ROLES]).toContain('field_officer');
        expect([...ADMIN_ASSIGNABLE_ROLES]).toContain('general_user');
    });

    it('AND IT OFFERS NO ROLE A MEMBER EARNS', () => {
        /*
         *   The other half of the rule, and the reason this is not simply
         *   "offer all twenty-one". A checkbox that grants `academy_participant`
         *   hands somebody paid course access without a payment.
         */
        for (const earned of [
            'academy_participant', 'wave_participant', 'cooperative_member',
            'export_participant', 'seller', 'marketplace_seller', 'buyer',
            'marketplace_buyer', 'land_owner', 'farmer', 'investor',
        ]) {
            expect({ earned, offered: (ADMIN_ASSIGNABLE_ROLES as readonly string[]).includes(earned) })
                .toEqual({ earned, offered: false });
        }
    });

    it('AND EVERY ASSIGNABLE ROLE IS A REAL ROLE', () => {
        //   The list cannot drift from the union it is drawn from — which is the
        //   defect this whole finding is about, one level up.
        for (const role of ADMIN_ASSIGNABLE_ROLES) {
            expect({ role, real: (ALL_USER_ROLES as readonly string[]).includes(role) })
                .toEqual({ role, real: true });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the schema restates the fourteen again              KILLED
 *     THE DEFECT: the screen keeps its own five-member list           KILLED
 *     the schema stops validating at all                              KILLED
 *     the assignable set loses five of the six module admins again    KILLED
 *     the assignable set gains a role a member earns                  KILLED
 *     the privileged-grant guard is removed from the action           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "The schema stops validating at all" is the one that matters most in the
 *   opposite direction. Widening a validator is only a repair while it is still
 *   a validator, and `z.string()` would satisfy every "can grant X" assertion in
 *   this file while making `moderator`, `support` and any typed-in string
 *   grantable — the exact path bulk-user-operations.ts records as the one that
 *   could hand out admin access that nothing lists as admin access.
 *
 *   "The privileged-grant guard is removed" is the other side: this finding
 *   opens a door, and what stops that door being an escalation is a rule it does
 *   not own. Pinned here because a change to THIS file is what would make
 *   somebody wonder whether that rule still holds.
 *
 * ── AND THE POSITIVE CONTROL EARNED ITS PLACE ───────────────────────────────
 *
 *   Before any of the above: my first draft asserted that a plain admin cannot
 *   grant ANY module-admin role, and its positive control — "the privileged set
 *   covers all six" — failed on green code. It was the assertion that was wrong.
 *   PRIVILEGED_ROLES is derived, not listed, and five of the six module admins
 *   hold no permission `admin` lacks, so granting one gives away nothing the
 *   granter has. A control exists to fail when the claim around it is false, and
 *   this one did its job against my own reasoning rather than against the code.
 */
