/**
 * @jest-environment node
 */

/**
 *   #281 A DEMOTED OR SUSPENDED ADMIN COULD STILL POST A PLATFORM-WIDE
 *        ANNOUNCEMENT OR BANNER, AND TAKE DOWN A REAL ONE.
 *
 *        cms.ts defines its own local requireAdmin, and it read
 *        `isAdmin(session.user.roles)` — the roles carried in the JWT — and
 *        nothing else. So it decided on a snapshot taken when the token was
 *        minted:
 *
 *          revoke somebody's admin role   they keep CMS write access until
 *                                         their token refreshes
 *          suspend or ban the account     the guard never looks, so the ban
 *                                         changes nothing here at all
 *
 *        Measured before the fix, not inferred. With a JWT saying "admin" over
 *        a live record saying "general_user":
 *
 *            {"error":null,"success":true,"announcementId":"fake-1"}
 *
 *        and the row was written. With `isBanned: true` on the live record, the
 *        same. Four functions share that guard — createAnnouncementAction,
 *        deactivateAnnouncementAction, createBannerAction and
 *        deactivateBannerAction — so it covers taking a live announcement DOWN
 *        as well as putting one up.
 *
 *        THERE ARE TWO createAnnouncementActions AND THE OTHER ONE WAS RIGHT.
 *        admin-communications.ts uses lib/require-admin.ts, which exists for
 *        precisely this and says so: "Re-fetch roles live from Firestore
 *        (bypasses the stale JWT)", plus a banned/suspended check while it has
 *        the document. The admin CMS page imports from cms.ts. The same shape
 *        as #276 and #277 — the hardened implementation is not the wired one —
 *        and the same sentence as #242, which was "suspending a seller
 *        suspended nothing", said about an admin instead.
 *
 * WHAT #281 DELIBERATELY LEFT, AND WHAT #203 THEN DECIDED
 * -------------------------------------------------------
 * #281 changed only the SOURCE of the roles — token to live document, plus the
 * banned check — and left the BREADTH alone, because lib/require-admin.ts's
 * role test is `admin | super_admin | *_admin` while isAdmin() also accepts
 * `moderator` and `support`. Swapping wholesale would have taken the
 * announcements screen away from roles that had it: #265's lockout, which this
 * audit caused once already.
 *
 * #203 TOOK THAT DECISION, AND THE QUESTION WAS WIDER THAN RECORDED. isAdmin()
 * is a role-SHAPE test that returns true for all TEN admin roles, so the door
 * accepted not only moderator and support but wave_admin, academy_admin,
 * cooperative_admin, marketplace_admin, export_admin and farm_nation_admin —
 * any of whom could publish a notice, or a banner, to every visitor.
 *
 * PERMISSION_MATRIX holds `announcements:manage` for super_admin and admin, and
 * says what the others are for in its own words: moderator is "Content
 * moderation only" — approving and rejecting what other people wrote — and
 * support is "Read-only + basic user assistance". The platform had already
 * taken the same decision on the other side of this screen: AdminSidebar gates
 * /admin/cms on `announcements:manage` (#382), so the link was already hidden
 * from those eight roles while the server still accepted them. The nav said one
 * thing and the action another.
 *
 * So the matrix decides now, on both doors, and cms.ts's hand-written guard is
 * gone: lib/require-admin.ts does everything it did AND asks the matrix. The
 * breadth is no longer a property of a guard, it is a row of the matrix, and
 * changing who may post is a one-line change there.
 *
 * A NOTE ON HOW THIS WAS FOUND, BECAUSE THE FIRST DIAGNOSIS WAS WRONG
 * ------------------------------------------------------------------
 * The scan that found it flagged cms.ts for testing `if (!admin)` where every
 * other requireAdmin() caller in the codebase tests `"error" in x`. The first
 * conclusion — that the guard was dead code, because lib/require-admin.ts
 * never returns a falsy value — was WRONG: cms.ts calls a LOCAL requireAdmin
 * with a `{ id } | null` contract, for which `!admin` is exactly right.
 *
 * The probe that "confirmed" it was wrong too. It mocked `@/lib/auth` while the
 * local helper calls `requireSession`, so a plain user appeared to get through
 * when nothing of the sort had happened. Re-run against the right seam, a plain
 * user is correctly refused — and the real defect, one layer down, is the one
 * above.
 *
 * Recorded because the pattern is worth more than the fix: a naming collision
 * between two helpers made a correct line look broken, and the first
 * confirmation was an artefact of mocking the wrong module.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const CMS = 'src/app/actions/cms.ts';
const PAGE = 'src/app/admin/cms/page.tsx';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#281 — the CMS admin check reads the live record', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    /**
     * jwtRoles and liveRoles are separated on purpose: the whole finding is
     * that they can disagree, and the old guard only ever saw the first.
     */
    async function post(opts: {
        jwtRoles: string[];
        liveRoles?: string[];
        live?: Record<string, unknown>;
        seedUser?: boolean;
    }) {
        const jwtSession = { user: { id: 'u1', email: 'u@e.test', roles: opts.jwtRoles } };
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: jwtSession, error: null }),
        }));
        /**
         * #203. The write is gated on lib/require-admin.ts now, which reads
         * auth() rather than requireSession. Left at jest.setup's default of
         * null it refuses EVERYBODY — and every refusal case below would then
         * pass for a reason that has nothing to do with the finding.
         */
        jest.doMock('@/lib/auth', () => ({ auth: async () => jwtSession }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        if (opts.seedUser !== false) {
            store.seed(COLLECTIONS.USERS, 'u1', {
                uid: 'u1',
                roles: opts.liveRoles ?? opts.jwtRoles,
                ...(opts.live ?? {}),
            });
        }

        const { createAnnouncementAction } = await import('@/app/actions/cms');
        const res: any = await (createAnnouncementAction as any)({
            title: 'Platform notice',
            message: 'Body',
            type: 'info',
            priority: 'high',
            targetAudience: 'all',
        });

        return { res, rows: store.size('announcements') };
    }

    it('REFUSES AN ADMIN WHOSE ROLE HAS BEEN REVOKED', async () => {
        // The defect. The token still says admin; the record does not.
        const { res, rows } = await post({ jwtRoles: ['admin'], liveRoles: ['general_user'] });

        expect(res.success).toBe(false);
        expect(rows).toBe(0);
    });

    it('AND REFUSES A SUSPENDED OR BANNED ONE', async () => {
        // The other half, and the one the old guard could not even express:
        // it never read the document, so no ban field could have reached it.
        for (const live of [{ isBanned: true }, { status: 'banned' }, { suspended: true }]) {
            const { res, rows } = await post({ jwtRoles: ['admin'], liveRoles: ['admin'], live });

            expect({ live, ok: res.success, rows }).toEqual({ live, ok: false, rows: 0 });
        }
    });

    it('still lets a real admin post, so the screen is not bricked', async () => {
        const { res, rows } = await post({ jwtRoles: ['admin'] });

        expect(res.success).toBe(true);
        expect(rows).toBe(1);
    });

    it('#203 — AND EVERY ROLE WITHOUT announcements:manage IS REFUSED', async () => {
        /**
         * The decision, measured. isAdmin() accepted all TEN admin roles, so
         * eight of them could publish to every visitor of the platform. The
         * matrix holds `announcements:manage` for two, and the sidebar already
         * hid the screen from the rest — the server is what disagreed.
         *
         * Asserted against the matrix rather than a copy of it, so adding the
         * permission to a role is one change in one place and this test follows
         * it. That is the whole point of moving off isAdmin().
         */
        const { ALL_ADMIN_ROLES, rolesWithPermission } =
            await import('@/lib/admin-permissions');
        const allowed = new Set(rolesWithPermission('announcements:manage'));

        // Guard the premise: this must be a PROPER subset, or the test below
        // is comparing every role with every role and proves nothing.
        expect(allowed.size).toBeGreaterThan(0);
        expect(allowed.size).toBeLessThan(ALL_ADMIN_ROLES.length);

        for (const role of ALL_ADMIN_ROLES) {
            const { res, rows } = await post({ jwtRoles: [role] });
            expect({ role, ok: res.success, rows })
                .toEqual({ role, ok: allowed.has(role), rows: allowed.has(role) ? 1 : 0 });
        }
    });

    it('and an ordinary user is refused, as they always were', async () => {
        // Vacuity guard. This case passed before the fix too — the defect was
        // never that the guard did nothing, only that it read a stale source.
        const { res, rows } = await post({ jwtRoles: ['general_user'] });

        expect(res.success).toBe(false);
        expect(rows).toBe(0);
    });

    it('REFUSES WHEN THE RECORD IS ABSENT', async () => {
        const { res, rows } = await post({ jwtRoles: ['admin'], seedUser: false });

        expect(res.success).toBe(false);
        expect(rows).toBe(0);
    });

    it('AND REFUSES WHEN THE READ ITSELF THROWS', async () => {
        /**
         * #245's rule: a guard that cannot evaluate refuses.
         *
         * Separate from the case above, because they are different branches and
         * the fake DB only exercises one of them: an absent document comes back
         * as `exists: false`, so the catch block is never entered. Mutating the
         * catch to `return { id }` — failing OPEN on a database error — survived
         * the whole suite until this test existed, which is exactly the shape
         * #245 found in the feature-toggle kill switch.
         */
        const adminSession = { user: { id: 'u1', email: 'u@e.test', roles: ['admin'] } };
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: adminSession, error: null }),
        }));
        jest.doMock('@/lib/auth', () => ({ auth: async () => adminSession }));
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: {
                collection: () => ({
                    doc: () => ({ get: async () => { throw new Error('connection reset'); } }),
                    add: async () => ({ id: 'should-never-happen' }),
                }),
            },
        }));

        const { createAnnouncementAction } = await import('@/app/actions/cms');
        const res: any = await (createAnnouncementAction as any)({
            title: 't', message: 'm', type: 'info', priority: 'high', targetAudience: 'all',
        });

        expect(res.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#281 — the guard cannot go back to the token', () => {
    it('#203 — THERE IS NO LOCAL GUARD LEFT; THE SHARED ONE DECIDES', () => {
        /**
         * #281 hardened a hand-written requireAdmin in this file. #203 removed
         * it: lib/require-admin.ts already read the live document, already
         * checked banned/suspended, already failed closed on a throw — and it
         * asks PERMISSION_MATRIX for a NAMED permission, which is what the
         * hand-written one could not do.
         *
         * The two assertions this replaces pinned the hand-written body. What
         * has to hold now is that the body is GONE and the shared gate is what
         * every write calls, which is a stronger statement: it cannot drift.
         */
        const src = codeOnly(CMS);

        expect(src).not.toMatch(/async function requireAdmin/);
        expect(src).toContain('from "@/lib/require-admin"');
    });

    it('and no write decides from session.user.roles', () => {
        // The exact expression that was the defect. Pinned because the fix is
        // one word away from being undone by somebody simplifying it.
        const src = codeOnly(CMS);
        expect(src).not.toMatch(/isAdmin\(session\.user\.roles\)/);
    });

    it('EVERY WRITE IN THE FILE NAMES THE SAME PERMISSION', () => {
        // Four of them — create and deactivate, announcement and banner. A
        // banner is an announcement in another shape: same screen, same
        // audience, same component renders it across the site.
        const src = codeOnly(CMS);
        // The literal is at each call site rather than behind a constant,
        // because #375's sweep reads the ARGUMENT: a constant would satisfy
        // "names a permission" while hiding which one from the check.
        const gates = src.match(/requireAdmin\("announcements:manage"\)/g) ?? [];
        expect(gates.length).toBe(4);
        // ...and no write slips through on a bare gate.
        expect(src).not.toMatch(/requireAdmin\(\s*\)/);
    });

    it('the CMS screen still calls this file, which is why it had to be fixed here', () => {
        // If the page is ever repointed at admin-communications.ts, this fails
        // and whoever moved it re-reads the note above about role breadth.
        expect(codeOnly(PAGE)).toContain('@/app/actions/cms');
    });
});
