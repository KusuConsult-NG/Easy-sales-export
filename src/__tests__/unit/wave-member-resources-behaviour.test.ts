/**
 * @jest-environment node
 */

/**
 * wave/_wv_resources.ts, EXECUTED. It was at 19.5%.
 *
 *   #196 ONE WITHDRAWN RESOURCE ENDED THE WHOLE LISTING.
 *        getWaveResourcesAction fetched `pageSize + 1` rows, dropped the
 *        withdrawn ones, and then computed hasMore from what survived:
 *
 *            const snapshot = await queryRef.get();          // pageSize + 1
 *            const visibleDocs = snapshot.docs.filter(notWithdrawn);
 *            const hasMore = visibleDocs.length > pageSize;  // <- false
 *
 *        So ONE deleted resource inside the page window took hasMore to false.
 *        The member got a short page and no "load more", with the rest of the
 *        library — however large — unreachable behind it. Deleting a single
 *        document truncated the listing for everybody.
 *
 *   #197 AND ITS CURSOR COULD BE NULL WHILE hasMore WAS TRUE.
 *        `createdAt?.toDate?.()?.toISOString() ?? null`, in both listings. A
 *        null cursor beside hasMore: true is a "load more" button that reloads
 *        page one. Same shape as #194; both go through toIsoOrEmpty, which is
 *        lifted into firestore-serialize beside toMillis rather than copied a
 *        second time.
 *
 *   #198 THE SECOND UPLOAD PATH AGREED WITH THE FIRST ABOUT NOTHING.
 *        uploadWaveResourceAction was gated on a hand-written
 *        `admin || super_admin`, so the WAVE admin could upload a resource
 *        through createResourceAction and not through this one. And it wrote a
 *        different document: neither isActive nor deleted — the two fields
 *        wave-resource-visibility.ts exists to keep in step, whose own note says
 *        "both writers now set both fields", true of two writers and not of this
 *        third — no createdAt, so the row sorted last in a createdAt-ordered
 *        listing; no uploadedBy and no audit row, so nothing recorded who put a
 *        file into the members' library. Its id was `resource_${Date.now()}`
 *        written with .set(), so two uploads in one millisecond overwrote each
 *        other.
 *
 *   #199 THE DOWNLOAD COUNTER WAS A WRITE WITH NO MEMBERSHIP CHECK.
 *        incrementResourceDownloadAction's only gate was "is anybody logged
 *        in". The listing over the same collection requires an active WAVE
 *        membership, an admin role or Academy Elite — so any account at all
 *        could increment the counter of any resource id, including a library it
 *        cannot read and a resource an admin has withdrawn. update() on a
 *        missing document is a warned no-op in this adapter, so an unknown id
 *        also returned success having written nothing.
 *
 *        The enrolment rule was twenty lines inline in the listing and absent
 *        here. It is now lib/wave-resource-access.ts — copying it across is how
 *        #38 ended up with four copies of the WAVE eligibility rule, three of
 *        them behaviourally different.
 *
 *   #200 ONE ACCOUNT COULD FILL A TRAINING EVENT.
 *        registerForTrainingAction had no duplicate check, and neither did
 *        anything else — WAVE_TRAINING_REGISTRATIONS has exactly one writer and
 *        it added a row unconditionally. Every call took a seat through
 *        incrementWithinCeiling FIRST, so pressing Register twice consumed two
 *        of the event's places for one person and pressing it maxParticipants
 *        times consumed all of them. If the registration write then failed the
 *        seat was never returned, so currentParticipants counted members who are
 *        not registered. And the audit row said `action: "user_update"` — the
 *        catch-all for an unclassified write — so the one question it exists to
 *        answer, who took which seat, could not be asked of it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const mockIncrementWithinCeiling = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: (...a: any[]) => mockIncrementWithinCeiling(...a),
}));

let store: FakeDbHandle;

const RESOURCES = COLLECTIONS.WAVE_RESOURCES;
const EVENTS = COLLECTIONS.WAVE_TRAINING_EVENTS;
const REGISTRATIONS = COLLECTIONS.WAVE_TRAINING_REGISTRATIONS;
const MEMBERS = COLLECTIONS.WAVE_MEMBERS;
const USERS = COLLECTIONS.USERS;

const MEMBER = 'member-1';

const actions = async () => await import('@/app/actions/wave/_wv_resources');

const sessionFor = (id: string, roles: string[] = []) => ({
    session: { user: { id, email: `${id}@e.com`, roles } },
});

/** A resource whose createdAt makes `index` the newest at index 0. */
const seedResource = (
    id: string,
    index: number,
    over: Record<string, unknown> = {},
) => {
    store.seed(RESOURCES, id, {
        title: `Resource ${id}`,
        description: 'x',
        category: 'document',
        fileUrl: 'https://example.test/f.pdf',
        fileName: 'f.pdf',
        fileSize: 10,
        downloads: 0,
        isActive: true,
        deleted: false,
        createdAt: new Date(Date.UTC(2026, 0, 100 - index)).toISOString(),
        ...over,
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue(sessionFor(MEMBER));
    store.seed(MEMBERS, MEMBER, { active: true });
    mockIncrementWithinCeiling.mockResolvedValue({ ok: true });
});

const listResources = async (category?: string, cursor?: string | null, limit = 20) =>
    (await actions()).getWaveResourcesAction(category, cursor, limit) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#196 — a deleted resource does not truncate the library', () => {
    it('A WITHDRAWN RESOURCE IN THE PAGE WINDOW DOES NOT END THE LIST', async () => {
        // Ten resources, one of them withdrawn, asking for pages of three.
        for (let i = 0; i < 10; i++) seedResource(`r${i}`, i);
        store.seed(RESOURCES, 'r1', {
            ...store.get(RESOURCES, 'r1')!, deleted: true,
        });

        const res = await listResources(undefined, null, 3);

        expect(res.success).toBe(true);
        // Was: three read, one dropped, two returned, hasMore false — the whole
        // remaining library unreachable.
        expect(res.data).toHaveLength(3);
        expect(res.data.map((r: any) => r.id)).not.toContain('r1');
        expect(res.meta.hasMore).toBe(true);
        expect(res.meta.cursor).toBeTruthy();
    });

    it('walks the entire library, skipping every withdrawn resource', async () => {
        for (let i = 0; i < 9; i++) seedResource(`r${i}`, i);
        // Both withdrawal spellings, because both exist in live rows.
        store.seed(RESOURCES, 'r2', { ...store.get(RESOURCES, 'r2')!, deleted: true });
        store.seed(RESOURCES, 'r5', { ...store.get(RESOURCES, 'r5')!, isActive: false });

        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 12; guard++) {
            const page: any = await listResources(undefined, cursor, 2);
            seen.push(...page.data.map((r: any) => r.id));
            if (!page.meta.hasMore) break;
            cursor = page.meta.cursor;
        }

        expect(new Set(seen).size).toBe(7);
        expect(seen).not.toContain('r2');
        expect(seen).not.toContain('r5');
    });

    it('survives a whole page of withdrawn resources', async () => {
        // The first four are gone; the visible ones are only reachable if the
        // scan advances past a page that yielded nothing.
        for (let i = 0; i < 8; i++) seedResource(`r${i}`, i, i < 4 ? { deleted: true } : {});

        const res = await listResources(undefined, null, 3);

        expect(res.data.map((r: any) => r.id)).toEqual(['r4', 'r5', 'r6']);
    });

    it('reports no more when the library genuinely ends', async () => {
        for (let i = 0; i < 3; i++) seedResource(`r${i}`, i);

        const res = await listResources(undefined, null, 5);

        expect(res.data).toHaveLength(3);
        expect(res.meta.hasMore).toBe(false);
        expect(res.meta.cursor).toBeNull();
    });

    it('returns an empty page rather than failing when everything is withdrawn', async () => {
        for (let i = 0; i < 3; i++) seedResource(`r${i}`, i, { deleted: true });

        const res = await listResources(undefined, null, 5);

        expect(res.success).toBe(true);
        expect(res.data).toEqual([]);
    });

    it('filters by category', async () => {
        seedResource('doc', 0, { category: 'document' });
        seedResource('vid', 1, { category: 'video' });

        expect((await listResources('video')).data.map((r: any) => r.id)).toEqual(['vid']);
    });

    it('is newest first', async () => {
        for (let i = 0; i < 3; i++) seedResource(`r${i}`, i);
        expect((await listResources()).data.map((r: any) => r.id)).toEqual(['r0', 'r1', 'r2']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#197 — the cursor is never null on a page that has more', () => {
    it('RETURNS A USABLE CURSOR', async () => {
        for (let i = 0; i < 5; i++) seedResource(`r${i}`, i);

        const first = await listResources(undefined, null, 2);
        expect(first.meta.hasMore).toBe(true);
        expect(first.meta.cursor).not.toBeNull();

        const second = await listResources(undefined, first.meta.cursor, 2);
        expect(second.data.map((r: any) => r.id))
            .not.toEqual(first.data.map((r: any) => r.id));
    });

    /**
     * A correction to my own first claim, kept because the correction is the
     * interesting part.
     *
     * I recorded #197 as "toDate answers for a hydrated Timestamp and nothing
     * else", and reverting the helper to the old spelling did NOT fail a single
     * test — because the adapter hydrates ISO strings into Timestamps on read,
     * so every row createResourceAction writes answers toDate perfectly well.
     * The old spelling was fine for those.
     *
     * It was not fine for the rows the OTHER upload path wrote, which had no
     * createdAt at all (#198), and a missing value sorts FIRST in a descending
     * order — in Postgres and in the fake alike. So page one of the members'
     * library began with those rows and the cursor was null.
     *
     * My first attempt at this test then asserted the cursor was NOT null,
     * which the fix does not deliver and could not: a row with no timestamp has
     * no cursor value, and no reader recovers one. What the listing can
     * guarantee is that it does not LIE — if it cannot hand back a cursor it
     * must not claim there is more. That is the assertion.
     */
    it('DOES NOT CLAIM MORE PAGES IT CANNOT REACH', async () => {
        for (let i = 0; i < 4; i++) seedResource(`r${i}`, i);
        // As _uploadWaveResourceAction wrote them: no createdAt.
        seedResource('legacy-a', 0, { createdAt: undefined });
        seedResource('legacy-b', 0, { createdAt: undefined });

        const first = await listResources(undefined, null, 2);

        // Was hasMore: true with cursor: null — a "load more" that reloads
        // page one for ever.
        expect(first.meta.cursor).toBeNull();
        expect(first.meta.hasMore).toBe(false);
    });

    it('never reports hasMore without a cursor to reach it', async () => {
        for (let i = 0; i < 7; i++) seedResource(`r${i}`, i);

        for (const limit of [1, 2, 3, 7]) {
            const res = await listResources(undefined, null, limit);
            expect(`limit ${limit}: ${res.meta.hasMore && res.meta.cursor === null}`)
                .toBe(`limit ${limit}: false`);
        }
    });

    it('pages the training events listing too', async () => {
        for (let i = 0; i < 5; i++) {
            store.seed(EVENTS, `e${i}`, {
                title: `Event ${i}`, status: 'upcoming',
                date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(),
            });
        }
        const { getWaveTrainingEventsAction } = await actions();

        const first = await getWaveTrainingEventsAction(null, 2) as any;
        expect(first.meta.hasMore).toBe(true);
        expect(first.meta.cursor).toBeTruthy();

        const second = await getWaveTrainingEventsAction(first.meta.cursor, 2) as any;
        const firstIds = first.data.map((e: any) => e.id);
        expect(second.data.map((e: any) => e.id).some((id: string) => firstIds.includes(id)))
            .toBe(false);
    });

    it('shows only upcoming and ongoing events by default', async () => {
        store.seed(EVENTS, 'up', { title: 'Up', status: 'upcoming', date: '2026-06-01T00:00:00.000Z' });
        store.seed(EVENTS, 'done', { title: 'Done', status: 'completed', date: '2026-05-01T00:00:00.000Z' });
        const { getWaveTrainingEventsAction } = await actions();

        expect(((await getWaveTrainingEventsAction() as any).data).map((e: any) => e.id))
            .toEqual(['up']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#199 — who may reach the resource library', () => {
    const seedFor = () => seedResource('r0', 0);

    it('admits an active WAVE member', async () => {
        seedFor();
        expect((await listResources()).success).toBe(true);
    });

    it('refuses a member whose enrolment is not active', async () => {
        store.seed(MEMBERS, MEMBER, { active: false });
        seedFor();
        expect(await listResources()).toMatchObject({ success: false });
    });

    it('refuses an account with no WAVE membership at all', async () => {
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor('nobody'));
        expect(await listResources()).toMatchObject({ success: false });
    });

    it('admits an admin', async () => {
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor('admin-1', ['wave_admin']));
        seedFor();
        expect((await listResources()).success).toBe(true);
    });

    it('admits an Academy Elite member', async () => {
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor('elite-1'));
        store.seed(USERS, 'elite-1', {
            serviceRegistrations: { academy: { plan: 'elite', status: 'approved' } },
        });
        seedFor();
        expect((await listResources()).success).toBe(true);
    });

    it('does not admit an Academy member on another plan', async () => {
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor('basic-1'));
        store.seed(USERS, 'basic-1', {
            serviceRegistrations: { academy: { plan: 'basic', status: 'approved' } },
        });
        expect(await listResources()).toMatchObject({ success: false });
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await listResources()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#199 — the download counter', () => {
    const bump = async (id: string) =>
        (await actions()).incrementResourceDownloadAction(id) as any;

    beforeEach(() => seedResource('r0', 0));

    it('counts a download for a member', async () => {
        expect(await bump('r0')).toMatchObject({ success: true });
        expect(store.get(RESOURCES, 'r0')?.downloads).toBe(1);
    });

    it('REFUSES AN ACCOUNT THAT CANNOT READ THE LIBRARY', async () => {
        mockRequireSession.mockResolvedValue(sessionFor('outsider'));

        // Was: success, and the counter went up.
        expect(await bump('r0')).toMatchObject({ success: false });
        expect(store.get(RESOURCES, 'r0')?.downloads).toBe(0);
    });

    it('REFUSES A WITHDRAWN RESOURCE', async () => {
        store.seed(RESOURCES, 'r0', { ...store.get(RESOURCES, 'r0')!, deleted: true });

        expect(await bump('r0')).toMatchObject({ success: false });
        expect(store.get(RESOURCES, 'r0')?.downloads).toBe(0);
    });

    it('SAYS SO for an id that does not exist, instead of reporting a write it never made', async () => {
        // update() on a missing document is a warned no-op in this adapter, so
        // the old code returned success having done nothing at all.
        expect(await bump('no-such-resource')).toMatchObject({ success: false });
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await bump('r0')).toMatchObject({ success: false });
        expect(store.get(RESOURCES, 'r0')?.downloads).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#198 — the second upload path', () => {
    const upload = async (over: Record<string, unknown> = {}) =>
        (await actions()).uploadWaveResourceAction({
            title: 'Guide', description: 'x', category: 'guide',
            fileUrl: 'https://example.test/g.pdf', fileName: 'g.pdf', fileSize: 5,
            ...over,
        } as never) as any;

    it('ADMITS THE WAVE ADMIN, who can upload through the other screen', async () => {
        mockRequireSession.mockResolvedValue(sessionFor('admin-1', ['wave_admin']));

        expect(await upload()).toMatchObject({ success: true });
        expect(store.size(RESOURCES)).toBe(1);
    });

    it.each([['support'], ['moderator'], ['marketplace_admin'], ['user']])(
        'refuses %s', async (role) => {
            mockRequireSession.mockResolvedValue(sessionFor('x', [role]));

            expect(await upload()).toMatchObject({ success: false });
            expect(store.size(RESOURCES)).toBe(0);
        });

    it('WRITES A ROW THE LISTINGS CAN SEE', async () => {
        mockRequireSession.mockResolvedValue(sessionFor('admin-1', ['super_admin']));

        await upload();

        const [[, row]] = store.all(RESOURCES);
        // Was: none of these. No visibility fields, so getResourcesAction's
        // `.where("isActive","==",true)` never matched it; no createdAt, so it
        // sorted last in the member listing and could not be paged past.
        expect(row).toMatchObject({
            isActive: true,
            deleted: false,
            downloads: 0,
            uploadedBy: 'admin-1',
        });
        expect(row.createdAt).toBeTruthy();
        expect(row.updatedAt).toBeTruthy();
    });

    it('RECORDS WHO ADDED A FILE TO THE MEMBERS LIBRARY', async () => {
        mockRequireSession.mockResolvedValue(sessionFor('admin-1', ['super_admin']));

        await upload();

        expect((globalThis as any).mockCreateAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'resource_uploaded', userId: 'admin-1' }),
        );
    });

    it('DOES NOT OVERWRITE AN EARLIER UPLOAD', async () => {
        mockRequireSession.mockResolvedValue(sessionFor('admin-1', ['super_admin']));

        // The id was `resource_${Date.now()}` with .set(); two uploads inside
        // one millisecond became one document.
        await upload({ title: 'First' });
        await upload({ title: 'Second' });

        expect(store.size(RESOURCES)).toBe(2);
        expect(store.all(RESOURCES).map(([, r]) => r.title).sort()).toEqual(['First', 'Second']);
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await upload()).toMatchObject({ success: false });
        expect(store.size(RESOURCES)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#200 — one member, one seat', () => {
    const register = async (userId = MEMBER, eventId = 'e1') =>
        (await actions()).registerForTrainingAction(userId, eventId) as any;

    beforeEach(() => {
        store.seed(EVENTS, 'e1', {
            title: 'Session', status: 'upcoming',
            date: '2026-06-01T00:00:00.000Z',
            maxParticipants: 2, currentParticipants: 0,
        });
    });

    it('registers a member once', async () => {
        expect(await register()).toMatchObject({ success: true });
        expect(store.size(REGISTRATIONS)).toBe(1);
        expect(mockIncrementWithinCeiling).toHaveBeenCalledTimes(1);
    });

    it('REFUSES A SECOND REGISTRATION AND TAKES NO SECOND SEAT', async () => {
        await register();
        mockIncrementWithinCeiling.mockClear();

        const again = await register();

        expect(again).toMatchObject({ success: false });
        expect(again.error).toMatch(/already registered/i);
        // The seat is what mattered: pressing Register maxParticipants times
        // used to close the event to everybody else.
        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
        expect(store.size(REGISTRATIONS)).toBe(1);
    });

    it('does not confuse two members, or two events', async () => {
        store.seed(MEMBERS, 'member-2', { active: true });
        store.seed(EVENTS, 'e2', { title: 'Other', status: 'upcoming', maxParticipants: 5 });

        await register(MEMBER, 'e1');
        mockRequireSession.mockResolvedValue(sessionFor('member-2'));
        expect(await register('member-2', 'e1')).toMatchObject({ success: true });

        mockRequireSession.mockResolvedValue(sessionFor(MEMBER));
        expect(await register(MEMBER, 'e2')).toMatchObject({ success: true });

        expect(store.size(REGISTRATIONS)).toBe(3);
    });

    it('RETURNS THE SEAT when the registration write fails', async () => {
        const g = globalThis as any;
        const realAdd = g.mockFirestoreAdd.getMockImplementation();
        g.mockFirestoreAdd.mockImplementation((collection: string, ...rest: any[]) => {
            if (collection === REGISTRATIONS) return Promise.reject(new Error('write failed'));
            return realAdd(collection, ...rest);
        });

        try {
            const res = await register();
            expect(res).toMatchObject({ success: false });
        } finally {
            g.mockFirestoreAdd.mockImplementation(realAdd);
        }

        // Was: the seat stayed taken, so currentParticipants counted a member
        // who is not registered and the event filled up with nobody in it.
        expect(g.mockFirestoreUpdate).toHaveBeenCalledWith(
            'e1', expect.objectContaining({ currentParticipants: expect.anything() }),
        );
        expect(store.size(REGISTRATIONS)).toBe(0);
    });

    it('says the event is full rather than registering past capacity', async () => {
        mockIncrementWithinCeiling.mockResolvedValue({ ok: false, reason: 'at_capacity' });

        expect(await register()).toMatchObject({ success: false, error: 'Event is full' });
        expect(store.size(REGISTRATIONS)).toBe(0);
    });

    it('says so when the event does not exist', async () => {
        mockIncrementWithinCeiling.mockResolvedValue({ ok: false, reason: 'not_found' });

        expect(await register(MEMBER, 'nope')).toMatchObject({ success: false });
        expect(store.size(REGISTRATIONS)).toBe(0);
    });

    it('refuses registering somebody else', async () => {
        expect(await register('somebody-else')).toMatchObject({ success: false });
        expect(mockIncrementWithinCeiling).not.toHaveBeenCalled();
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await register()).toMatchObject({ success: false });
        expect(store.size(REGISTRATIONS)).toBe(0);
    });

    it('FILES THE AUDIT ROW AS A TRAINING REGISTRATION, NOT A USER UPDATE', async () => {
        await register();

        expect((globalThis as any).mockCreateAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'training_registered',
                userId: MEMBER,
                targetId: 'e1',
                targetType: 'training_registration',
            }),
        );
    });
});
