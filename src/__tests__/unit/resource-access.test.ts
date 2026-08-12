/**
 * @jest-environment node
 */

/**
 * Deleting a resource hid it from the list and left the file downloadable.
 *
 * `deleteResourceAction` is a SOFT delete — it sets `isActive: false`. And
 * `getResourcesAction` filters correctly on `.where("isActive", "==", true)`, so
 * a deleted resource does disappear from the listing.
 *
 * `downloadResourceAction` fetched by id and never looked at the flag. Anyone
 * holding the id could still download the file after an admin removed it. The
 * deletion looked effective and was not — the same theme as #125, where
 * deleting an account left the person able to sign in.
 *
 * The listing filter is the proof the intent was real: somebody deliberately
 * hid inactive resources from the list, and the download path was missed.
 *
 * THE SECOND ONE: A MEMBERS-ONLY GATE, UNDONE NEXT DOOR
 * ----------------------------------------------------
 * wave/_actions.ts::_getWaveResourcesAction requires an ACTIVE wave_members
 * record — or an admin — to list this collection. The two endpoints in this
 * file serve the same documents to the same page and enforced neither: the
 * listing had NO session check at all, and the download had only a session, so
 * any signed-in user could read WAVE materials.
 *
 * Its only caller is /wave/(member)/resources, so the intent was never in doubt.
 * A route group named (member) enforces nothing on a server action, which is
 * reachable directly regardless of which page imports it.
 *
 * The same shape as the export catalogue in #112: one endpoint with no check
 * while its siblings all had one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const MEMBER = 'member-1';
const OUTSIDER = 'outsider-1';
const ADMIN = 'admin-1';
const RESOURCE = 'resource-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

/**
 * Answers by id, with one caveat worth stating.
 *
 * These endpoints read TWO collections keyed by the same user id — wave_members
 * for the membership check, and users for the live admin re-validation that
 * deleteResourceAction performs. The harness passes only the document id, not
 * the collection, so a fixture cannot tell those two reads apart.
 *
 * So the person document carries both shapes: `active` for the membership read
 * and `roles` for the admin read. That is a limitation of the harness rather
 * than a claim about the data, and it is written down instead of quietly worked
 * around — the first version returned a membership-shaped document and the
 * admin case failed, which is what surfaced it.
 */
function setWorld(opts: { member?: boolean; resource?: Record<string, any> | null } = {}) {
    const isMember = opts.member ?? true;
    const resource = opts.resource === undefined
        ? { title: 'Export Guide', fileUrl: 'https://files/guide.pdf', isActive: true, category: 'guide' }
        : opts.resource;

    const people: Record<string, { active: boolean; roles: string[] }> = {
        [MEMBER]: { active: isMember, roles: [] },
        [OUTSIDER]: { active: false, roles: [] },
        [ADMIN]: { active: false, roles: ['admin'] },
    };

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (people[idOrCollection]) {
            return Promise.resolve({
                exists: true, empty: false, docs: [], data: () => people[idOrCollection],
            });
        }
        if (idOrCollection === RESOURCE) {
            return Promise.resolve(
                resource === null
                    ? { exists: false, empty: true, docs: [], data: () => undefined }
                    : { exists: true, empty: false, docs: [], data: () => resource }
            );
        }
        // The listing query.
        return Promise.resolve({
            exists: false, empty: false,
            docs: [{ id: RESOURCE, data: () => resource ?? {} }],
            data: () => ({}),
        });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

async function download() {
    const { downloadResourceAction } = await import('@/app/actions/resource-actions');
    return downloadResourceAction(RESOURCE);
}

async function list() {
    const { getResourcesAction } = await import('@/app/actions/resource-actions');
    return getResourcesAction();
}

describe('downloadResourceAction — a deleted resource is gone', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setWorld();
    });

    it('refuses a soft-deleted resource', async () => {
        // THE test. deleteResourceAction sets isActive: false, the listing
        // honours it, and this path did not.
        setWorld({ resource: { title: 'Withdrawn', fileUrl: 'https://files/x.pdf', isActive: false } });

        const r: any = await download();

        expect(r.success).toBe(false);
        // Reported as "not found", so the endpoint does not confirm that a
        // withdrawn resource exists.
        expect(String(r.error)).toMatch(/not found/i);
        expect(r.data).toBeNull();
    });

    it('still serves a live resource', async () => {
        // Vacuity guard. Refusing everything would break the members' resource
        // page with no other symptom.
        const r: any = await download();

        expect(r.success).toBe(true);
        expect(r.data.url).toBe('https://files/guide.pdf');
    });

    it('refuses a resource that does not exist', async () => {
        setWorld({ resource: null });

        const r: any = await download();

        expect(r.success).toBe(false);
    });
});

describe('resources are for WAVE members, in both endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('refuses a download from a signed-in non-member', async () => {
        // A session was the only requirement, while the WAVE module's own
        // listing of these documents demands an active membership.
        setSession(OUTSIDER, ['farmer']);
        setWorld({ member: false });

        const r: any = await download();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/membership/i);
    });

    it('refuses a listing from a caller with no session at all', async () => {
        // This endpoint had no session check whatsoever.
        setSession(null);

        const r: any = await list();

        expect(r.success).toBe(false);
    });

    it('refuses a listing from a signed-in non-member', async () => {
        setSession(OUTSIDER, ['farmer']);
        setWorld({ member: false });

        const r: any = await list();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/membership/i);
    });

    it('serves a member', async () => {
        setSession(MEMBER);

        const r: any = await list();

        expect(r.success).toBe(true);
    });

    it('serves an admin who is not a member', async () => {
        // Matches _getWaveResourcesAction, which admits admins so they can
        // review what members see.
        setSession(ADMIN, ['admin']);
        setWorld({ member: false });

        const r: any = await list();

        expect(r.success).toBe(true);
    });

    it('refuses a member whose membership is not active', async () => {
        setSession(MEMBER);
        (global as any).mockFirestoreGet.mockImplementation((id: string) =>
            Promise.resolve(
                id === MEMBER
                    ? { exists: true, empty: false, docs: [], data: () => ({ active: false }) }
                    : { exists: true, empty: false, docs: [], data: () => ({ isActive: true, fileUrl: 'u' }) }
            )
        );

        const r: any = await download();

        expect(r.success).toBe(false);
    });
});

describe('the admin-only endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    const cases: Array<[string, any[]]> = [
        ['deleteResourceAction', [RESOURCE]],
        ['updateResourceAction', [RESOURCE, { title: 'Renamed' }]],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses a member`, async () => {
            // Being able to read the resources does not mean being able to
            // withdraw or rewrite them.
            setSession(MEMBER, ['wave_participant']);
            const mod: any = await import('@/app/actions/resource-actions');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
        });
    }

    it('lets an admin delete, so the refusals are not vacuous', async () => {
        setSession(ADMIN, ['admin']);
        const { deleteResourceAction } = await import('@/app/actions/resource-actions');

        const r: any = await deleteResourceAction(RESOURCE);

        expect(r.success).toBe(true);
        const patch = (global as any).mockFirestoreUpdate.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((p: any) => p && 'isActive' in p);
        expect(patch?.isActive).toBe(false);
    });
});
