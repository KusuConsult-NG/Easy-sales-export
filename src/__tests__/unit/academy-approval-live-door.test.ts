/**
 * @jest-environment node
 */

/**
 *   #277 THE ACADEMY APPROVAL THE ADMIN PANEL ACTUALLY CALLS WROTE NOTHING
 *        WHEN THE LEARNER HAD NO PROFILE ROW, AND REPORTED SUCCESS.
 *
 *        approveAcademyApplicationAction is defined THREE times:
 *
 *          academy/_ac_admin_review.ts   the one the academy barrel calls
 *                                        canonical, that _ac_applications.ts
 *                                        delegates to, and that the existing
 *                                        suites exercise
 *          academy/_ac_applications.ts   delegates to the above
 *          admin/_academy.ts             WHAT /admin/academy/applications
 *                                        ACTUALLY IMPORTS
 *
 *        The page imports from "@/app/actions/admin", and that barrel re-exports
 *        from ./_academy. So the live door is the third one — the only one no
 *        pass had been applied to. The same sentence as #276 (the withdrawal
 *        door the modal calls) and #273 (the upload route six of seven callers
 *        had bounded): the hardening enumerated the implementations it knew
 *        about and the UI-wired one was not among them.
 *
 * WHAT IT COST: A SILENT NO-OP ON A GRANT
 * ---------------------------------------
 * The live door did
 *
 *     await db.collection(USERS).doc(userId).update({ ...role and status... })
 *
 * and `update()` on a MISSING document is a documented silent no-op in this
 * adapter — supabase-db.ts logs a warning and affects no rows. Measured, not
 * inferred: with no users row the action returned
 *
 *     {"error":null,"success":true,"message":"Academy application approved successfully"}
 *
 * the application flipped to "approved", and NOTHING was written. No role, no
 * serviceRegistrations. The admin sees success, the learner has no access, and
 * nothing anywhere says otherwise.
 *
 * THE ORPHAN IS NOT HYPOTHETICAL. lib/orphaned-user-repair.ts exists for it and
 * names the cause in its own header: "Users in Firebase Auth but missing
 * Firestore profile. This can happen if registration fails between Auth
 * creation and Firestore write." Such an account signs in and applies normally.
 *
 * AND BOTH SIBLINGS ALREADY HANDLED IT
 * ------------------------------------
 * _ac_admin_review.ts CREATES the row inside its transaction when absent.
 * manualAcademyEnrollmentAction — in the SAME FILE, ninety lines below the
 * approve — reads the doc and returns "User not found". So the file that
 * contains the defect also contains a function defending against it. Only the
 * live approval did neither.
 *
 *   #278 AND THE THREE WRITES KEPT A HAND-WRITTEN ROLE LIST THE READ ABOVE
 *        THEM HAD ALREADY GIVEN UP.
 *
 *        getAcademyApplicationsAction, at the top of the same file, asks
 *        hasAdminPermission(roles, "academy:approve_applications"). The three
 *        writes under it each carried
 *
 *            roles.some(r => r === "admin" || r === "super_admin"
 *                         || r === "academy_admin")
 *
 *        #61 and #115 are this class. The conversion is behaviour-preserving
 *        rather than a policy change: the matrix grants
 *        "academy:approve_applications" to exactly super_admin, admin and
 *        academy_admin — verified below, so this is #265's lockout risk
 *        checked rather than assumed.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_ADMIN_ROLES, hasAdminPermission } from '@/lib/admin-permissions';

const LIVE = 'src/app/actions/admin/_academy.ts';
const CANONICAL = 'src/app/actions/academy/_ac_admin_review.ts';
const PAGE = 'src/app/admin/academy/applications/page.tsx';
const BARREL = 'src/app/actions/admin/index.ts';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#277 — which approval the product actually reaches', () => {
    /**
     * Pinned because the whole finding is that nobody knew. If the page is ever
     * repointed at the canonical implementation, this fails and whoever moved
     * it deletes the block — but they will have had to look.
     */
    it('THE ADMIN PAGE IMPORTS FROM THE ADMIN BARREL, NOT THE ACADEMY ONE', () => {
        const page = codeOnly(PAGE);

        expect(page).toMatch(/approveAcademyApplicationAction[\s\S]{0,200}from\s+["']@\/app\/actions\/admin["']/);
    });

    it('and that barrel resolves approval to the file this fixed', () => {
        const barrel = codeOnly(BARREL);
        const block = barrel.slice(
            barrel.indexOf('approveAcademyApplicationAction'),
        );

        expect(block.slice(0, block.indexOf(';') + 1)).toContain('./_academy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#277 — approving a learner with no profile row', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function approve(opts: { seedUser?: Record<string, unknown> | null; roles?: string[] } = {}) {
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: {
                    user: { id: 'admin-1', email: 'a@e.test', roles: opts.roles ?? ['academy_admin'] },
                },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: 'learner-1',
            status: 'pending',
            personalInfo: { email: 'learner@e.test', fullName: 'A Learner' },
        });

        if (opts.seedUser !== null) {
            store.seed(COLLECTIONS.USERS, 'learner-1', opts.seedUser ?? { uid: 'learner-1', roles: [] });
        }

        const { approveAcademyApplicationAction } = await import('@/app/actions/admin/_academy');
        const res: any = await (approveAcademyApplicationAction as any)('app-1');

        return {
            res,
            app: store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1') as any,
            user: store.get(COLLECTIONS.USERS, 'learner-1') as any,
        };
    }

    it('GRANTS THE ROLE EVEN THOUGH THE PROFILE ROW WAS ABSENT', async () => {
        // The defect, stated as the row it used to leave behind: none at all.
        const { res, user } = await approve({ seedUser: null });

        expect(res.success).toBe(true);
        expect(user).toBeDefined();
        expect(user.roles).toContain('academy_participant');
    });

    it('AND RECORDS THE SERVICE REGISTRATION, NOT ONLY THE ROLE', async () => {
        // checkModuleAccess reads either signal. Writing one and not the other
        // is what #162 and #207–#210 were about, from the opposite direction.
        const { user } = await approve({ seedUser: null });

        expect(user.serviceRegistrations?.academy?.status).toBe('approved');
        expect(user.serviceRegistrations?.academy?.paymentStatus).toBe('completed');
    });

    it('and the created profile carries an identity, not just a role', async () => {
        // A bare merge-write would have produced a users row holding a role and
        // nothing else — a second kind of broken. The fields come from the
        // application the admin is approving, as the canonical path does.
        const { user } = await approve({ seedUser: null });

        expect(user.email).toBe('learner@e.test');
        expect(user.fullName).toBe('A Learner');
        expect(user.uid).toBe('learner-1');
    });

    it('still approves normally when the row was there all along', async () => {
        // Vacuity guard: this is the case that always worked.
        const { res, app, user } = await approve({});

        expect(res.success).toBe(true);
        expect(app.status).toBe('approved');
        expect(user.roles).toContain('academy_participant');
    });

    it('AND DOES NOT WIPE A SIBLING MODULE REGISTRATION', async () => {
        // The hazard introduced by moving update() to set(merge): a nested
        // object written whole REPLACES its parent, which is how paying for one
        // module used to revoke another. supabase-db.ts flattens these to
        // dotted paths precisely so it does not. Asserted, because the fix
        // would otherwise have traded one silent loss for another.
        const { user } = await approve({
            seedUser: {
                uid: 'learner-1',
                roles: ['wave_member'],
                serviceRegistrations: { wave: { status: 'approved' } },
            },
        });

        expect(user.serviceRegistrations?.wave?.status).toBe('approved');
        expect(user.serviceRegistrations?.academy?.status).toBe('approved');
        expect(user.roles).toEqual(expect.arrayContaining(['wave_member', 'academy_participant']));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#278 — the permission the three writes ask', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('IS THE SAME SET THE HAND-WRITTEN LIST NAMED, SO NOBODY IS LOCKED OUT', () => {
        // #265's class checked rather than assumed. The old literal list was
        // admin | super_admin | academy_admin; if the matrix granted the
        // permission to fewer roles, this "cleanup" would have taken the
        // approve button away from a working admin.
        // Asked through hasAdminPermission over every declared role rather than
        // by reading the table: the table is not exported, and the function is
        // what the guard actually calls — including whatever "*" means to it.
        const holders = ALL_ADMIN_ROLES
            .filter((role) => hasAdminPermission([role], 'academy:approve_applications'))
            .slice()
            .sort();

        expect(holders).toEqual(['academy_admin', 'admin', 'super_admin']);
    });

    it('and no write in the live file re-answers it with a role literal', () => {
        // The ratchet. A fourth copy of the list is how the file came to
        // disagree with its own read in the first place.
        const offenders = codeOnly(LIVE).split('\n')
            .map((line, i) => ({ at: `${LIVE}:${i + 1}`, line }))
            .filter(({ line }) => /r === "(admin|super_admin|academy_admin)"/.test(line))
            .map((o) => o.at);

        // The listing read at the top keeps its permissive fallback — it is a
        // READ, and widening a read is not what this is about. Was: three more,
        // one on each write.
        expect(offenders.length).toBeLessThanOrEqual(1);
    });

    it('REFUSES AN ADMIN OF A DIFFERENT MODULE', async () => {
        // Executed, not read — #274's lesson. A permission check present in the
        // source and inert at runtime is the failure this whole audit keeps
        // finding.
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'x-1', email: 'x@e.test', roles: ['marketplace_admin'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', { userId: 'learner-1', status: 'pending' });

        const { approveAcademyApplicationAction } = await import('@/app/actions/admin/_academy');
        const res: any = await (approveAcademyApplicationAction as any)('app-1');

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1') as any).toMatchObject({ status: 'pending' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#277 — no grant in this file is left on a bare update()', () => {
    /**
     * The general form. `update()` is a silent no-op on a missing row, so any
     * write that GRANTS something has to be a set(merge) or be preceded by an
     * existence check that refuses. Read as a ratchet over the file rather than
     * pinned to the one function, because the next grant added here would
     * otherwise be written the same way.
     */
    it('the approve grant is a set(merge), not an update', () => {
        const src = codeOnly(LIVE);
        const fn = src.slice(src.indexOf('async function _approveAcademyApplicationAction'));
        const body = fn.slice(0, fn.indexOf('async function _rejectAcademyApplicationAction'));

        expect(body).toContain('{ merge: true }');
        expect(body).not.toMatch(/userRef\.update\(/);
    });

    it('and the manual enrolment still refuses a user that does not exist', () => {
        // Untouched on purpose. That function ALREADY handled the orphan, by
        // refusing rather than creating — a defensible different answer for an
        // admin typing a user id by hand, where a typo should not mint a
        // profile. Pinned so the two do not get "unified" into losing it.
        const src = codeOnly(LIVE);
        const fn = src.slice(src.indexOf('async function _manualAcademyEnrollmentAction'));

        expect(fn).toContain('User not found');
    });

    it('and the canonical implementation still creates the row too', () => {
        // Both doors now survive the orphan. If somebody deletes the handling
        // from the canonical one, this says so.
        expect(codeOnly(CANONICAL)).toMatch(/if\s*\(!userDoc\.exists\)/);
    });
});
