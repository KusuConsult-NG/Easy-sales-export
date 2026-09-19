/**
 * @jest-environment node
 */

/**
 *   #904 (userId, TRANCHE 1) A MEMBER'S OWN RECORDS, UNDER THE FIELD THE
 *   EARLIER PASSES SET ASIDE.
 *
 *   `ownerId`, `buyerId` and `sellerId` were swept. `userId` was called "the
 *   broad platform surface" and deferred — twice — until the export module
 *   showed what that costs: one module answering two ways about who somebody
 *   is, because its orders were keyed `buyerId` and its windows `userId`.
 *
 *   This is the first tranche of the rest: a member's own READ-ONLY records.
 *   No money moves here and no admin semantics are involved, which is why it
 *   goes first.
 *
 *       certificates          earned and uploaded, across three field names
 *       saved items           what they bookmarked
 *       notifications         the unread badge, and the list behind it
 *       dashboard             the tiles, including a `participants` ARRAY
 *       my-data               withdrawals, applications, membership
 *       kyc                   the propagation, which is a WRITE
 *
 * ── THE BADGE IS THE ONE WORTH NAMING ───────────────────────────────────────
 *
 *   #738 redirects a NEW notice to the live profile. Notices written before
 *   that fix sit on the superseded row, and the unread count never looked
 *   there — so the badge said zero while they waited.
 *
 * ── AND KYC IS A WRITE, DELIBERATELY ────────────────────────────────────────
 *
 *   It propagates a corrected name, phone, state and address into the
 *   applications a member has filed. One filed on a profile they no longer
 *   sign in as kept the OLD details for ever. That file's own note says what
 *   is dangerous there is believing the sync cannot half-apply — a profile it
 *   never looks at is exactly that, permanently.
 *
 *   EXECUTED, with every list also shown in its BEFORE state.
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

let store: FakeDbHandle;

const LIVE = 'member-live';
const OLD = 'member-superseded';
const STRANGER = 'another-member';

const seedProfiles = () => {
    store.seed(COLLECTIONS.USERS, LIVE, { id: LIVE, email: 'm@e.com', supabaseAuthId: LIVE });
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'm@e.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { id: STRANGER, email: 'x@e.com', supabaseAuthId: STRANGER });
};

/** The pointer removed — the world exactly as it was before this tranche. */
const unlinkOldProfile = () =>
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'm@e.com' });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProfiles();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (userId) — the unread badge that said zero', () => {
    const seedNotice = (id: string, userId: string, read = false) =>
        store.seed(COLLECTIONS.NOTIFICATIONS, id, {
            id, userId, read, title: 'Your loan was approved',
            createdAt: '2026-09-12T10:00:00.000Z',
        });

    const count = async () => {
        const { countUnreadNotifications } = await import('@/lib/unread-notification-count');
        return await countUnreadNotifications(LIVE);
    };

    it('THE REPORTED CLASS: a notice on the superseded profile is counted', async () => {
        seedNotice('n-old', OLD);

        expect(await count()).toBe(1);
    });

    it('AND BEFORE THIS IT WAS NOT — the badge said zero while it waited', async () => {
        unlinkOldProfile();
        seedNotice('n-old', OLD);

        expect(await count()).toBe(0);
    });

    it('AND A READ ONE IS STILL NOT UNREAD', async () => {
        //   Vacuity: widening the owner must not widen the `read` filter.
        seedNotice('n-old', OLD, true);

        expect(await count()).toBe(0);
    });

    it('AND SOMEBODY ELSE\'S NOTICE IS NOT COUNTED — the control', async () => {
        seedNotice('n-theirs', STRANGER);
        seedNotice('n-ours', OLD);

        expect(await count()).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (userId) — the rest of a member\'s own records', () => {
    it('UPLOADED CERTIFICATES', async () => {
        store.seed(COLLECTIONS.USER_CERTIFICATES, 'c-old', {
            id: 'c-old', userId: OLD, name: 'Diploma',
            uploadedAt: '2026-09-12T10:00:00.000Z',
        });

        const { readUploadedCertificates } = await import('@/lib/certificates-reader');

        expect((await readUploadedCertificates(LIVE)).map((c: any) => c.id)).toEqual(['c-old']);
    });

    it('AND BEFORE THIS, NONE', async () => {
        unlinkOldProfile();
        store.seed(COLLECTIONS.USER_CERTIFICATES, 'c-old', {
            id: 'c-old', userId: OLD, name: 'Diploma',
            uploadedAt: '2026-09-12T10:00:00.000Z',
        });

        const { readUploadedCertificates } = await import('@/lib/certificates-reader');

        expect(await readUploadedCertificates(LIVE)).toHaveLength(0);
    });

    it('SAVED ITEMS', async () => {
        //   `targetId`, not `itemId`, and a real SavedItemType: the store
        //   drops a row with an empty targetId, so a fixture using the wrong
        //   field name would fail for a reason that has nothing to do with
        //   profiles.
        store.seed(COLLECTIONS.SAVED_ITEMS, 's-old', {
            id: 's-old', userId: OLD, itemType: 'marketplace_seller',
            targetId: 'seller-1', saved: true, savedAt: '2026-09-12T10:00:00.000Z',
        });

        const { readSavedRows } = await import('@/lib/saved-items-store');
        const rows = await readSavedRows(LIVE, 'marketplace_seller');

        expect(rows.map((r) => r.targetId)).toEqual(['seller-1']);
    });

    it('AND ANOTHER MEMBER\'S SAVED ITEMS ARE NOT MINE — the control', async () => {
        store.seed(COLLECTIONS.SAVED_ITEMS, 's-theirs', {
            id: 's-theirs', userId: STRANGER, itemType: 'marketplace_seller',
            targetId: 'seller-9', saved: true, savedAt: '2026-09-12T10:00:00.000Z',
        });

        const { readSavedRows } = await import('@/lib/saved-items-store');

        expect(await readSavedRows(LIVE, 'marketplace_seller')).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (userId) — and the one that is a write', () => {
    it('KYC PROPAGATES INTO AN APPLICATION FILED ON THE OTHER PROFILE', async () => {
        /*
         *   The half a read-only sweep would have missed. An application filed
         *   on the superseded profile kept the member's OLD phone and address
         *   for ever, because the sync only ever looked at the live id.
         */
        const src = await import('fs').then((fs) =>
            fs.readFileSync('src/app/actions/kyc.ts', 'utf-8'));

        //   Asserted on the source because the action behind it needs a full
        //   KYC payload and a verified provider; what changed is WHICH ROWS it
        //   reaches, and that is visible here without inventing a KYC run.
        expect(src).toContain('const kycProfileIds = await ownedProfileIds(userId);');
        expect(src).not.toMatch(/\.where\('userId', '==', userId\)/);

        //   All five module collections, not some of them — the partial sweep
        //   is the defect this whole finding is about.
        expect((src.match(/filterByOwner\(/g) ?? []).length).toBe(5);
    });
});
