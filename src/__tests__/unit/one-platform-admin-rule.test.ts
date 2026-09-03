/**
 * @jest-environment node
 */

/**
 *   #364 SECURITY: FIFTEEN API ROUTES STATED THE ADMIN RULE BY HAND, AND #356
 *        FIXED SIX COPIES ELSEWHERE WITHOUT SEEING ANY OF THEM.
 *
 *        Every one of these carried its own copy of
 *
 *            if (!session?.user?.roles?.includes("admin") &&
 *                !session?.user?.roles?.includes("super_admin")) { ...403... }
 *
 *        None of them can see PERMISSION_MATRIX. #356 replaced six copies of a
 *        DIFFERENT shape — the `isAdmin`-style checks — and its ratchet was
 *        scoped to role names ending in `_admin`, which this shape does not
 *        contain. So the API layer kept fifteen independent statements of one
 *        rule, in a directory where every file is a door open to the internet.
 *
 *        WHAT THAT COST, CONCRETELY
 *        --------------------------
 *        isAdmin() is true for all TEN admin roles. These tests were true for
 *        two. Nine roles were therefore refused everywhere, including on their
 *        own surfaces:
 *
 *          academy_admin      could not open /api/certificates/[id],
 *                             /api/certificates/download or /api/qr/verify —
 *                             the certificate routes. CONTENT_TYPE_PERMISSION
 *                             in admin-permissions.ts already maps
 *                             certificates → academy:issue_certificates, and
 *                             academy_admin holds it. One half of the codebase
 *                             said the academy admin issues certificates and
 *                             the other half would not let them look at one.
 *
 *          cooperative_admin  could not use /api/admin/verify-id/lookup, which
 *                             looks a cooperative member up by member number.
 *                             That is the cooperative admin's job, and
 *                             cooperative_admin holds
 *                             cooperatives:approve_members.
 *
 *        And the same write had two rules depending on the door: saving
 *        platform settings through _savePlatformSettingsAction requires
 *        hasAdminPermission(roles, "config:update"); saving them through
 *        /api/admin/settings/localization required "one of these two role
 *        names". They agree today. Nothing made them agree.
 *
 *        WHAT WAS DONE
 *        -------------
 *        admin-permissions.ts gains PLATFORM_ADMIN_ROLES and isPlatformAdmin(),
 *        DERIVED from the matrix (a role holding config:update) rather than
 *        written down — because the hand-written ["admin","super_admin"] in
 *        PRIVILEGED_ROLES is precisely what went stale when the module-admin
 *        roles were added.
 *
 *        Eleven routes now ask isPlatformAdmin / isSuperAdmin / a named
 *        permission whose holders are exactly the two roles that passed before:
 *        BEHAVIOUR IS UNCHANGED, and the rule is in one place.
 *
 *        Four routes change deliberately, each toward the role that owns the
 *        surface:
 *
 *          /api/certificates/[id]            + academy_admin
 *          /api/certificates/download        + academy_admin
 *          /api/qr/verify                    + academy_admin
 *          /api/admin/verify-id/lookup       + cooperative_admin
 *
 *        And two reads widen to `support`, the read-only assistance role, which
 *        holds config:read by design:
 *
 *          /api/admin/settings/localization GET
 *          /api/admin/settings/notifications GET
 *
 *        The security settings read does NOT: lockout thresholds and the MFA
 *        switch are security posture rather than ordinary configuration, so it
 *        asks for security:view_logs, whose holders are the same two roles as
 *        before.
 *
 *        WHAT IS RECORDED AND NOT REPAIRED
 *        ---------------------------------
 *        The same shape appears in 33 more files outside src/app/api — server
 *        actions, lib, middleware and components. They are NOT all the same
 *        question: several are deliberate three-role gates (academy live
 *        sessions add academy_admin, WAVE access adds wave_admin), several test
 *        the TARGET user's roles rather than the caller's, and the component
 *        ones decide what to draw rather than what to allow. Sweeping them
 *        needs the per-site triage #356 did, not a find-and-replace.
 *
 *        OWNER DECISION: adopt isPlatformAdmin across those 33 files, or state
 *        which of them are deliberately different. The ratchet at the bottom
 *        holds the list at its current size so it cannot grow while the
 *        decision is open.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import {
    PLATFORM_ADMIN_ROLES,
    isPlatformAdmin,
    isAdmin,
    isSuperAdmin,
    rolesWithPermission,
    ALL_ADMIN_ROLES,
} from '@/lib/admin-permissions';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

/** The hand-written shape, as it appears after comments are removed. */
const HAND_WRITTEN = /includes\(\s*["'](?:super_)?admin["']\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel, out);
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC_FILES = walk('src');
const API_ROUTES = SRC_FILES.filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f));

function filesWithHandWrittenCheck(files: string[]): string[] {
    return files.filter((f) => code(f).split('\n').some((line) => HAND_WRITTEN.test(line))).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — isPlatformAdmin is narrower than isAdmin, and derived', () => {
    it('is true for exactly the two platform roles', () => {
        expect([...PLATFORM_ADMIN_ROLES].sort()).toEqual(['admin', 'super_admin']);
        expect(isPlatformAdmin(['super_admin'])).toBe(true);
        expect(isPlatformAdmin(['admin'])).toBe(true);
    });

    it('and false for every module admin — which is the whole point', () => {
        // These nine all pass isAdmin(). The fifteen routes refused them.
        for (const role of ALL_ADMIN_ROLES.filter((r) => !PLATFORM_ADMIN_ROLES.includes(r))) {
            expect({ role, platform: isPlatformAdmin([role]), admin: isAdmin([role]) })
                .toEqual({ role, platform: false, admin: true });
        }
    });

    it('and false for no roles at all', () => {
        expect(isPlatformAdmin(undefined)).toBe(false);
        expect(isPlatformAdmin([])).toBe(false);
        expect(isPlatformAdmin(['general_user', 'seller'])).toBe(false);
    });

    it('is DERIVED from config:update, not written down', () => {
        // The hand-written ["admin","super_admin"] in PRIVILEGED_ROLES went
        // stale when the module-admin roles were added. This one cannot.
        expect([...PLATFORM_ADMIN_ROLES].sort()).toEqual([...rolesWithPermission('config:update')].sort());
    });

    it('and is not a synonym for isSuperAdmin', () => {
        expect(isPlatformAdmin(['admin'])).toBe(true);
        expect(isSuperAdmin(['admin'])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — THE RATCHET: no API route states the rule by hand', () => {
    it('finds the routes, so this is not vacuous', () => {
        expect(API_ROUTES.length).toBeGreaterThan(100);
    });

    it('NOT ONE ROUTE UNDER src/app/api CARRIES THE HAND-WRITTEN CHECK', () => {
        expect(filesWithHandWrittenCheck(API_ROUTES)).toEqual([]);
    });

    it('and the fifteen that did now ask the shared authority', () => {
        const REPAIRED = [
            'src/app/api/admin/add-roles/route.ts',
            'src/app/api/admin/debug-users/route.ts',
            'src/app/api/admin/feature-toggles/seed/route.ts',
            'src/app/api/admin/orphaned-users/route.ts',
            'src/app/api/admin/reconcile-sweep/route.ts',
            'src/app/api/admin/schema-fix/route.ts',
            'src/app/api/admin/settings/localization/route.ts',
            'src/app/api/admin/settings/notifications/route.ts',
            'src/app/api/admin/settings/security/route.ts',
            'src/app/api/admin/verify-id/lookup/route.ts',
            'src/app/api/cache/monitor/route.ts',
            'src/app/api/certificates/[id]/route.ts',
            'src/app/api/certificates/download/route.ts',
            'src/app/api/qr/verify/route.ts',
            'src/app/api/users/[userId]/route.ts',
        ];

        for (const file of REPAIRED) {
            expect({ file, importsAuthority: /@\/lib\/admin-permissions/.test(code(file)) })
                .toEqual({ file, importsAuthority: true });
        }
    });

    it('the sweep is measured on code, not on comments', () => {
        // Vacuity guard, and the sixth-and-seventh-time trap in this audit:
        // four of the repaired routes quote the check they removed in a #364
        // note, so a sweep over raw source reports the defect it just fixed.
        const raw = readFileSync(join(ROOT, 'src/app/api/qr/verify/route.ts'), 'utf-8');

        expect(HAND_WRITTEN.test(raw)).toBe(true);
        expect(HAND_WRITTEN.test(code('src/app/api/qr/verify/route.ts'))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — eleven routes keep exactly the audience they had', () => {
    it('config:update is super_admin and admin, so the settings writes are unchanged', () => {
        expect([...rolesWithPermission('config:update')].sort()).toEqual(['admin', 'super_admin']);
    });

    it('security:view_logs is the same two, so the security read is unchanged', () => {
        // Chosen over config:read precisely BECAUSE it does not include support.
        expect([...rolesWithPermission('security:view_logs')].sort()).toEqual(['admin', 'super_admin']);

        // And the route asks for THAT permission. Asserting only the holder set
        // left mutation M8 alive: swapping the route to config:read widened the
        // read to `support` while every assertion above still passed, because
        // none of them looked at the route.
        const sec = code('src/app/api/admin/settings/security/route.ts');
        const get = sec.slice(sec.indexOf('export async function GET'), sec.indexOf('export async function POST'));

        expect(get).toContain('"security:view_logs"');
        expect(get).not.toContain('"config:read"');
    });

    it('and the routes that kept the platform audience say so', () => {
        for (const file of [
            'src/app/api/admin/orphaned-users/route.ts',
            'src/app/api/admin/reconcile-sweep/route.ts',
            'src/app/api/admin/debug-users/route.ts',
            'src/app/api/cache/monitor/route.ts',
            'src/app/api/users/[userId]/route.ts',
            'src/app/api/admin/add-roles/route.ts',
        ]) {
            expect({ file, uses: code(file).includes('isPlatformAdmin(') })
                .toEqual({ file, uses: true });
        }
    });

    it('the two super-admin-only routes are still super-admin-only', () => {
        for (const file of [
            'src/app/api/admin/schema-fix/route.ts',
            'src/app/api/admin/feature-toggles/seed/route.ts',
        ]) {
            expect({ file, uses: code(file).includes('isSuperAdmin(') })
                .toEqual({ file, uses: true });
        }
        // config:feature_toggles would have WIDENED the seed route to `admin`.
        // Not done: widening is a decision, not a refactor's side effect.
        expect([...rolesWithPermission('config:feature_toggles')].sort())
            .toEqual(['admin', 'super_admin']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — four routes deliberately admit the role that owns them', () => {
    it('academy_admin can now reach the certificate routes', () => {
        expect(rolesWithPermission('academy:issue_certificates')).toContain('academy_admin');

        for (const file of [
            'src/app/api/certificates/[id]/route.ts',
            'src/app/api/certificates/download/route.ts',
            'src/app/api/qr/verify/route.ts',
        ]) {
            expect({ file, asks: code(file).includes('"academy:issue_certificates"') })
                .toEqual({ file, asks: true });
        }
    });

    it('cooperative_admin can now look a cooperative member up', () => {
        expect(rolesWithPermission('cooperatives:approve_members')).toContain('cooperative_admin');
        expect(code('src/app/api/admin/verify-id/lookup/route.ts'))
            .toContain('"cooperatives:approve_members"');
    });

    it('neither widening reaches a role with no business there', () => {
        // The permission is the boundary; state what it excludes so a matrix
        // change that widens it fails here rather than silently.
        expect([...rolesWithPermission('academy:issue_certificates')].sort())
            .toEqual(['academy_admin', 'admin', 'super_admin']);
        expect([...rolesWithPermission('cooperatives:approve_members')].sort())
            .toEqual(['admin', 'cooperative_admin', 'super_admin']);
    });

    it('and the two settings reads widen only to support, which holds config:read', () => {
        expect([...rolesWithPermission('config:read')].sort())
            .toEqual(['admin', 'super_admin', 'support']);

        for (const file of [
            'src/app/api/admin/settings/localization/route.ts',
            'src/app/api/admin/settings/notifications/route.ts',
        ]) {
            const src = code(file);
            expect({ file, read: src.includes('"config:read"'), write: src.includes('"config:update"') })
                .toEqual({ file, read: true, write: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — and the three settings writes now leave a trace', () => {
    /**
     * Found by an existing ratchet, which is the argument for keeping them.
     *
     * admin-action-audit-trail.test.ts fails when a PERMISSION-GATED admin
     * write records nothing. Naming the permission on the two settings POSTs
     * brought them inside its scope, and it immediately said they recorded
     * nothing — while _savePlatformSettingsAction, the Server Action door onto
     * the same collection, has written `config_updated` all along. Two doors,
     * one write, one of them leaving no trace of who changed what.
     *
     * The security route is gated on isSuperAdmin rather than a permission, so
     * the ratchet cannot see it. It records anyway: it sets the session
     * lifetime, MFA enforcement and the lockout thresholds.
     */
    for (const file of [
        'src/app/api/admin/settings/localization/route.ts',
        'src/app/api/admin/settings/notifications/route.ts',
        'src/app/api/admin/settings/security/route.ts',
    ]) {
        it(`${file} records config_updated`, () => {
            const post = code(file).slice(code(file).indexOf('export async function POST'));

            expect(post).toContain('recordAdminAction({');
            expect(post).toContain('action: "config_updated"');
            expect(post).toContain('userId: session.user.id');
        });
    }

    it('using the helper that cannot fail the write it records', () => {
        // recordAdminAction swallows and shouts; createAuditLog rethrows. An
        // audit write must not be able to break a settings save.
        for (const file of [
            'src/app/api/admin/settings/localization/route.ts',
            'src/app/api/admin/settings/notifications/route.ts',
            'src/app/api/admin/settings/security/route.ts',
        ]) {
            expect({ file, safe: !/\bcreateAuditLog\b/.test(code(file)) })
                .toEqual({ file, safe: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#364 — RECORDED, NOT REPAIRED: the same shape outside src/app/api', () => {
    /**
     * Thirty-three files. NOT all the same question — see the header. The list
     * may shrink; it may not grow. A file that leaves it must be deleted from
     * here, which is the only way the decision above gets closed.
     */
    const STILL_HAND_WRITTEN = [
        'src/app/academy/live/[courseId]/page.tsx',
        'src/app/actions/academy/_ac_live.ts',
        'src/app/actions/admin-users.ts',
        'src/app/actions/admin/_applications.ts',
        'src/app/actions/admin/_exports.ts',
        'src/app/actions/admin/_marketplace.ts',
        'src/app/actions/audit-log-actions.ts',
        'src/app/actions/audit.ts',
        'src/app/actions/auth.ts',
        'src/app/actions/briefing.ts',
        'src/app/actions/bulk-user-operations.ts',
        'src/app/actions/chatbot-admin.ts',
        'src/app/actions/feature-toggles.ts',
        'src/app/actions/forensics.ts',
        'src/app/actions/land-actions.ts',
        'src/app/actions/messages.ts',
        'src/app/actions/notifications.ts',
        'src/app/actions/wave/_wv_applications.ts',
        'src/app/actions/wave/_wv_membership.ts',
        'src/app/admin/export/catalog/page.tsx',
        'src/app/admin/page.tsx',
        'src/app/admin/settings/security/page.tsx',
        'src/app/escrow/[id]/chat/page.tsx',
        'src/app/marketplace/products/page.tsx',
        'src/app/wave/(member)/live-training/page.tsx',
        'src/components/admin/AdminSidebar.tsx',
        'src/components/dashboard/DashboardNav.tsx',
        'src/components/layout/Sidebar.tsx',
        'src/lib/admin-permissions.ts',
        'src/lib/cooperative-admin-scope.ts',
        'src/lib/wave-access.ts',
        'src/lib/wave-eligibility.ts',
        'src/middleware.ts',
    ];

    it('THE LIST IS EXACTLY THE RECORDED ONE', () => {
        const found = filesWithHandWrittenCheck(SRC_FILES.filter((f) => !API_ROUTES.includes(f)));

        expect(found).toEqual([...STILL_HAND_WRITTEN].sort());
    });

    it('admin-permissions.ts is on that list because it IS the authority', () => {
        // Vacuity guard on the list's meaning: one entry is correct by
        // definition, and reading the list as "33 defects" would be wrong.
        expect(code('src/lib/admin-permissions.ts')).toContain('export function isSuperAdmin');
        expect(code('src/lib/admin-permissions.ts')).toContain('export function isPlatformAdmin');
    });

    it('and three of them are deliberate three-role gates, not copies of this rule', () => {
        // Stated so the owner decision is about the rest, not about these.
        expect(code('src/app/actions/academy/_ac_live.ts')).toContain('academy_admin');
        expect(code('src/lib/wave-access.ts')).toContain('wave_admin');
        expect(code('src/app/wave/(member)/live-training/page.tsx')).toContain('trainer');
    });
});
