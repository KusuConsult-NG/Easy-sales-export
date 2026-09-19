/**
 * @jest-environment node
 */

/**
 *   #900 #901 THE MODULE BOUNDARY, ON BOTH SIDES OF IT.
 *
 *   THE OWNER, in one message:
 *
 *     "when a user is only onboarded on a certain module like academy and wants
 *      to send an in-app message through the message feature, user should only
 *      see the super admin and the admin that carries the name of that module
 *      and all other admin should be hidden."
 *
 *     "The admin login credentials should allow the admin access to only their
 *      module admin features and other and nothing else."
 *
 *   One boundary, asked from the member's side and from the admin's.
 *
 * ── #900 WHO A MEMBER CAN WRITE TO ──────────────────────────────────────────
 *
 *   adminIsReachableBy asked isUnscopedAdmin, which is ALL_ADMIN_ROLES minus
 *   the six module admins — so `admin`, `moderator` and `support` were
 *   reachable by everybody. An academy-only member's picker listed four staff
 *   accounts with nothing to do with the academy beside the one that has.
 *
 *   NARROWED IN THAT FUNCTION AND NOWHERE ELSE. isUnscopedAdmin answers two
 *   other questions in the same subsystem and both keep their wider answer:
 *   whether an admin may OPEN a thread (#635 records what narrowing that cost —
 *   "a support agent was handed every conversation on the platform, clicked
 *   one, and was refused"), and which admin an unrouted support request lands
 *   on.
 *
 * ── #901 WHAT AN ADMIN CAN OPEN ─────────────────────────────────────────────
 *
 *   canAccessAdminRoute gave every module admin `/admin/users` — the whole
 *   platform's user list, with the ROLES EDITOR on it — and `/admin/settings`.
 *   So an academy_admin could read and re-role every account on the platform,
 *   including other admins, under a rule whose own comment read "Strict Silo
 *   Isolation".
 *
 *   ONE EXCEPTION IS KEPT AND IS STATED AS A JUDGEMENT: `/admin/messages`. The
 *   same message asks for module admins to be the people their members write
 *   to, and an admin who cannot open the inbox cannot answer. It is not a hole
 *   either — mayAccessConversation admits a module admin only to threads in
 *   their own module's scope, so the inbox is bounded by this same boundary.
 */

import { describe, it, expect } from '@jest/globals';
import { adminIsReachableBy } from '@/lib/conversation-scope';
import { canAccessAdminRoute, adminSiloRedirect, adminLandingPath } from '@/lib/admin-permissions';

const MODULE_ADMINS = [
    'academy_admin', 'wave_admin', 'cooperative_admin',
    'marketplace_admin', 'export_admin', 'farm_nation_admin',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#900 — an academy member sees the super admin and the academy admin', () => {
    const member = ['academy_participant'];

    it('THE REPORTED CASE: the academy admin is reachable', () => {
        expect(adminIsReachableBy(['academy_admin'], member)).toBe(true);
    });

    it('AND THE SUPER ADMIN IS REACHABLE', () => {
        expect(adminIsReachableBy(['super_admin'], member)).toBe(true);
    });

    it('AND EVERY OTHER ADMIN IS HIDDEN', () => {
        /*
         *   The change. `admin`, `moderator` and `support` were all reachable
         *   by everybody through isUnscopedAdmin.
         */
        for (const roles of [['admin'], ['moderator'], ['support']]) {
            expect({ roles, reachable: adminIsReachableBy(roles, member) })
                .toEqual({ roles, reachable: false });
        }
    });

    it('AND NO OTHER MODULE\'S ADMIN IS REACHABLE', () => {
        for (const role of MODULE_ADMINS.filter((r) => r !== 'academy_admin')) {
            expect({ role, reachable: adminIsReachableBy([role], member) })
                .toEqual({ role, reachable: false });
        }
    });

    it('AND A MEMBER OF TWO MODULES REACHES BOTH — the control', () => {
        const both = ['academy_participant', 'cooperative_member'];

        expect(adminIsReachableBy(['academy_admin'], both)).toBe(true);
        expect(adminIsReachableBy(['cooperative_admin'], both)).toBe(true);
        expect(adminIsReachableBy(['wave_admin'], both)).toBe(false);
    });

    it('AND A SUPER ADMIN WHO ALSO HOLDS A MODULE ROLE IS STILL REACHABLE', () => {
        //   Real accounts hold several — production has
        //   ["super_admin","admin","export_admin","general_user"].
        expect(adminIsReachableBy(['super_admin', 'admin', 'export_admin'], member)).toBe(true);
    });

    it('AND NOBODY WITH NO ROLES IS REACHABLE', () => {
        for (const roles of [undefined, [], ['general_user']]) {
            expect({ roles, reachable: adminIsReachableBy(roles as any, member) })
                .toEqual({ roles, reachable: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#901 — a module admin reaches their module and the inbox', () => {
    it('THE REPORTED CHANGE: no module admin reaches /admin/users any more', () => {
        /*
         *   The platform's whole user list, with the roles editor on it. The
         *   plainest "not their module" in the tree.
         */
        for (const role of MODULE_ADMINS) {
            expect({ role, users: canAccessAdminRoute([role], '/admin/users') })
                .toEqual({ role, users: false });
        }
    });

    it('AND NOT /admin/settings EITHER', () => {
        for (const role of MODULE_ADMINS) {
            expect({ role, settings: canAccessAdminRoute([role], '/admin/settings') })
                .toEqual({ role, settings: false });
        }
    });

    it('AND EACH STILL REACHES THEIR OWN SILO — the control', () => {
        const home: Record<string, string> = {
            academy_admin: '/admin/academy',
            wave_admin: '/admin/wave',
            cooperative_admin: '/admin/cooperatives',
            marketplace_admin: '/admin/marketplace',
            export_admin: '/admin/export',
            farm_nation_admin: '/admin/farm-nation',
        };

        for (const [role, path] of Object.entries(home)) {
            expect({ role, own: canAccessAdminRoute([role], path) })
                .toEqual({ role, own: true });
        }
    });

    it('AND THE INBOX, WHICH IS THE ONE KEPT EXCEPTION', () => {
        for (const role of MODULE_ADMINS) {
            expect({ role, inbox: canAccessAdminRoute([role], '/admin/messages') })
                .toEqual({ role, inbox: true });
        }
    });

    it('AND NOT ANOTHER MODULE\'S SILO', () => {
        expect(canAccessAdminRoute(['academy_admin'], '/admin/cooperatives')).toBe(false);
        expect(canAccessAdminRoute(['wave_admin'], '/admin/marketplace')).toBe(false);
    });

    it('AND A GLOBAL ADMIN IS UNAFFECTED — the other control', () => {
        /*
         *   The half that would make this a lockout rather than a silo. `admin`
         *   and `super_admin` run the platform and must keep every door.
         */
        for (const roles of [['admin'], ['super_admin']]) {
            for (const path of ['/admin/users', '/admin/settings', '/admin/academy', '/admin/messages']) {
                expect({ roles, path, ok: canAccessAdminRoute(roles, path) })
                    .toEqual({ roles, path, ok: true });
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#901 — and narrowing the silo did not build a redirect loop', () => {
    it('EVERY MODULE ADMIN STILL LANDS SOMEWHERE THEY CAN OPEN', () => {
        /*
         *   #618 made a silo refusal a REDIRECT to /admin, so a rule that
         *   refuses the landing page too would bounce an admin for ever. The
         *   whole chain is walked for each role rather than reasoned about.
         */
        for (const role of MODULE_ADMINS) {
            const landing = adminLandingPath([role]);
            const redirect = landing ? adminSiloRedirect([role], landing) : null;
            const final = redirect ?? landing;

            expect({ role, final, canOpen: final ? canAccessAdminRoute([role], final) : false })
                .toEqual({ role, final: landing, canOpen: true });
        }
    });

    it('AND A REFUSED ROUTE REDIRECTS TO A PAGE THAT ACCEPTS THEM', () => {
        //   /admin/users is now refused; where they are sent must not be.
        const to = adminSiloRedirect(['academy_admin'], '/admin/users');

        expect(to).toBe('/admin');
        expect(canAccessAdminRoute(['academy_admin'], to!)).toBe(true);
    });
});
