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
 * WHAT WAS DELIBERATELY NOT CHANGED
 * ---------------------------------
 * lib/require-admin.ts's role test is `admin | super_admin | *_admin`, while
 * isAdmin() ALSO accepts `moderator` and `support`. Swapping cms.ts onto the
 * shared helper would have silently taken the announcements screen away from
 * two roles that have it today — #265's lockout, which this audit caused once
 * already and now checks for every time.
 *
 * So the PREDICATE is untouched; only the SOURCE of the roles moved, from token
 * to live document, plus the banned check. Whether moderator and support should
 * reach a platform-wide announcement at all is a real question — the two doors
 * disagree — but it is a policy decision and it is the owner's.
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
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'u1', email: 'u@e.test', roles: opts.jwtRoles } },
                error: null,
            }),
        }));

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

    it('AND MODERATOR AND SUPPORT KEEP THE ACCESS THEY HAVE TODAY', async () => {
        // #265's lockout, checked rather than assumed. isAdmin() accepts these
        // two and lib/require-admin.ts does not, so moving to the shared helper
        // would have removed the announcements screen from them silently.
        for (const role of ['moderator', 'support']) {
            const { res } = await post({ jwtRoles: [role] });
            expect({ role, ok: res.success }).toEqual({ role, ok: true });
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
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'u1', email: 'u@e.test', roles: ['admin'] } },
                error: null,
            }),
        }));
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
    it('THE LOCAL requireAdmin READS THE USERS COLLECTION', () => {
        const src = codeOnly(CMS);
        const fn = src.slice(
            src.indexOf('async function requireAdmin'),
            src.indexOf('async function requireAdmin') + 1400,
        );

        expect(fn).toContain('COLLECTIONS.USERS');
        expect(fn).toMatch(/isBanned|suspended/);
    });

    it('and does not decide from session.user.roles', () => {
        // The exact line that was there. Pinned because the fix is one word
        // away from being undone by somebody simplifying it.
        const src = codeOnly(CMS);
        const fn = src.slice(
            src.indexOf('async function requireAdmin'),
            src.indexOf('async function requireAdmin') + 1400,
        );

        expect(fn).not.toMatch(/isAdmin\(session\.user\.roles\)/);
    });

    it('the CMS screen still calls this file, which is why it had to be fixed here', () => {
        // If the page is ever repointed at admin-communications.ts, this fails
        // and whoever moved it re-reads the note above about role breadth.
        expect(codeOnly(PAGE)).toContain('@/app/actions/cms');
    });
});
