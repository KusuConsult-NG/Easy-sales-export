/**
 * @jest-environment node
 */

/**
 *   #365 SECURITY: THREE ADMIN ACTIONS ASKED FOR A PERMISSION AND THEN FORGAVE
 *        ITS REFUSAL, SO THE MATRIX COULD NOT CLOSE THE DOOR.
 *
 *        #364 took the fifteen API routes that stated the admin rule by hand.
 *        Sweeping the rest of src turned up a worse shape than a duplicated
 *        literal — a permission check wrapped around a role literal that
 *        overrides it:
 *
 *          admin/_marketplace.ts   verifySellerAction
 *            if (!hasAdminPermission(roles, "marketplace:approve_sellers")) {
 *                // Fallback for super_admin if specific role missing, or strict check
 *                if (!roles.includes("super_admin") && !roles.includes("admin")) {
 *                    return Unauthorized;
 *                }
 *            }
 *
 *        Read it twice. The outer `if` fires when the caller does NOT hold the
 *        permission — and the inner one then lets them through anyway for
 *        holding the literal role. The permission's refusal is the ONLY thing
 *        that reaches the fallback, and the fallback is what decides. The
 *        comment beside it is an author who was not sure which of the two it
 *        was: "Fallback for super_admin if specific role missing, or strict
 *        check".
 *
 *        admin/_exports.ts had the identical shape around users:update /
 *        export:approve_applications. admin/_applications.ts had the flat
 *        version: `hasAdminPermission(roles, "users:update") ||
 *        roles?.includes("super_admin") || roles?.includes("admin")`.
 *
 *        WHY IT MATTERS WHEN NOTHING IS BROKEN TODAY. Every role the fallback
 *        admitted already holds the permission — checked against
 *        PERMISSION_MATRIX below, and that is why removing it changes nothing
 *        now. What it changes is what happens NEXT. Revoking
 *        marketplace:approve_sellers from `admin` in the matrix — a one-line
 *        edit, the whole reason #61 and #364 moved these gates onto named
 *        permissions — would have left this endpoint open, silently, because
 *        the role literal beneath it would still pass. A gate that the matrix
 *        cannot close is not a gate; it is a comment.
 *
 *        This is the same family as #245 (a kill switch that failed OPEN on a
 *        database error) and #112 (an amount check that failed open when the
 *        amount was unreadable): a control whose refusal path leads somewhere
 *        other than a refusal.
 *
 *        AND THE TAUTOLOGY. forensics.ts read
 *
 *            if (!roles?.includes("super_admin") &&
 *                (!roles?.includes("admin") && !roles?.includes("super_admin")))
 *
 *        — the same clause twice, which is what a copy-paste nobody read looks
 *        like. Same audience, now stated once.
 *
 *        WHAT ELSE MOVED. Twelve more server-side files stated the platform
 *        rule by hand and now ask isPlatformAdmin, isSuperAdmin, or the exact
 *        permission. Every one is BEHAVIOUR-IDENTICAL: feature-toggles asks
 *        config:feature_toggles, whose holders are exactly super_admin and
 *        admin; audit.ts keeps the platform audience rather than moving to
 *        audit:read, which all ten admin roles hold — widening who may read
 *        the audit log is a decision, not a refactor.
 *
 *        OWNER DECISION — audit-log-actions.ts. Its admin test is
 *        `roles.includes("admin") || roles.includes("super_admin") ||
 *        userData.role === "admin"`. Nothing in this repository writes a
 *        singular `role` onto a user document; the three hits for one are all
 *        projections that READ it. So the third clause is a grant path with no
 *        writer — but only against the code. If any user row still carries
 *        `role: "admin"` from before the migration, dropping the clause
 *        revokes their access, and there is no live database here to check.
 *        Left in place, deliberately, because revoking is the dangerous
 *        direction. Run
 *            select count(*) from users where raw_data->>'role' = 'admin';
 *        and drop the clause if it is zero.
 *
 *        OWNER DECISION — middleware.ts. `isAdmin` there is only the bypass for
 *        the WAVE gender restriction, and it is the platform pair. So a male
 *        `wave_admin` registered on or after the cutoff is redirected away
 *        from /admin/wave — the surface that role exists to administer. Whether
 *        a male WAVE admin should administer WAVE is a product question, so it
 *        is recorded rather than changed.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { rolesWithPermission } from '@/lib/admin-permissions';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

/** How many times a string occurs — because a mutant that breaks ONE of N sites
 *  slips past toContain, which four of #365's own mutants proved (M8, M11, M12,
 *  M16). Every claim about a repeated guard is a COUNT, not a presence. */
function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

/** The body of one exported action, so a claim cannot be satisfied by its neighbour. */
function fn(file: string, name: string): string {
    const src = code(file);
    const start = src.indexOf(name);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const next = rest.slice(1).search(/\n(?:async )?function _|\nexport (?:const|async function)/);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#365 — the permission is the authority, not a suggestion', () => {
    it('the seller-verification decision no longer forgives its own refusal', () => {
        const body = fn('src/app/actions/admin/_marketplace.ts', '_approveSellerVerificationAction');

        expect(body).toContain('hasAdminPermission(session.user.roles, "marketplace:approve_sellers")');
        // The fallback that overrode it.
        expect(body).not.toMatch(/includes\(\s*["']super_admin["']\s*\)/);
        expect(body).not.toMatch(/includes\(\s*["']admin["']\s*\)/);
    });

    it('and the export decision does not either', () => {
        const src = code('src/app/actions/admin/_exports.ts');
        const guard = src.slice(src.indexOf('export:approve_applications') - 400,
            src.indexOf('export:approve_applications') + 400);

        expect(guard).toContain('hasAdminPermission');
        expect(guard).not.toMatch(/includes\(\s*["'](?:super_)?admin["']\s*\)/);
    });

    it('nor the application decision', () => {
        const src = code('src/app/actions/admin/_applications.ts');

        expect(src).toContain('const isAuthorizedSession = hasAdminPermission(roles, "users:update");');
        expect(src).toContain('const isAuthorizedLive = hasAdminPermission(liveRoles, "users:update");');
    });

    it('REMOVING THE FALLBACK ADMITS NOBODY LESS — the three permissions already cover it', () => {
        // This is the whole behaviour-preservation argument, checked rather
        // than asserted. If a future matrix edit makes it false, this fails and
        // the change becomes a decision rather than a surprise.
        for (const permission of [
            'marketplace:approve_sellers',
            'users:update',
            'export:approve_applications',
        ] as const) {
            const holders = rolesWithPermission(permission);

            expect({ permission, admin: holders.includes('admin'), superAdmin: holders.includes('super_admin') })
                .toEqual({ permission, admin: true, superAdmin: true });
        }
    });

    it('and the fallback really was reachable only after a refusal', () => {
        // Vacuity guard on the finding itself: the removed code sat INSIDE the
        // failure branch of the permission check, which is what made it a
        // forgiveness rather than a second condition. Pinned from the file's
        // own account of it.
        expect(readFileSync(join(ROOT, 'src/app/actions/admin/_marketplace.ts'), 'utf-8'))
            .toContain('whose REFUSAL was forgiven');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#365 — the tautology in forensics', () => {
    it('states its audience once', () => {
        const src = code('src/app/actions/forensics.ts');

        expect(src).toContain('isPlatformAdmin(session?.user?.roles)');
        expect(src).not.toMatch(/includes\(\s*["'](?:super_)?admin["']\s*\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#365 — twelve more, all behaviour-identical', () => {
    it('feature toggles ask the permission that names them', () => {
        // config:feature_toggles is super_admin and admin — the same two the
        // hand-written test allowed.
        expect([...rolesWithPermission('config:feature_toggles')].sort())
            .toEqual(['admin', 'super_admin']);

        // BOTH writes in the file, counted. There are two, and a mutant that
        // loosened only the first survived a toContain.
        const ft = code('src/app/actions/feature-toggles.ts');

        expect(occurrences(ft, 'hasAdminPermission(session.user.roles, "config:feature_toggles")')).toBe(2);
        expect(ft).not.toContain('"audit:read"');
    });

    it('the audit log keeps the PLATFORM audience, not audit:read', () => {
        // audit:read is held by all ten admin roles. Moving the audit log read
        // onto it would let every module admin read the whole audit trail.
        expect(rolesWithPermission('audit:read').length).toBe(10);
        expect(code('src/app/actions/audit.ts')).toContain('isPlatformAdmin(session.user.roles)');
        expect(code('src/app/actions/audit.ts')).not.toContain('"audit:read"');
    });

    it('the chatbot admin is still super_admin only', () => {
        expect(code('src/app/actions/chatbot-admin.ts')).toContain('isSuperAdmin(roles)');
    });

    it('the owner-or-admin WRITE checks kept the platform pair', () => {
        // isAdmin() would have widened these to all ten roles — `support`
        // reading anybody's notifications, `moderator` editing anybody's land
        // listing. Asserted on the guard lines, not on the whole file:
        // land-actions.ts deliberately uses isAdmin() at three READ sites,
        // where any admin role may VIEW a listing it may not edit. Conflating
        // the two would have made this test demand the wrong thing.
        // COUNTED, not merely present: notifications.ts has three of these and
        // land-actions two, and a mutant that widened only the first survived
        // a toContain on both files.
        const guards = [
            ['src/app/actions/notifications.ts', 'session.user.id !== userId && !isPlatformAdmin(session.user.roles)', 3],
            ['src/app/actions/land-actions.ts', 'listingData.ownerId !== session.user.id && !isPlatformAdmin(session.user.roles)', 2],
            ['src/app/actions/wave/_wv_membership.ts', 'session.user.id !== userId && !isPlatformAdmin(session.user.roles)', 1],
        ] as const;

        for (const [file, guard, count] of guards) {
            expect({ file, found: occurrences(code(file), guard) }).toEqual({ file, found: count });
        }
    });

    it('and land-actions keeps isAdmin() where it means "may VIEW"', () => {
        // Stated so the exclusion above is a judgement, not an oversight.
        const src = code('src/app/actions/land-actions.ts');

        expect(src).toContain('isAdmin(viewer!.roles)');
        expect(src).toContain('isPlatformAdmin(session.user.roles)');
    });

    it('and the briefing fallback is no longer narrower than what it falls back from', () => {
        // It was `catch { isUserAdmin = admin || super_admin }` beneath
        // `isUserAdmin = isAdmin(roles)`. The two answers differed by eight
        // roles depending on whether a lookup threw.
        expect(code('src/app/actions/briefing.ts')).toContain('isPlatformAdmin(roles)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#365 — RECORDED: two grants this repository cannot settle by itself', () => {
    it('audit-log-actions still accepts a singular role that nothing writes', () => {
        // Kept on purpose. See the owner decision in the header: revoking is
        // the dangerous direction and there is no live database here.
        const src = code('src/app/actions/audit-log-actions.ts');

        // BOTH guards in the file. Removing one and leaving the other would be
        // worse than removing both: two doors onto the audit log with
        // different answers. Mutation M16 did exactly that and survived a
        // toContain.
        expect(occurrences(src, 'userData?.role === "admin"')).toBe(2);

        // And the claim it rests on: nothing writes a singular `role` onto a
        // user document. Every hit is a projection that reads one.
        expect(code('src/app/api/users/[userId]/route.ts')).toContain("role: userData?.role || 'member'");
    });

    it('and the middleware bypass excludes the WAVE admin from the WAVE admin area', () => {
        const src = code('src/middleware.ts');

        expect(src).toContain('const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");');
        expect(src).toContain('pathname.startsWith("/admin/wave")');
        // wave_admin is not in that test, and the block covers /admin/wave.
        expect(src.slice(src.indexOf('const isAdmin ='), src.indexOf('const isAdmin =') + 200))
            .not.toContain('wave_admin');
    });
});
