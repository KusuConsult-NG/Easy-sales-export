/**
 * @jest-environment node
 */

/**
 *   #509 THE OWNER'S ID WAS RE-READ AFTER IT HAD ALREADY BEEN READ.
 *
 *   approveContentAction's transaction returned:
 *
 *       ownerId: type === "land"
 *           ? (await db.collection(LAND_LISTINGS).doc(id).get()).data()?.ownerId
 *           : null
 *
 *   a SECOND fetch of the document `transaction.get(docRef)` had already loaded
 *   twenty lines above — issued outside the transaction, on the one action an
 *   admin performs by hand, for a value that was in scope until the `case` block
 *   closed.
 *
 *   IT COULD FAIL AN APPROVAL THAT HAD ALREADY BEEN DECIDED. supabase-db's
 *   runTransaction buffers writes and commits only after the callback RETURNS:
 *
 *       const result = await fn(tx);
 *       await tx._commit();
 *
 *   so a throw inside the callback means nothing is written. That is the good
 *   news, and it corrects what I first suspected — there is no half-applied
 *   state here. But a transient failure on that unnecessary read still aborts
 *   the whole approval, and the admin is shown whatever the read threw rather
 *   than anything about approving.
 *
 * ── SAID AT ITS SIZE ────────────────────────────────────────────────────────
 *
 *   Nothing is mis-written. No permission is bypassed. No money moves. This is
 *   one avoidable round trip that can turn a completed decision into a failure
 *   message, and it is worth exactly that much.
 *
 *   THE FILE IS OTHERWISE SOUND, which is worth recording as plainly as a
 *   defect would be. admin-content.ts carries per-type permissions rather than a
 *   blanket isAdmin (an academy_admin could once mark land VERIFIED), live role
 *   re-validation against the database rather than the JWT, land state checks on
 *   BOTH the approve and reject paths, a rejection-reason length rule, and a
 *   listing built on bounded reads and count() aggregates with no N+1. It
 *   carried no `#nnn` markers, which is why it came up in the unmarked sweep —
 *   a file being unnumbered is not the same as a file being unexamined, and this
 *   is the second time in two findings that the sweep's heuristic has said
 *   otherwise.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the owner id read from a second fetch again    KILLED
 *     the owner id left null for land                KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

const mockInvalidateServiceCache = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateServiceCache: (...a: any[]) => mockInvalidateServiceCache(...a),
    invalidateUserCache: jest.fn(),
    invalidateAdminGlobalStats: jest.fn(),
}));

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const LAND = COLLECTIONS.LAND_LISTINGS;

beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateServiceCache.mockResolvedValue(undefined);
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'admin@example.com' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'], email: 'admin@example.com' });
});

const approve = async (id: string, type: string) =>
    (await (await import('@/app/actions/admin-content')).approveContentAction(id, type as any)) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#509 — the owner id comes from the snapshot already read', () => {
    it('APPROVING LAND STILL INVALIDATES THE OWNER\'S CACHE', async () => {
        //   THE test. The owner id is what the cache invalidation is keyed on,
        //   so taking it from the snapshot rather than a second fetch has to
        //   produce the same value.
        //   `pending_verification`, not `pending`: APPROVABLE_FROM_STATUSES is
        //   draft / pending_verification / inspection_scheduled, the purchasable
        //   set, and rejected. lib/land-listing-status.ts is the authority.
        store.seed(LAND, 'plot-1', {
            status: 'pending_verification', ownerId: 'farmer-9', title: 'Two hectares',
        });

        expect(await approve('plot-1', 'land')).toMatchObject({ success: true });
        expect(mockInvalidateServiceCache).toHaveBeenCalledWith('farmer-9', 'farmNation');
    });

    it('AND THE LISTING IS VERIFIED', async () => {
        //   The control: a change that stopped approving would satisfy nothing
        //   above but is worth pinning beside it.
        store.seed(LAND, 'plot-1', { status: 'pending_verification', ownerId: 'farmer-9' });

        await approve('plot-1', 'land');

        expect(store.get(LAND, 'plot-1')).toMatchObject({
            status: 'verified', verified: true, verificationStatus: 'approved',
        });
    });

    it('and a land listing with no owner recorded does not invalidate anything', async () => {
        //   The guard beneath it is `if (result.success && type === "land" &&
        //   ownerId)`, so a missing owner means no call — unchanged, and pinned
        //   so the new path cannot start passing undefined into a cache key.
        store.seed(LAND, 'plot-1', { status: 'pending_verification' });

        expect((await approve('plot-1', 'land')).success).toBe(true);
        expect(mockInvalidateServiceCache).not.toHaveBeenCalled();
    });

    it('and approving a non-land type does not invalidate a farm cache', async () => {
        store.seed(COLLECTIONS.PRODUCTS, 'prod-1', { status: 'pending', sellerId: 'seller-2' });

        expect((await approve('prod-1', 'products')).success).toBe(true);
        expect(mockInvalidateServiceCache).not.toHaveBeenCalled();
    });

    it('and a listing in a state that cannot be approved is still refused', async () => {
        //   The land state check this file already had. A refactor of the owner
        //   id must not disturb it.
        store.seed(LAND, 'plot-1', { status: 'pending_escrow', ownerId: 'farmer-9' });

        expect((await approve('plot-1', 'land')).success).toBe(false);
        expect(store.get(LAND, 'plot-1')).toMatchObject({ status: 'pending_escrow' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#509 — and the second fetch is gone', () => {
    it('NO SECOND READ OF THE LAND DOCUMENT INSIDE THE TRANSACTION', () => {
        //   Comments stripped: the #509 header quotes the removed expression in
        //   order to explain it — the trap #493 recorded and this audit has met
        //   three times since.
        const body = stripComments(
            readFileSync('src/app/actions/admin-content.ts', 'utf-8'),
            { label: 'admin-content.ts' },
        );

        expect(body).not.toMatch(/\(await db\.collection\(COLLECTIONS\.LAND_LISTINGS\)\.doc\(id\)\.get\(\)\)/);
        expect(body).toContain('ownerId: landOwnerId');
    });
});
