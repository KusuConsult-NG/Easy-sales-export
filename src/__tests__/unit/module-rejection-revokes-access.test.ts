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
 *
 *   #763 AND THE RATCHET REPORTED CLEAN WITH TWO MODULES STILL OPEN.
 *
 *        Two of its own recorded facts had gone stale, and each hid one module:
 *
 *        (a) IT EXCUSED EXPORT BY NAME. The coverage test carried the comment
 *            "Export has no rejection path today; it is named here so that
 *            adding one does not silently escape the check". One had been added
 *            — rejectExportApplicationAction in admin/_exports.ts — and it
 *            revoked nothing, so an approved export member who was then rejected
 *            kept the module. The sentence written to stop the gap escaping is
 *            what let it escape.
 *
 *        (b) IT ASKED FOR ONE ROLE PER MODULE. Farm Nation's entry was `farmer`,
 *            and _submitFarmNationOnboardingAction grants `investor` too — for
 *            `role: "buyer"` and `role: "both"`, two of its three choices. The
 *            rejection stripped `farmer` and the ratchet, checking `farmer`,
 *            agreed. A rejected BUYER kept the module outright.
 *
 *        The map is plural now, the coverage test is derived from the rejection
 *        paths rather than from a set with an exception in it, and the grant
 *        test reads the ONBOARDING action — which is where the roles are
 *        actually granted — rather than only the admin file beside the
 *        rejection. See a-decision-is-not-overridden-by-a-role.test.ts for the
 *        measurements.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { MODULE_GRANT_ROLES, moduleGrantRoles } from '@/lib/module-grant-roles';

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
        //   #763 Added. rejectExportApplicationAction lives here and revoked
        //   nothing while the coverage test below excused the module by name.
        export: ['src/app/actions/admin/_exports.ts'],
    };

    it('EVERY MODULE THAT GRANTS A ROLE HAS A REJECTION THAT REVOKES ALL OF THEM', () => {
        for (const [module, files] of Object.entries(REJECTION_PATHS)) {
            //   #763 EVERY role, not the first one. Farm Nation grants two and
            //   the rejection took back one, which is what a singular map could
            //   not express and therefore could not catch.
            const roles = moduleGrantRoles(module as never);
            for (const f of files) {
                // Comments stripped: the notes added by these fixes quote the
                // defect, and asserting over raw source would pass on the
                // explanation rather than on the code.
                const code = read(f)
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/\/\/.*$/gm, '');

                //   The spread form covers the whole list at once, which is why
                //   it is the form every caller uses. A literal is still
                //   accepted for a module that spells one role out.
                const revokesAll = code.includes(`arrayRemove(...moduleGrantRoles("${module}"))`);

                for (const role of roles) {
                    const revokes = revokesAll
                        || code.includes(`arrayRemove("${role}")`)
                        || code.includes(`arrayRemove('${role}')`);

                    expect(`${f} revokes ${role}: ${revokes}`)
                        .toBe(`${f} revokes ${role}: true`);
                }
            }
        }
    });

    it('every module in the grant map is covered by this ratchet, with NO exceptions list', () => {
        /*
         *   #763 This used to read
         *
         *       const covered = new Set([...Object.keys(REJECTION_PATHS), 'export']);
         *
         *   with a comment explaining that export had no rejection path. It had
         *   one. A coverage test that carries its own exception cannot report
         *   the exception going stale, which is the only thing it was for.
         *
         *   Derived from REJECTION_PATHS alone now: a module in the map with no
         *   rejection path listed fails here, and the way to make it pass is to
         *   list one.
         */
        expect(Object.keys(MODULE_GRANT_ROLES).sort())
            .toEqual(Object.keys(REJECTION_PATHS).sort());
    });

    it('every granted role is one the access check actually reads', () => {
        // A grant role that is not in APP_TO_ROLES revokes nothing, because
        // Layer 1 never looked at it. Executed rather than eyeballed.
        const src = read('src/lib/module-access-check.ts');
        for (const [module, roles] of Object.entries(MODULE_GRANT_ROLES)) {
            const block = src.slice(src.indexOf('const APP_TO_ROLES'));
            const line = block.split('\n').find((l: string) => l.trim().startsWith(`${module}:`)
                || l.trim().startsWith(`"${module}":`));
            for (const role of roles) {
                expect(`${module}/${role}: ${line?.includes(`"${role}"`)}`).toBe(`${module}/${role}: true`);
            }
        }
    });

    it('AND THE FLOW THAT GRANTS THE ROLE IS THE ONE THAT WAS READ', () => {
        /*
         *   #763 This used to read only the ADMIN file beside each rejection,
         *   which for Farm Nation is _fn_admin.ts — and Farm Nation's roles are
         *   granted by ONBOARDING, in _fn_onboarding.ts, which nothing here
         *   opened. That is how `investor` stayed out of the map: the test
         *   confirmed `farmer` was granted where it looked, and the second role
         *   was granted somewhere it did not.
         *
         *   Every file that grants a module's roles is listed now, and each
         *   listed role must appear as a grant in at least one of them.
         */
        const GRANT_PATHS: Record<string, string[]> = {
            wave: ['src/app/actions/wave/_wv_admin_applications.ts'],
            academy: ['src/app/actions/academy/_ac_admin_review.ts'],
            'farm-nation': [
                'src/app/actions/farm-nation/_fn_admin.ts',
                'src/app/actions/farm-nation/_fn_onboarding.ts',
                //   Where `investor` and `farmer` are NAMED now. Both doors used
                //   to state the mapping themselves, and they disagreed: the
                //   onboarding read the applicant's answer, the approval wrote
                //   `arrayUnion("farmer")` regardless. One rule in one file, and
                //   this is that file.
                'src/lib/farm-nation-roles.ts',
            ],
            export: ['src/app/actions/admin/_exports.ts'],
        };

        for (const [module, files] of Object.entries(GRANT_PATHS)) {
            const sources = files.map(read).join('\n');
            for (const role of moduleGrantRoles(module as never)) {
                /*
                 *   Three spellings: arrayUnion("role") for a fixed grant,
                 *   push("role") into a list that arrayUnion then spreads, and a
                 *   named constant a shared rule returns — which is what a
                 *   module looks like once its doors stop restating the mapping.
                 *
                 *   All three are PRECISE forms, deliberately. Searching for the
                 *   bare string would pass on a comment that merely mentions the
                 *   role, and this ratchet exists because a role was granted
                 *   somewhere nothing looked.
                 */
                const granted = sources.includes(`arrayUnion("${role}")`)
                    || sources.includes(`push("${role}")`)
                    || sources.includes(`= "${role}";`);
                expect(`${module} grants ${role}: ${granted}`).toBe(`${module} grants ${role}: true`);
            }
        }
    });
});
