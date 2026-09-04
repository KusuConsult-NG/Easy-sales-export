/**
 * @jest-environment node
 */

/**
 *   #203 THE TWO ANNOUNCEMENT DOORS DISAGREED ABOUT WHO — AND SO DID THE THREE
 *        GATES ON THE SAME SCREEN.
 *
 *        There are two createAnnouncementActions:
 *
 *          cms.ts                  what the CMS screen calls. Gated on a
 *                                  hand-written guard whose test was
 *                                  isAdmin(liveRoles).
 *          admin-communications.ts referenced by no screen. Gated on
 *                                  requireAdmin("announcements:manage").
 *
 *        #281 hardened the first — live roles instead of the stale JWT, plus a
 *        banned check — and deliberately left the BREADTH alone, because
 *        swapping to lib/require-admin.ts would have narrowed it and #265's
 *        lockout had already been caused once by this audit. It recorded the
 *        disagreement and left the policy question open.
 *
 *   THE QUESTION WAS WIDER THAN RECORDED, AND THE PLATFORM HAD ALREADY ANSWERED
 *
 *        isAdmin() is a role-SHAPE test — it returns true for all TEN admin
 *        roles. So the door accepted not only moderator and support but
 *        wave_admin, academy_admin, cooperative_admin, marketplace_admin,
 *        export_admin and farm_nation_admin: any of them could publish a
 *        notice, or a banner, to every visitor of the platform.
 *
 *        MEANWHILE TWO OTHER GATES ON THE SAME SCREEN ALREADY SAID NO.
 *
 *          canAccessAdminRoute("/admin/cms")  falls through to its default,
 *                                             `admin || super_admin`
 *          AdminSidebar                       gates the link on
 *                                             `announcements:manage` (#382)
 *
 *        So the layout would not render the page for those eight roles and the
 *        nav would not show them the link — and the server action, the only one
 *        of the three that actually decides anything, accepted them. That is
 *        the browser being the whole gate, which is the shape #339, #364 and
 *        #365 each closed elsewhere.
 *
 *   THE DECISION
 *
 *        PERMISSION_MATRIX decides, on both doors. It is not a new policy: the
 *        matrix holds `announcements:manage` for super_admin and admin, and
 *        says what the others are for in its own words — moderator is "Content
 *        moderation only" (approving and rejecting what other people wrote) and
 *        support is "Read-only + basic user assistance". Authoring a message
 *        that reaches everybody is neither.
 *
 *        cms.ts's hand-written guard is gone. lib/require-admin.ts already did
 *        everything it did — live roles, the banned/suspended check, a
 *        fail-closed catch — AND asks the matrix for a named permission. #281's
 *        stated reason for not calling it (its role test is narrower than
 *        isAdmin) is answered by the permission argument: the breadth is no
 *        longer a property of the guard, it is a row of the matrix, and
 *        changing who may post is a one-line change there.
 *
 *   THIS SUITE HOLDS THE AGREEMENT, not any one gate. Each of the three is
 *   asserted against the matrix rather than against a copy of the answer, so
 *   granting the permission to a role moves all three together and this suite
 *   follows.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ALL_ADMIN_ROLES,
    canAccessAdminRoute,
    hasAdminPermission,
    rolesWithPermission,
} from '@/lib/admin-permissions';

const ROOT = process.cwd();

const CMS_ACTIONS = 'src/app/actions/cms.ts';
const OTHER_DOOR = 'src/app/actions/admin-communications.ts';
const SIDEBAR = 'src/components/admin/AdminSidebar.tsx';
const SCREEN = 'src/app/admin/cms/page.tsx';

const CMS_ROUTE = '/admin/cms';
const PERMISSION = 'announcements:manage';

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#203 — who may publish to everybody', () => {
    it('THE MATRIX NARROWS — this is not a permission every admin role holds', () => {
        // Without this the agreement below would hold vacuously for a
        // permission all ten hold, and prove nothing at all.
        const holders = [...rolesWithPermission(PERMISSION)].sort();

        expect(holders).toEqual(['admin', 'super_admin']);
        expect(holders.length).toBeLessThan(ALL_ADMIN_ROLES.length);
    });

    it('the eight it excludes include the two the finding named, and six more', () => {
        const excluded = ALL_ADMIN_ROLES.filter((r) => !hasAdminPermission([r], PERMISSION));

        expect(excluded.sort()).toEqual([
            'academy_admin', 'cooperative_admin', 'export_admin', 'farm_nation_admin',
            'marketplace_admin', 'moderator', 'support', 'wave_admin',
        ]);
    });

    it('THE ROUTE GATE AND THE MATRIX AGREE, role for role', () => {
        // The layout would not render /admin/cms for a role the matrix refuses.
        for (const role of ALL_ADMIN_ROLES) {
            expect({ role, route: canAccessAdminRoute([role], CMS_ROUTE) })
                .toEqual({ role, route: hasAdminPermission([role], PERMISSION) });
        }
    });

    it('THE NAV GATES THE LINK ON THE SAME PERMISSION', () => {
        const nav = source(SIDEBAR);
        const entry = nav.split('\n').find((l) => l.includes(`href: "${CMS_ROUTE}"`));

        expect(entry).toBeDefined();
        expect(entry).toContain(`permission: "${PERMISSION}"`);
    });

    it('AND SO DOES THE ACTION — the gate that actually decides', () => {
        // The one that used to accept all ten. Four writes: create and
        // deactivate, announcement and banner.
        const src = source(CMS_ACTIONS);
        const gates = src.match(/requireAdmin\("announcements:manage"\)/g) ?? [];

        expect(gates.length).toBe(4);
        expect(src).toContain('from "@/lib/require-admin"');
    });

    it('THE SECOND DOOR NAMES THE SAME PERMISSION, so the two agree now', () => {
        // This one was always right. It is the disagreement that was the
        // finding, and it is gone.
        expect(source(OTHER_DOOR)).toContain(`requireAdmin("${PERMISSION}")`);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#203 — the hand-written guard is gone, not merely bypassed', () => {
    it('THERE IS NO LOCAL requireAdmin IN cms.ts', () => {
        // A second implementation left in place is how the wrong one gets
        // wired back — #276, #277 and #297 are all that shape.
        expect(source(CMS_ACTIONS)).not.toMatch(/async function requireAdmin/);
    });

    it('and no write in the file decides on a role-shape test', () => {
        const src = source(CMS_ACTIONS);

        expect(src).not.toMatch(/isAdmin\(liveRoles\)/);
        expect(src).not.toMatch(/isAdmin\(session\.user\.roles\)/);
    });

    it('isAdmin survives only where it is the RIGHT question', () => {
        /**
         * entitledAudiences decides who may SEE an announcement addressed to
         * "admins". "Is this person an admin of some kind" is exactly that
         * question, and it is a read, not a publish. Narrowing it would hide a
         * staff notice from the staff it is for.
         */
        const src = source(CMS_ACTIONS);
        const uses = src.match(/isAdmin\(/g) ?? [];

        expect(uses.length).toBe(1);
        const fn = src.slice(src.indexOf('function entitledAudiences'));
        expect(fn).toContain('isAdmin(held)');
    });

    it('every write is gated — none slipped through on a bare gate', () => {
        expect(source(CMS_ACTIONS)).not.toMatch(/requireAdmin\(\s*\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#203 — a refusal reaches the person who was refused', () => {
    it('THE SCREEN SHOWS THE SERVER\'S REASON rather than a generic failure', () => {
        // A narrowed gate that fails silently is worse than a wide one: the
        // moderator presses Publish, nothing happens, and nothing says why.
        const src = source(SCREEN);

        expect(src).toContain('showToast(res?.error || "Could not publish the announcement", "error")');
        expect(src).toContain('showToast(res?.error || "Could not publish the banner", "error")');
    });
});
