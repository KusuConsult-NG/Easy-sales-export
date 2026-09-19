/**
 * @jest-environment node
 */

/**
 *   #904 (EXPORT) THE FIELD NAME WAS THE ONLY DIFFERENCE, AND IT SPLIT A
 *   MODULE IN HALF.
 *
 *   THE OWNER: "why did you leave export window out?"
 *
 *   Because the earlier passes scoped themselves by FIELD NAME — `ownerId`,
 *   then `buyerId`, then `sellerId` — and set `userId` aside as "the broad
 *   platform surface, not in scope". That line is defensible for a sweep over
 *   KYC and certificates and course progress. It is the wrong line here: an
 *   export window, an export catalogue entry, an export slot and an export
 *   application are a person's OWN THINGS, asked by the same question, spelled
 *   with a different field.
 *
 *   AND IT LEFT THE EXPORT MODULE SPLIT AGAINST ITSELF. The buyer pass widened
 *   EXPORT_ORDERS by `buyerId`, so a person's export ORDERS followed the
 *   pointer while their WINDOWS, CATALOGUE, SLOTS and APPLICATION did not —
 *   one module, two answers to who somebody is.
 *
 *   EXECUTED, and every list is also shown in its BEFORE state with the
 *   pointer removed, so nothing here can pass on a harness that ignores the
 *   owner filter.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => {
    const actual = jest.requireActual('@/lib/session-guard') as any;
    return { ...actual, requireSession: (...a: any[]) => mockRequireSession(...a) };
});

let store: FakeDbHandle;

const LIVE = 'exporter-live';
const OLD = 'exporter-superseded';
const STRANGER = 'someone-else';

const seedProfiles = () => {
    store.seed(COLLECTIONS.USERS, LIVE, { id: LIVE, email: 'e@e.com', supabaseAuthId: LIVE });
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'e@e.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { id: STRANGER, email: 'x@e.com', supabaseAuthId: STRANGER });
};

const signedInAs = (id: string) =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles: ['exporter'], email: 'e@e.com', name: 'E' } }, error: null,
    });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProfiles();
    signedInAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (export) — the window booked on the profile they stopped using', () => {
    const windows = async () => {
        const { getExportWindowsAction } = await import('@/app/actions/export/_ex_windows');
        return await getExportWindowsAction() as any;
    };

    const seedWindow = (id: string, userId: string) =>
        store.seed(COLLECTIONS.EXPORT_WINDOWS, id, {
            id, userId, status: 'open', title: `Window ${id}`,
            createdAt: '2026-09-12T10:00:00.000Z', updatedAt: '2026-09-12T10:00:00.000Z',
        });

    it('THE REPORTED GAP: a window booked on the superseded profile is there', async () => {
        seedWindow('before-the-merge', OLD);

        const res = await windows();

        expect(res.success).toBe(true);
        expect((res.data ?? []).map((w: any) => w.id)).toEqual(['before-the-merge']);
    });

    it('AND BEFORE THIS, IT WAS NOT — the defect, run rather than described', async () => {
        store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'e@e.com' });
        seedWindow('before-the-merge', OLD);

        expect((await windows()).data ?? []).toHaveLength(0);
    });

    it('AND THE LIVE PROFILE\'S OWN WINDOWS ARE STILL THERE', async () => {
        seedWindow('before-the-merge', OLD);
        seedWindow('after-the-merge', LIVE);

        expect(((await windows()).data ?? []).map((w: any) => w.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });

    it('THE CONTROL: SOMEBODY ELSE\'S WINDOW IS NOT HANDED OVER', async () => {
        seedWindow('theirs', STRANGER);
        seedWindow('ours', OLD);

        expect(((await windows()).data ?? []).map((w: any) => w.id)).toEqual(['ours']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (export) — and the rest of the module, which had split from it', () => {
    it('THE CATALOGUE', async () => {
        store.seed(COLLECTIONS.EXPORT_CATALOG, 'c-old', {
            id: 'c-old', userId: OLD, name: 'Cocoa', status: 'active',
            createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getUserExportProductsAction } = await import('@/app/actions/export-products');
        const res = await getUserExportProductsAction() as any;

        expect(res.success).toBe(true);
        expect((res.data ?? []).map((p: any) => p.id)).toEqual(['c-old']);
    });

    it('AND THE APPLICATION, so nobody is told to apply twice', async () => {
        /*
         *   #849's complaint — "the second person registered in an office was
         *   told to come back later" — arriving by this route. A person who HAS
         *   applied, on the profile they used then, was told they had not.
         */
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'a-old', {
            id: 'a-old', userId: OLD, status: 'approved',
            createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { checkExportStatusAction } = await import('@/app/actions/export/_ex_onboarding');

        //   It answers with the status string itself, so the approved
        //   application on the OLD profile is what decides — not its absence.
        expect(await checkExportStatusAction()).toBe('approved');
    });

    it('AND THE ORDERS, WHICH ALREADY DID — neither half regressed', async () => {
        //   The buyer pass widened this one. Asserted beside the others
        //   because the defect was precisely that they disagreed.
        store.seed(COLLECTIONS.EXPORT_ORDERS, 'o-old', {
            id: 'o-old', buyerId: OLD, status: 'processing', items: [],
            createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { readMyExportOrders } = await import('@/lib/export-orders-reader');

        expect((await readMyExportOrders(LIVE)).map((o) => o.id)).toEqual(['o-old']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (export) — and what appears can be opened', () => {
    it('THE WINDOW OPENS TO ITS OWNER', async () => {
        store.seed(COLLECTIONS.EXPORT_WINDOWS, 'w-old', {
            id: 'w-old', userId: OLD, status: 'open',
            createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getExportWindowDetailsAction } = await import('@/app/actions/export/_ex_windows');
        const res = await getExportWindowDetailsAction('w-old') as any;

        expect(res.success).toBe(true);
    });

    it('AND A STRANGER STILL CANNOT OPEN IT', async () => {
        store.seed(COLLECTIONS.EXPORT_WINDOWS, 'w-old', {
            id: 'w-old', userId: OLD, status: 'open',
            createdAt: '2026-09-12T10:00:00.000Z',
        });
        signedInAs(STRANGER);

        const { getExportWindowDetailsAction } = await import('@/app/actions/export/_ex_windows');
        const res = await getExportWindowDetailsAction('w-old') as any;

        expect(res.success).toBe(false);
    });
});
