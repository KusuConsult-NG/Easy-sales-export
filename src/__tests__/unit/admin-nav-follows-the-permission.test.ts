/**
 * @jest-environment node
 */

/**
 *   #382 THE ADMIN SIDEBAR DECIDED VISIBILITY BY ROUTE PREFIX AND ROLE NAME,
 *        AND IT DISAGREED WITH THE PERMISSION MATRIX THE ACTIONS ENFORCE.
 *
 *        Every admin screen's data comes from an action that asks
 *        hasAdminPermission / requireAdmin for a named permission — #375 made
 *        that true of all of them. The sidebar asked a different question:
 *        canAccessAdminRoute, a list of route prefixes and role names.
 *
 *        Two rules for one decision, and they had drifted.
 *
 *   1.   THE EXPORT ADMIN COULD NOT READ THEIR OWN PRIMARY SCREEN.
 *
 *        /admin/export — "Export Windows", the first item in the export
 *        section — is loaded by _getAllExportRequestsAction, which asked for
 *        `finance:read`. Its holders are super_admin, admin, support,
 *        cooperative_admin and marketplace_admin. NOT export_admin.
 *
 *        Meanwhile the sidebar showed export_admin the link (their own silo),
 *        and the status WRITE admitted them — EXPORT_ADMIN_ROLES is
 *        admin/super_admin/export_admin, and #275 made that the one rule both
 *        update paths use.
 *
 *        So an export administrator followed a link their sidebar offered, on
 *        the module they administer, and the list refused them — while two
 *        admins from other modules, who cannot change a single row, could read
 *        every one. #374's asymmetry with the tighter gate on the READ, and
 *        #265's shape: a module admin locked out of their own surface.
 *
 *   2.   TWO SCREENS WERE HIDDEN FROM ROLES THEIR ACTIONS SERVE.
 *
 *        /admin/audit-logs  [audit:read — all ten admin roles]
 *            hidden from moderator and all six module admins.
 *        /admin/users       [users:read — all ten admin roles]
 *            hidden from moderator and support.
 *
 *        The actions serve them; only the link was missing. So the navigation
 *        was the only gate — the defect class where the browser is the whole
 *        control — and it hid work from the people who may do it rather than
 *        stopping anyone.
 *
 *   3.   AND THE SIDEBAR'S OWN PERMISSION MODEL GATED NOTHING.
 *
 *        `canSeeFinance`, `canSeeAnalytics`, `canSeeUsers` and the
 *        `isModuleAdmin` they were built from were computed and read by
 *        NOTHING — each name appeared once, at its own declaration, under the
 *        comment "Permissions check for specific sections". #72's defect
 *        (GATED_SEGMENTS: 22 entries and a matcher nothing imported), and
 *        worse than absent: `canSeeFinance` reads as a decision that
 *        marketplace, WAVE and cooperative admins may see Finance, and the
 *        live rule refuses all three.
 *
 *   THE FIX
 *
 *        A nav item may name the permission its own screen's actions require,
 *        and when it does, that permission decides. One rule, and it is the
 *        rule that is actually enforced one layer down. It is also the better
 *        silo: `export:approve_applications` is exactly the three roles who may
 *        work the export queue, which a "/admin/export" prefix cannot express.
 *
 *        Items with no named permission keep canAccessAdminRoute untouched.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ALL_ADMIN_ROLES,
    hasAdminPermission,
    canAccessAdminRoute,
    rolesWithPermission,
} from '@/lib/admin-permissions';

const ROOT = process.cwd();
const SIDEBAR = 'src/components/admin/AdminSidebar.tsx';
const EXPORTS = 'src/app/actions/admin/_exports.ts';

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

/** Every nav item, with the permission it declares (if any). */
function navItems(): Array<{ href: string; permission: string | null }> {
    const src = source(SIDEBAR);
    const start = src.indexOf('const NAV_ITEMS');
    const end = src.indexOf('export default function');
    expect({ start: start > -1, end: end > start }).toEqual({ start: true, end: true });

    // Parsed per LINE, not with one regex across the entry. The first draft
    // used `href:"..."[^}]*?(?:permission:"...")?\}` — a lazy quantifier
    // followed by an optional group, which happily matches the optional part
    // as empty and reported every item as declaring nothing. Every assertion
    // below then compared null with null and passed for the wrong reason.
    return src.slice(start, end)
        .split('\n')
        .map((line) => {
            const href = /href:\s*"([^"]+)"/.exec(line);
            if (!href) return null;
            const perm = /permission:\s*"([^"]+)"/.exec(line);
            return { href: href[1], permission: perm ? perm[1] : null };
        })
        .filter((x): x is { href: string; permission: string | null } => x !== null);
}

/**
 * The permission each screen's own actions require.
 *
 * Written down rather than derived, because deriving it is what the buggy
 * version of this relationship did implicitly. Each entry below was read off
 * the action, and the test after it re-checks the two that matter most.
 */
const SCREEN_PERMISSION: Record<string, string> = {
    '/admin/users': 'users:read',
    '/admin/disputes': 'finance:resolve_disputes',
    '/admin/audit-logs': 'audit:read',
    '/admin/cms': 'announcements:manage',
    '/admin/wave/shipments': 'wave:manage_training',
    '/admin/cooperatives/loan-products': 'cooperatives:approve_loans',
    '/admin/export': 'export:approve_applications',
    '/admin/export/applications': 'export:approve_applications',
    '/admin/export/bookings': 'export:approve_applications',
    '/admin/export/catalog': 'export:approve_applications',
    '/admin/academy': 'academy:manage_courses',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — the export admin can read their own screen', () => {
    it('THE LIST BEHIND /admin/export ASKS FOR THE EXPORT PERMISSION, not finance:read', () => {
        // THE test for the lockout.
        const src = source(EXPORTS);
        const at = src.indexOf('async function _getAllExportRequestsAction');
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, at + 1500);

        expect(body).toContain('hasAdminPermission(session.user.roles, "export:approve_applications")');
        expect(body).not.toContain('"finance:read"');
    });

    it('and export_admin now holds what that read requires', () => {
        expect(hasAdminPermission(['export_admin'], 'export:approve_applications' as any)).toBe(true);
        // The premise of the finding, re-measured rather than remembered.
        expect(hasAdminPermission(['export_admin'], 'finance:read' as any)).toBe(false);
    });

    it('THE READ AND THE WRITE NOW ADMIT THE SAME SET — #374\'s asymmetry, closed', () => {
        // The write path's rule, from the module's own vocabulary.
        const { EXPORT_ADMIN_ROLES } = jest.requireActual(
            '@/lib/export-window-status') as { EXPORT_ADMIN_ROLES: readonly string[] };

        const canRead = [...ALL_ADMIN_ROLES]
            .filter((r) => hasAdminPermission([r], 'export:approve_applications' as any)).sort();

        expect(canRead).toEqual([...EXPORT_ADMIN_ROLES].sort());
    });

    it('and the three roles it narrows are named, not silently dropped', () => {
        // support, cooperative_admin and marketplace_admin lose a read of
        // another module's queue that they could never act on. Deliberate, and
        // recorded where the change is.
        const raw = readFileSync(join(ROOT, EXPORTS), 'utf-8');

        expect(raw).toContain('THIS NARROWS THREE ROLES, DELIBERATELY');
        for (const role of ['support', 'cooperative_admin', 'marketplace_admin']) {
            expect({ role, mentioned: raw.includes(role) }).toEqual({ role, mentioned: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — the sidebar shows what the caller can use', () => {
    const items = navItems();

    it('the nav table is found and is not empty', () => {
        // Vacuity guard: a regex that matched nothing would make every
        // assertion below pass silently.
        expect(items.length).toBeGreaterThan(20);
        expect(items.map((i) => i.href)).toContain('/admin/export');
    });

    it('EVERY ITEM WHOSE SCREEN NAMES A PERMISSION DECLARES THAT SAME PERMISSION', () => {
        // THE test. The sidebar and the action cannot disagree, because they
        // are asserted against one another here.
        const declared = Object.fromEntries(items.map((i) => [i.href, i.permission]));

        for (const [href, permission] of Object.entries(SCREEN_PERMISSION)) {
            expect({ href, declared: declared[href] }).toEqual({ href, declared: permission });
        }
    });

    it('and the filter USES it, rather than declaring it and asking something else', () => {
        // A field that is set and never read is the defect this finding is
        // about; adding another would be ironic rather than a fix.
        const src = source(SIDEBAR);

        expect(src).toContain('item.permission');
        expect(src).toContain('hasAdminPermission(roles, item.permission)');
        expect(src).toContain('canAccessAdminRoute(roles, item.href)');

        // AND THE RESULT IS ACTED ON. Asserting only that the decision is
        // COMPUTED is exactly the defect this finding is about — `canSeeFinance`
        // was computed too. A mutant that changed the guard to `if (false)`
        // survived the first draft of this test, showing every link to
        // everybody while all three assertions above still passed.
        expect(src).toMatch(/if \(!mayUse\) \{\s*\n\s*return null;/);
    });

    it('SHOWN EXACTLY WHEN ALLOWED — no link that refuses, no work that hides', () => {
        // The whole relationship, exercised across every admin role.
        const shownTo = (href: string, role: string) => {
            const item = items.find((i) => i.href === href)!;
            return item.permission
                ? hasAdminPermission([role], item.permission as any)
                : canAccessAdminRoute([role], href);
        };

        const mismatches: string[] = [];
        for (const [href, permission] of Object.entries(SCREEN_PERMISSION)) {
            for (const role of ALL_ADMIN_ROLES) {
                const shown = shownTo(href, role);
                const allowed = hasAdminPermission([role], permission as any);
                if (shown !== allowed) mismatches.push(`${href} / ${role}: shown=${shown} allowed=${allowed}`);
            }
        }

        expect(mismatches).toEqual([]);
    });

    it('the export admin is shown the four export screens, and no other module admin is', () => {
        // The silo, expressed by the permission rather than the URL prefix.
        const exportScreens = ['/admin/export', '/admin/export/applications',
            '/admin/export/bookings', '/admin/export/catalog'];

        for (const href of exportScreens) {
            const item = items.find((i) => i.href === href)!;
            const shown = [...ALL_ADMIN_ROLES]
                .filter((r) => hasAdminPermission([r], item.permission as any)).sort();

            expect({ href, shown }).toEqual({ href, shown: ['admin', 'export_admin', 'super_admin'] });
        }
    });

    it('and the two hidden screens are now offered to the roles their actions serve', () => {
        // #382's second half. No access changes — the actions already served
        // these roles — the navigation simply stops contradicting them.
        for (const [href, permission] of [['/admin/users', 'users:read'], ['/admin/audit-logs', 'audit:read']]) {
            const item = items.find((i) => i.href === href)!;
            expect({ href, declared: item.permission }).toEqual({ href, declared: permission });

            const holders = rolesWithPermission(permission as any);
            expect(holders).toContain('moderator');
            expect(holders).toContain('support');
            // Which the route rule refused.
            expect(canAccessAdminRoute(['moderator'], href)).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#382 — the model that gated nothing is gone', () => {
    const src = source(SIDEBAR);

    it('canSeeFinance, canSeeAnalytics and canSeeUsers no longer exist', () => {
        // They were computed and read by nothing, under a comment calling them
        // a permissions check.
        for (const dead of ['canSeeFinance', 'canSeeAnalytics', 'canSeeUsers']) {
            expect({ dead, present: src.includes(dead) }).toEqual({ dead, present: false });
        }
    });

    it('nor the isModuleAdmin that existed only to feed them', () => {
        expect(src).not.toContain('isModuleAdmin');
    });

    it('and what remains is read — every role flag feeds the label', () => {
        // The opposite direction, so this cannot be "fixed" by deleting the
        // label too. Each surviving flag appears at its declaration AND in use.
        for (const flag of ['isSuperAdmin', 'isFullAdmin', 'isWaveAdmin', 'isCoopAdmin',
            'isMktAdmin', 'isExportAdmin', 'isFarmAdmin', 'isAcadAdmin']) {
            const uses = (src.match(new RegExp(`\\b${flag}\\b`, 'g')) ?? []).length;
            expect({ flag, atLeastTwice: uses >= 2 }).toEqual({ flag, atLeastTwice: true });
        }
    });

    it('the write-up survives in the file, and the sweep does not read it', () => {
        // The tombstone trap, both directions.
        const raw = readFileSync(join(ROOT, SIDEBAR), 'utf-8');

        expect(raw).toContain('THIS BLOCK CALLED ITSELF A PERMISSIONS CHECK AND CHECKED NOTHING');
        expect(src).not.toContain('THIS BLOCK CALLED ITSELF A PERMISSIONS CHECK AND CHECKED NOTHING');
        // And the prose naming the dead variables cannot satisfy the assertions
        // above, which is the point of stripping.
        expect(raw).toContain('canSeeFinance');
    });
});
