/**
 * @jest-environment node
 */

/**
 *   #210 REJECTING A WAVE OR ACADEMY APPLICATION REVOKED NOTHING.
 *
 *        checkModuleAccess grants a module from EITHER signal:
 *
 *            Layer 1  the JWT role on its own      (hasAppAccess)
 *            Layer 2  the serviceRegistrations status
 *
 *        so revoking one without the other revokes nothing at all. Both Academy
 *        rejections and the WAVE rejection wrote
 *        `serviceRegistrations.<key>.status = "rejected"` and left the role in
 *        place, so a rejected applicant kept the module: the dashboard, the
 *        resources, the training, the earnings.
 *
 *        This was found once already. The cooperative suspend path's fix note
 *        says it in as many words — "a suspended member kept the dashboard,
 *        contributions, loans, withdrawals and the member directory. An admin
 *        pressing Suspend achieved nothing except a different word on the
 *        admin's own screen" — and Farm Nation's seller rejection strips
 *        `farmer` for the same reason. The correction reached two of the four
 *        modules. That is #83's shape: a fix applied where it was found and not
 *        where it also applied.
 *
 *        It compounded with #207: the login self-heal read exactly the role
 *        these paths failed to revoke, and wrote the rejection back to
 *        "approved". Two halves of one loop, each harmless-looking alone.
 *
 *        The role a module's approval grants now lives in one map,
 *        lib/module-grant-roles.ts, and the last test here is the ratchet: every
 *        module in that map must have a rejection path that revokes it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { MODULE_GRANT_ROLE, moduleGrantRole } from '@/lib/module-grant-roles';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateServiceCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
    // updateTag too — a missing export is undefined at the call site, the
    // call throws, and the action's catch reports a generic failure (#252).
    updateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => mockClaim(...a),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaim(...a),
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;
const APPLICANT = 'applicant-1';

const sessionFor = (roles: string[]) => ({
    session: { user: { id: 'admin-1', email: 'a@e.com', roles } },
});

const seedApplicant = (registrationKey: string, role: string) => {
    store.seed(USERS, APPLICANT, {
        email: 'applicant@e.com',
        fullName: 'Applicant One',
        roles: ['user', role],
        serviceRegistrations: { [registrationKey]: { status: 'approved' } },
    });
};

/** The roles the fake recorded on the user after the action ran. */
const rolesAfter = (): string[] => {
    const calls = (globalThis as any).mockFirestoreUpdate.mock.calls as any[][];
    const roleWrite = calls.reverse().find(([, patch]) => patch && 'roles' in patch);
    return roleWrite ? roleWrite[1].roles : [];
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue(sessionFor(['super_admin']));
    mockClaim.mockResolvedValue({ claimed: true, status: 'pending' });
    delete process.env.RESEND_API_KEY;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#210 — the WAVE rejection takes the role back', () => {
    it('REVOKES wave_participant, not only the status', async () => {
        seedApplicant('wave', 'wave_participant');
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'pending', email: 'applicant@e.com',
        });

        const { rejectWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        const res = await rejectWaveApplicationAction('app-1', 'Incomplete documents') as any;

        expect(res.success).toBe(true);
        const user = store.get(USERS, APPLICANT)!;
        expect(user.serviceRegistrations.wave.status).toBe('rejected');
        // Was: the role survived, and Layer 1 of checkModuleAccess grants the
        // module on the role alone.
        expect(user.roles).not.toContain('wave_participant');
    });

    it('leaves the applicant\'s other roles alone', async () => {
        store.seed(USERS, APPLICANT, {
            email: 'applicant@e.com',
            roles: ['user', 'wave_participant', 'cooperative_member'],
            serviceRegistrations: { wave: { status: 'approved' } },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: APPLICANT, status: 'pending' });

        const { rejectWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        await rejectWaveApplicationAction('app-1', 'Incomplete') as any;

        const user = store.get(USERS, APPLICANT)!;
        expect(user.roles).toContain('cooperative_member');
        expect(user.roles).toContain('user');
    });

    it('refuses a caller without the WAVE permission', async () => {
        seedApplicant('wave', 'wave_participant');
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: APPLICANT, status: 'pending' });
        mockRequireSession.mockResolvedValue(sessionFor(['support']));

        const { rejectWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        const res = await rejectWaveApplicationAction('app-1', 'nope') as any;

        expect(res.success).toBe(false);
        expect(store.get(USERS, APPLICANT)!.roles).toContain('wave_participant');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#210 — both Academy rejections take the role back', () => {
    it('REVOKES academy_participant — academy/_ac_admin_review', async () => {
        seedApplicant('academy', 'academy_participant');
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'pending', personalInfo: { email: 'applicant@e.com' },
        });

        const { rejectAcademyApplicationAction } = await import('@/app/actions/academy/_ac_admin_review');
        const res = await rejectAcademyApplicationAction('app-1', 'Incomplete') as any;

        expect(res.success).toBe(true);
        const user = store.get(USERS, APPLICANT)!;
        expect(user.serviceRegistrations.academy.status).toBe('rejected');
        expect(user.roles).not.toContain('academy_participant');
    });

    it('REVOKES academy_participant — admin/_academy', async () => {
        seedApplicant('academy', 'academy_participant');
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: APPLICANT, status: 'pending', personalInfo: { email: 'applicant@e.com' },
        });

        const mod = await import('@/app/actions/admin/_academy') as any;
        const reject = mod.rejectAcademyApplicationAction ?? mod.reviewAcademyApplicationAction;
        const res = await reject('app-1', 'Incomplete') as any;

        expect(res.success).toBe(true);
        const user = store.get(USERS, APPLICANT)!;
        expect(user.serviceRegistrations.academy.status).toBe('rejected');
        expect(user.roles).not.toContain('academy_participant');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#210 — the ratchet', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

    /**
     * The rejection path for each module in the grant map.
     *
     * Listed explicitly rather than discovered, because "the file that rejects
     * an Academy application" is not derivable from a path — there are two of
     * them, in different directories, and that is exactly how one of them got
     * missed.
     */
    const REJECTION_PATHS: Record<string, string[]> = {
        wave: ['src/app/actions/wave/_wv_admin_applications.ts'],
        academy: [
            'src/app/actions/academy/_ac_admin_review.ts',
            'src/app/actions/admin/_academy.ts',
        ],
        cooperatives: ['src/app/actions/cooperative/_coop_admin_members.ts'],
        'farm-nation': ['src/app/actions/farm-nation/_fn_admin.ts'],
    };

    it('EVERY MODULE THAT GRANTS A ROLE HAS A REJECTION THAT REVOKES IT', () => {
        for (const [module, files] of Object.entries(REJECTION_PATHS)) {
            const role = moduleGrantRole(module as never);
            for (const f of files) {
                // Comments stripped: the notes added by this fix quote the
                // defect, and asserting over raw source would pass on the
                // explanation rather than on the code.
                const code = read(f)
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/\/\/.*$/gm, '');

                const revokes =
                    code.includes(`arrayRemove("${role}")`) ||
                    code.includes(`arrayRemove('${role}')`) ||
                    code.includes(`arrayRemove(moduleGrantRole("${module}"))`);

                expect(`${f} revokes ${role}: ${revokes}`)
                    .toBe(`${f} revokes ${role}: true`);
            }
        }
    });

    it('every module in the grant map is covered by this ratchet', () => {
        // Export has no rejection path today; it is named here so that adding
        // one does not silently escape the check, and so that the gap is a
        // recorded fact rather than an oversight.
        const covered = new Set([...Object.keys(REJECTION_PATHS), 'export']);
        expect(Object.keys(MODULE_GRANT_ROLE).filter((m) => !covered.has(m))).toEqual([]);
    });

    it('the granted role is one the access check actually reads', () => {
        // A grant role that is not in APP_TO_ROLES revokes nothing, because
        // Layer 1 never looked at it. Executed rather than eyeballed.
        const src = read('src/lib/module-access-check.ts');
        for (const [module, role] of Object.entries(MODULE_GRANT_ROLE)) {
            const block = src.slice(src.indexOf('const APP_TO_ROLES'));
            const line = block.split('\n').find((l: string) => l.trim().startsWith(`${module}:`)
                || l.trim().startsWith(`"${module}":`));
            expect(`${module}: ${line?.includes(`"${role}"`)}`).toBe(`${module}: true`);
        }
    });

    it('and the approval that grants it is the same role', () => {
        const grants: Record<string, string> = {
            wave: 'src/app/actions/wave/_wv_admin_applications.ts',
            academy: 'src/app/actions/academy/_ac_admin_review.ts',
            'farm-nation': 'src/app/actions/farm-nation/_fn_admin.ts',
        };

        for (const [module, f] of Object.entries(grants)) {
            const role = moduleGrantRole(module as never);
            expect(`${f} grants ${role}: ${read(f).includes(`arrayUnion("${role}")`)}`)
                .toBe(`${f} grants ${role}: true`);
        }
    });
});
