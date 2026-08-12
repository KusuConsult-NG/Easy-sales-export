/**
 * @jest-environment node
 */

/**
 * wave/_member.ts — the cleanest file audited in this run, and the smallest fix.
 *
 * All four endpoints take no user id at all. Every read and write is scoped to
 * `session.user.id`, so there is no caller-supplied identity to substitute —
 * ownership by construction rather than by check. That is the shape the rest of
 * this audit has been trying to reach, and it is worth locking in.
 *
 * THE ONE DEFECT
 * --------------
 * `trackResourceAccessAction(resourceId)` took the id from the caller and never
 * checked it existed. The counter update is harmless by itself — the adapter
 * turns `update()` on a missing document into a logged no-op rather than
 * creating one — but the two access rows were written regardless.
 *
 * So any signed-in user could add unbounded rows to wave_resource_access and to
 * wave_resource_downloads — the collection this file's own comment calls "for
 * access auditing" — naming resources that do not exist, each row carrying their
 * email and name. An audit trail anyone can fill with invented entries is worth
 * less than one that refuses them.
 *
 * WHAT WAS CHECKED AND FOUND CORRECT
 * ----------------------------------
 * The auto-heal in `checkWaveMembershipAction` looked like the self-enrolment
 * defect fixed in #104, and is not. It only recreates a membership record for
 * someone who ALREADY holds wave_participant or wave_member, so it cannot enrol
 * anyone; it restores a record for a person the admins already approved.
 *
 * Its entry condition is `!memberDoc.exists || !memberDoc.data()?.active`, which
 * would also reactivate a deliberately deactivated member — but nothing in the
 * codebase writes `active: false` to WAVE_MEMBERS. The admin approval path in
 * wave/_admin.ts only ever writes `active: true`. There is no deactivation flow
 * for that state to come from, so the branch is unreachable in practice and is
 * recorded here rather than changed. If deactivation is ever added, this is the
 * endpoint that will undo it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const MEMBER = 'member-1';
const RESOURCE = 'resource-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: 'A Member', roles } }, error: null }
    ));
}

/**
 * Routes reads by argument: a doc get receives the id, a `.where().get()`
 * receives the collection name.
 */
function setWorld(opts: { resourceExists?: boolean; memberDoc?: Record<string, any> | null } = {}) {
    const resourceExists = opts.resourceExists ?? true;
    const memberDoc = opts.memberDoc === undefined ? { active: true, status: 'approved' } : opts.memberDoc;

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === RESOURCE) {
            return Promise.resolve(
                resourceExists
                    ? { exists: true, empty: false, docs: [], data: () => ({ title: 'A Guide', downloads: 3 }) }
                    : { exists: false, empty: true, docs: [], data: () => undefined }
            );
        }
        if (idOrCollection === MEMBER) {
            return Promise.resolve(
                memberDoc === null
                    ? { exists: false, empty: true, docs: [], data: () => undefined }
                    : { exists: true, empty: false, docs: [], data: () => memberDoc }
            );
        }
        // Query results — no prior access, no registrations.
        return Promise.resolve({ exists: false, empty: true, docs: [], data: () => ({}) });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

function added(): Record<string, any>[] {
    return (global as any).mockFirestoreAdd.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .filter(Boolean);
}

async function track(resourceId: string) {
    const { trackResourceAccessAction } = await import('@/app/actions/wave/_member');
    return trackResourceAccessAction(resourceId);
}

describe('trackResourceAccessAction — an audit row needs a real resource', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER, ['wave_participant']);
        setWorld();
    });

    it('refuses an id that does not exist, and records nothing', async () => {
        // THE test. Both writes used to happen anyway, one of them into the
        // collection kept "for access auditing".
        setWorld({ resourceExists: false });

        const r: any = await track('not-a-real-resource');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not found/i);
        expect(added()).toEqual([]);
    });

    it('records access to a real resource', async () => {
        // Vacuity guard: the refusal above is satisfied by an endpoint that
        // records nothing at all, which would stop download tracking entirely.
        const r: any = await track(RESOURCE);

        expect(r.success).toBe(true);

        const accessRow = added().find((d) => d && 'accessCount' in d);
        expect(accessRow?.userId).toBe(MEMBER);
        expect(accessRow?.resourceId).toBe(RESOURCE);

        const auditRow = added().find((d) => d && 'downloadedAt' in d);
        expect(auditRow?.userId).toBe(MEMBER);
    });

    it('attributes the access to the session, never to a supplied id', async () => {
        // The property that holds across this whole file: there is no caller
        // parameter that could name a different person.
        await track(RESOURCE);

        for (const row of added()) {
            if ('userId' in row) expect(row.userId).toBe(MEMBER);
        }
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await track(RESOURCE);

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });
});

describe('checkWaveMembershipAction — auto-heal restores, it does not enrol', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('reports an existing active member as enrolled', async () => {
        setSession(MEMBER, ['wave_participant']);

        const r: any = await checkMembership();

        expect(r.success).toBe(true);
        expect(r.data.enrolled).toBe(true);
    });

    it('does not enrol a user who holds no WAVE role', async () => {
        // The distinction that matters: auto-heal recreates a record for
        // somebody already approved. It must not become a route to membership
        // for anybody else — that was the defect fixed in #104.
        setSession('outsider-1', ['farmer']);
        setWorld({ memberDoc: null });

        const r: any = await checkMembership();

        expect(r.data.enrolled).toBe(false);
        expect((global as any).mockFirestoreSet.mock.calls).toEqual([]);
    });

    it('recreates a missing record for somebody who holds the role', async () => {
        setSession(MEMBER, ['wave_participant']);
        setWorld({ memberDoc: null });

        const r: any = await checkMembership();

        expect(r.data.enrolled).toBe(true);
        const written = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'userId' in d);
        expect(written?.userId).toBe(MEMBER);
    });

    it('treats an admin as enrolled without writing a membership record', async () => {
        // The admin bypass returns a synthetic record rather than persisting
        // one, so browsing the module as an admin does not make them a member.
        setSession('admin-1', ['admin']);
        setWorld({ memberDoc: null });

        const r: any = await checkMembership();

        expect(r.data.enrolled).toBe(true);
        expect((global as any).mockFirestoreSet.mock.calls).toEqual([]);
    });
});

async function checkMembership() {
    const { checkWaveMembershipAction } = await import('@/app/actions/wave/_member');
    return checkWaveMembershipAction();
}

describe('the member reads are scoped to the session', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('getUserTrainingRegistrationsAction refuses an unauthenticated caller', async () => {
        setSession(null);
        const { getUserTrainingRegistrationsAction } = await import('@/app/actions/wave/_member');

        const r: any = await getUserTrainingRegistrationsAction();

        expect(r.success).toBe(false);
    });

    it('getWaveMemberStatsAction refuses an unauthenticated caller', async () => {
        setSession(null);
        const { getWaveMemberStatsAction } = await import('@/app/actions/wave/_member');

        const r: any = await getWaveMemberStatsAction();

        expect(r.success).toBe(false);
    });

    it('neither takes a user id, so neither can be pointed at somebody else', async () => {
        // Ownership by construction. Asserted on the signatures themselves,
        // because the guarantee is that the parameter does not exist — adding
        // one later would not fail any behavioural test.
        const mod: any = await import('@/app/actions/wave/_member');

        expect(mod.getUserTrainingRegistrationsAction.length).toBe(0);
        expect(mod.getWaveMemberStatsAction.length).toBe(0);
        expect(mod.checkWaveMembershipAction.length).toBe(0);
    });
});
