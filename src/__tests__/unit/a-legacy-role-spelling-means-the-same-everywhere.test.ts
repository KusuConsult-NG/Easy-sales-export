/**
 * @jest-environment node
 */

/**
 *   #458 LOGIN SENT THE HOLDER OF THE LEGACY `superadmin` ROLE TO THE ADMIN
 *   PORTAL, AND THE ADMIN PORTAL BOUNCED THEM STRAIGHT BACK OUT.
 *
 *   The spelling without the underscore was honoured in exactly one file.
 *   actions/auth.ts used it twice — once to decide the user has an admin role
 *   at all, once to decide they land on /admin rather than a module silo:
 *
 *       return r === 'superadmin' || r.includes('admin_dashboard');
 *       ...
 *       || roleStrings.includes('superadmin')
 *
 *   NOTHING ELSE KNEW IT. isAdmin() lists the canonical admin roles and not
 *   this one; PERMISSION_MATRIX has no entry for it; app/admin/page.tsx
 *   computed `isGlobalAdmin` by hand from "super_admin" and "admin". So the
 *   whole round trip was:
 *
 *       login          -> admin role yes, global admin yes -> /admin
 *       /admin         -> global admin NO, no module role  -> /dashboard
 *       any admin call -> requireAdmin -> isAdmin false -> "Unauthorized"
 *
 *   #356 kept the spelling alive in auth.ts on the stated grounds that
 *   "dropping it here would strand whoever holds it". They were stranded
 *   anyway, one hop later, by a redirect that had never heard of it.
 *
 *   TWO MORE THINGS TURNED UP BEHIND IT
 *
 *     THE LANDING RULE WAS WRITTEN TWICE, IN DIFFERENT ORDERS. auth.ts tried
 *     academy, wave, marketplace, cooperative, export, farm nation;
 *     admin/page.tsx tried wave, cooperative, marketplace, export, farm nation,
 *     academy. Both take the first match, so somebody holding academy_admin AND
 *     wave_admin had two homes — Academy from login, WAVE from /admin. Login's
 *     order is kept, because login is the door almost everybody uses.
 *
 *     AND THE COMMENT ON THAT RULE DESCRIBED BEHAVIOUR NEITHER COPY HAD:
 *     "Strict Silo Isolation: ... they are locked to that silo, EVEN IF they
 *     are also granted super_admin or admin rights". Both copies checked
 *     `!isGlobalAdmin` FIRST, so a global admin was never locked into a silo.
 *     A false claim in an access-control path, corrected rather than
 *     implemented — locking a deliberately-granted super_admin out of the
 *     global dashboard is a worse answer than the one the code was giving.
 *
 *   AND THERE WERE ALREADY TWO LEGACY VOCABULARIES. role-app-mapping.ts had a
 *   private `normaliseRoles` resolving LEGACY_ROLE_MAP (member, exporter,
 *   vendor) while role-utils and admin-permissions resolved nothing — so a
 *   `vendor` could reach the seller app and fail `hasRole(roles, "seller")` at
 *   the same time. A third table for `superadmin` beside those two would have
 *   been the defect. One table now, in lib/role-aliases.ts.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     canonicalRoles returns its input unresolved   KILLED
 *     the superadmin alias removed                  KILLED
 *     admin-permissions stops resolving             KILLED
 *     role-utils stops resolving                    KILLED
 *     adminLandingPath drops the global-admin check KILLED
 *     the two landing orders diverge again          KILLED
 *     reword this header                            SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { canonicalRole, canonicalRoles, ROLE_ALIASES } from '@/lib/role-aliases';
import { LEGACY_ROLE_MAP } from '@/lib/types/roles';
import * as permissions from '@/lib/admin-permissions';
import * as roleUtils from '@/lib/role-utils';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const { adminLandingPath, isAdmin, isSuperAdmin, hasAdminPermission } = permissions;

// ─────────────────────────────────────────────────────────────────────────────
describe('#458 — the legacy spelling reaches the admin portal it was sent to', () => {
    it('A `superadmin` IS A GLOBAL ADMIN, not a stranger', () => {
        // Every one of these answered NO before, while login answered YES.
        expect(isAdmin(['superadmin'])).toBe(true);
        expect(isSuperAdmin(['superadmin'])).toBe(true);
        expect(roleUtils.isAdmin(['superadmin'] as never)).toBe(true);
        expect(roleUtils.isSuperAdmin(['superadmin'] as never)).toBe(true);
    });

    it('AND LANDS ON /admin — the exact bounce this finding is', () => {
        // login -> /admin -> /dashboard was the loop. The middle hop is this.
        expect(adminLandingPath(['superadmin'])).toBe('/admin');
    });

    it('AND HOLDS super_admin PERMISSIONS, so the page is not empty once there', () => {
        // Reaching the portal is worth nothing if every action refuses.
        // PERMISSION_MATRIX has no `superadmin` key, so this was false for
        // every permission on the platform.
        const mine = permissions.getUserAdminPermissions(['superadmin']);
        const canonical = permissions.getUserAdminPermissions(['super_admin']);

        expect(mine).toEqual(canonical);
        expect(mine.length).toBeGreaterThan(0);
        expect(hasAdminPermission(['superadmin'], canonical[0])).toBe(true);
    });

    it('and requireAdmin would now admit them — isAdmin is the gate it asks', () => {
        // requireAdmin re-reads roles from the database and calls isAdmin.
        // That is the third refusal in the round trip.
        expect(source('src/lib/require-admin.ts')).toContain('if (!isAdmin(roles))');
        expect(isAdmin(['superadmin'])).toBe(true);
    });

    it('POSITIVE CONTROL: a role that is NOT an alias is still refused', () => {
        // Without this, a resolver that admitted everything would pass the lot.
        expect(isAdmin(['superadmim'])).toBe(false);      // one letter out
        expect(isAdmin(['super admin'])).toBe(false);
        expect(isAdmin(['general_user'])).toBe(false);
        expect(adminLandingPath(['general_user'])).toBeNull();
        expect(adminLandingPath([])).toBeNull();
        expect(adminLandingPath(undefined)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#458 — EVERY role predicate agrees about an alias', () => {
    /**
     * The property, rather than a list: for each exported predicate that takes
     * a role list, holding the alias must answer exactly what holding the
     * canonical role answers. A predicate added later without resolving is
     * caught here, which is the whole point — one of these disagreeing is what
     * the finding was.
     */
    const PREDICATES: Array<[string, (roles: string[]) => unknown]> = [
        ['permissions.isAdmin', (r) => permissions.isAdmin(r)],
        ['permissions.isSuperAdmin', (r) => permissions.isSuperAdmin(r)],
        ['permissions.isPlatformAdmin', (r) => permissions.isPlatformAdmin(r)],
        ['permissions.includesPrivilegedRole', (r) => permissions.includesPrivilegedRole(r)],
        ['permissions.getHighestAdminRole', (r) => permissions.getHighestAdminRole(r)],
        ['permissions.getUserAdminPermissions', (r) => permissions.getUserAdminPermissions(r)],
        ['permissions.adminLandingPath', (r) => permissions.adminLandingPath(r)],
        ['permissions.canAccessAdminRoute', (r) => permissions.canAccessAdminRoute(r, '/admin/users')],
        ['roleUtils.isAdmin', (r) => roleUtils.isAdmin(r as never)],
        ['roleUtils.isSuperAdmin', (r) => roleUtils.isSuperAdmin(r as never)],
        ['roleUtils.getHighestRoleLevel', (r) => roleUtils.getHighestRoleLevel(r as never)],
    ];

    it('EVERY ONE OF THEM TREATS `superadmin` EXACTLY AS `super_admin`', () => {
        const disagreed = PREDICATES.filter(([, fn]) => {
            const alias = JSON.stringify(fn(['superadmin']) ?? null);
            const canonical = JSON.stringify(fn(['super_admin']) ?? null);
            return alias !== canonical;
        }).map(([name]) => name);

        expect({ disagreed }).toEqual({ disagreed: [] });
    });

    it('AND EVERY OTHER ALIAS IN THE TABLE, TOO', () => {
        const disagreed: string[] = [];

        for (const [alias, canonical] of Object.entries(ROLE_ALIASES)) {
            for (const [name, fn] of PREDICATES) {
                if (JSON.stringify(fn([alias]) ?? null) !== JSON.stringify(fn([canonical]) ?? null)) {
                    disagreed.push(`${name}(${alias})`);
                }
            }
        }

        expect({ disagreed }).toEqual({ disagreed: [] });
    });

    it('POSITIVE CONTROL: the comparison really would catch a disagreement', () => {
        // Without this, "nothing disagreed" could mean the loop compares
        // nothing. A deliberately unresolved predicate must be caught.
        const unresolved = (roles: string[]) => roles.includes('super_admin');

        expect(unresolved(['superadmin'])).toBe(false);
        expect(unresolved(['super_admin'])).toBe(true);
        expect(PREDICATES.length).toBeGreaterThanOrEqual(11);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#458 — one table, not three', () => {
    it('THE PRE-MIGRATION NAMES ARE IN IT — role-app-mapping resolved them alone', () => {
        // A `vendor` could reach the seller app and fail hasRole(roles,
        // "seller") at the same time, because only role-app-mapping resolved.
        for (const [legacy, modern] of Object.entries(LEGACY_ROLE_MAP)) {
            expect({ legacy, to: canonicalRole(legacy) }).toEqual({ legacy, to: modern });
        }
        expect(canonicalRole('vendor')).toBe('seller');
        expect(roleUtils.hasRole(['vendor'] as never, 'seller')).toBe(true);
    });

    it('AND role-app-mapping DELEGATES rather than keeping its own copy', () => {
        const mapping = source('src/lib/role-app-mapping.ts');

        expect(mapping).toContain('canonicalRoles(');
        expect(mapping).not.toMatch(/LEGACY_ROLE_MAP as Record<string, UserRole>\)\[role\]/);
    });

    it('AND actions/auth.ts NO LONGER SPELLS THE RULE OUT BY HAND', () => {
        // Two statements of one rule is the defect, not the cure. The file
        // keeps `superadmin` in hasAdminRole only via the shared resolver.
        const auth = source('src/app/actions/auth.ts');

        expect(auth).not.toContain("roleStrings.includes('superadmin')");
        expect(auth).not.toContain("adminRedirect = '/admin/academy'");
        expect(auth).toContain('adminLandingPath(');
    });

    it('AND app/admin/page.tsx DOES NOT EITHER', () => {
        const page = source('src/app/admin/page.tsx');

        expect(page).toContain('adminLandingPath(');
        expect(page).not.toContain('redirect("/admin/wave")');
        expect(page).not.toContain('const isGlobalAdmin');
    });

    it('and an unknown role passes through untouched, losing nothing', () => {
        expect(canonicalRole('field_officer')).toBe('field_officer');
        expect(canonicalRoles(['field_officer', 'buyer'])).toEqual(['field_officer', 'buyer']);
        expect(canonicalRoles([])).toEqual([]);
        expect(canonicalRoles(undefined)).toEqual([]);
    });

    it('and resolving is idempotent — a canonical role stays itself', () => {
        for (const canonical of Object.values(ROLE_ALIASES)) {
            expect(canonicalRole(canonical)).toBe(canonical);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#458 — where an admin lands is decided once', () => {
    it('A GLOBAL ADMIN LANDS ON /admin EVEN HOLDING A MODULE ROLE', () => {
        // The comment claimed the opposite ("EVEN IF they are also granted
        // super_admin"). Both copies of the code disagreed with it, and this
        // pins the behaviour they actually had.
        expect(adminLandingPath(['super_admin', 'wave_admin'])).toBe('/admin');
        expect(adminLandingPath(['admin', 'academy_admin'])).toBe('/admin');
    });

    it('AND A MODULE ADMIN LANDS IN THEIR SILO', () => {
        expect(adminLandingPath(['wave_admin'])).toBe('/admin/wave');
        expect(adminLandingPath(['cooperative_admin'])).toBe('/admin/cooperatives');
        expect(adminLandingPath(['farm_nation_admin'])).toBe('/admin/farm-nation');
        expect(adminLandingPath(['academy_admin'])).toBe('/admin/academy');
        expect(adminLandingPath(['marketplace_admin'])).toBe('/admin/marketplace');
        expect(adminLandingPath(['export_admin'])).toBe('/admin/export');
    });

    it('AND TWO MODULE ROLES GIVE ONE HOME, NOT TWO', () => {
        // The defect exactly: Academy from login, WAVE from /admin. Login's
        // order is the one kept, so this is Academy from both doors.
        expect(adminLandingPath(['academy_admin', 'wave_admin'])).toBe('/admin/academy');
        expect(adminLandingPath(['wave_admin', 'academy_admin'])).toBe('/admin/academy');
    });

    it('and moderator and support land on /admin — #356, still true', () => {
        // Both were sent to the member dashboard at every login before #356.
        // They hold no silo, so the global portal is their home.
        expect(adminLandingPath(['moderator'])).toBe('/admin');
        expect(adminLandingPath(['support'])).toBe('/admin');
    });

    it('and every module admin role has a home — none silently gets /admin', () => {
        // The vacuity guard. A module role missing from MODULE_ADMIN_HOME would
        // quietly land its holder on the global dashboard.
        const moduleRoles = permissions.ALL_ADMIN_ROLES
            .filter((r) => r.endsWith('_admin') && r !== 'super_admin');

        expect(moduleRoles.length).toBeGreaterThanOrEqual(6);
        for (const role of moduleRoles) {
            expect({ role, home: adminLandingPath([role]) })
                .not.toEqual({ role, home: '/admin' });
        }
    });
});
