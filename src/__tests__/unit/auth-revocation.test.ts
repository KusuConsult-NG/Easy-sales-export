/**
 * @jest-environment node
 */

/**
 * Deleting an account did not stop the person signing in.
 *
 * This came out of a SWEEP rather than a file audit. #124 fixed the password
 * reset writing to the wrong auth store, which was the second instance of that
 * after #108 — so instead of opening the next file I grepped for every call that
 * writes a credential. It found three more, all the same root cause: **Supabase
 * is what lib/auth.ts authenticates against, and these wrote Firebase, or
 * nothing.**
 *
 * 1. admin_extensions.ts — the admin soft-delete
 *    Disabled the FIREBASE auth user, with the comment "prevent login". Login
 *    tries Supabase first and only falls back to Firebase, so the disabled
 *    record was never consulted. It set `roles: ["deleted"]` and
 *    `isActive: false`; lib/auth.ts checks neither — it refuses on isBanned,
 *    status === 'banned' or suspended. A deleted user kept their original email
 *    and password and could sign in to a scrubbed account.
 *
 * 2. user.ts — the user's own right-to-erasure path
 *    Scrubbed the profile and touched NO auth store at all. Somebody who
 *    deleted their account kept a working password. This is the one I built the
 *    UI for, which makes it mine to have missed.
 *
 * 3. profile.ts — the email change
 *    Updated Firebase only, so the OLD address kept signing in through Supabase
 *    — and the new one fell through to the Firebase fallback, which then tries
 *    to provision the account in Supabase and can fork a second auth identity
 *    for the same person.
 *
 * All three now go through lib/auth-revocation.ts, which does both halves:
 * `suspended: true` on the profile — a field the sign-in path already refuses —
 * and a move to a scrubbed address with a random password in Supabase, which is
 * what actually stops the remembered credentials working.
 *
 * WHAT THESE TESTS CANNOT SHOW
 * ----------------------------
 * That Supabase really rejects the old password afterwards. That is a claim
 * about a live service. What they pin is what the code controls: the primary
 * store is written, a failure to write it fails the operation, the profile
 * carries the flag the sign-in path reads, and the legacy store is updated too.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';
const ADMIN = 'admin-1';
const TARGET = 'target-1';

const mockUpdateUserById = jest.fn() as jest.Mock<any>;
const mockFirebaseUpdate = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/supabase', () => ({
    supabase: {},
    supabaseAdmin: { auth: { admin: { updateUserById: (...a: any[]) => mockUpdateUserById(...a) } } },
}));
jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        updateUser: (...a: any[]) => mockFirebaseUpdate(...a),
        getUserByEmail: jest.fn(async () => ({ uid: 'fb-1' })),
    },
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

function setWorld(profile: Record<string, any> = {}) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: true, docs: [],
        data: () => ({ email: 'real@example.com', roles: ['farmer'], ...profile }),
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: true, docs: [],
        data: () => ({ email: 'real@example.com', roles: ['farmer'], ...profile }),
    }));
}

function profileWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreBatchUpdate.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

describe('revokeAuthAccess — the credentials stop working, not just the record', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
    });

    it('moves the Supabase account to a scrubbed address and a new password', async () => {
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        const r = await revokeAuthAccess(USER, 'deleted_x@redacted.local');

        expect(r.primaryRevoked).toBe(true);
        const [id, patch] = mockUpdateUserById.mock.calls[0] as any[];
        expect(id).toBe(USER);
        expect(patch.email).toBe('deleted_x@redacted.local');
        expect(typeof patch.password).toBe('string');
        expect(patch.password.length).toBeGreaterThan(20);
    });

    it('disables the legacy record too', async () => {
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        await revokeAuthAccess(USER, 'deleted_x@redacted.local');

        expect(mockFirebaseUpdate).toHaveBeenCalledWith(
            USER, expect.objectContaining({ disabled: true })
        );
    });

    it('reports failure when the primary store cannot be written', async () => {
        mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'nope' } });
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        const r = await revokeAuthAccess(USER, 'deleted_x@redacted.local');

        expect(r.primaryRevoked).toBe(false);
    });

    it('succeeds when only the legacy store fails', async () => {
        // Most accounts have no Firebase record at all.
        mockFirebaseUpdate.mockRejectedValue(new Error('no such user'));
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        const r = await revokeAuthAccess(USER, 'deleted_x@redacted.local');

        expect(r.primaryRevoked).toBe(true);
        expect(r.legacyRevoked).toBe(false);
    });

    it('uses the recorded Supabase id when the profile carries one', async () => {
        // A legacy account migrated by lib/auth.ts has a different id in each
        // store; revoking the wrong one would leave the account signing in.
        setWorld({ supabaseAuthId: 'sb-uuid-9' });
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        await revokeAuthAccess(USER, 'deleted_x@redacted.local');

        expect((mockUpdateUserById.mock.calls[0] as any[])[0]).toBe('sb-uuid-9');
    });
});

describe('the self-service deletion revokes sign-in', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
        setWorld();
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
    });

    async function deleteAccount() {
        const { deleteUserAccountAction } = await import('@/app/actions/user');
        return deleteUserAccountAction();
    }

    it('marks the profile suspended, which is what the sign-in path reads', async () => {
        // `deleted: true` was already written and is read by nothing in
        // lib/auth.ts, which refuses on isBanned / status / suspended.
        await deleteAccount();

        const scrub = profileWrites().find((p) => p && 'deleted' in p);
        expect(scrub?.suspended).toBe(true);
    });

    it('revokes the credentials in the primary store', async () => {
        // THE test. This path used to touch no auth store at all.
        await deleteAccount();

        expect(mockUpdateUserById).toHaveBeenCalled();
    });

    it('reports failure if the data is scrubbed but sign-in survives', async () => {
        // Telling somebody their account is gone while their password still
        // works is the outcome the whole function exists to avoid.
        mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'nope' } });

        const r: any = await deleteAccount();

        expect(r.success).toBe(false);
    });
});

describe('the admin deletion revokes sign-in', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin', 'super_admin']);
        setWorld();
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
    });

    async function adminDelete(target = TARGET) {
        const mod: any = await import('@/app/actions/admin_extensions');
        const fn = mod.deleteUserAction || mod.adminDeleteUserAction || mod.softDeleteUserAction;
        return fn(target);
    }

    it('sets the flag the sign-in path reads', async () => {
        await adminDelete();

        const scrub = profileWrites().find((p) => p && 'deleted' in p);
        expect(scrub?.suspended).toBe(true);
    });

    it('revokes in Supabase, not only Firebase', async () => {
        // The old code disabled Firebase with the comment "prevent login",
        // against the store login consults second.
        await adminDelete();

        expect(mockUpdateUserById).toHaveBeenCalled();
    });

    it('still refuses an admin deleting themselves', async () => {
        // Pre-existing guard; must survive the change.
        const r: any = await adminDelete(ADMIN);

        expect(r.success).toBe(false);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });
});

describe('the profile email change reaches the primary store', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
        setWorld();
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
    });

    it('updates Supabase so the old address stops signing in', async () => {
        const { syncAuthEmail } = await import('@/lib/auth-revocation');

        const r = await syncAuthEmail(USER, 'new@example.com');

        expect(r.primaryRevoked).toBe(true);
        expect(mockUpdateUserById).toHaveBeenCalledWith(
            USER, expect.objectContaining({ email: 'new@example.com' })
        );
    });

    it('does not change the password while changing the address', async () => {
        // The person keeps their access — this is not a revocation.
        const { syncAuthEmail } = await import('@/lib/auth-revocation');

        await syncAuthEmail(USER, 'new@example.com');

        expect((mockUpdateUserById.mock.calls[0] as any[])[1]).not.toHaveProperty('password');
    });

    it('reports an address already in use', async () => {
        mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'email address already registered' } });
        const { syncAuthEmail } = await import('@/lib/auth-revocation');

        const r = await syncAuthEmail(USER, 'taken@example.com');

        expect(r.primaryRevoked).toBe(false);
        expect(String(r.error)).toMatch(/registered|already/i);
    });
});
