/**
 * @jest-environment node
 */

/**
 *   #542 A MEMBER WHOSE PROFILE IS COMPLETE WAS SENT BACK TO IT AT EVERY LOGIN.
 *
 *   Reported by the owner: "a user that has all profile correct shouldn't be
 *   redirected to profile again at login".
 *
 *   THE MECHANISM. A migrated account keeps its old row and marks it with
 *   `_migratedTo` (or `supabaseAuthId`) naming the live row. lib/user-identity
 *   exists to walk that pointer, and its own header says why: "on a twice-
 *   migrated member the session said one account and the money went to
 *   another".
 *
 *   Six places resolve this identity. THREE walked the pointer and three did
 *   not:
 *
 *     session-guard.requireSession        walked it
 *     user-cache.getUserProfile (the JWT) walked it
 *     the Paystack webhook and crons      walked it
 *     hub-guard.requireHubRegistration    DID NOT
 *     getUserProfileAction  (the screen)  DID NOT
 *     updateUserProfileAction (the save)  DID NOT
 *
 *   So the platform knew a migrated member as one account while their own
 *   profile screen read and wrote another. The session, the JWT and every money
 *   path used the live row; the profile screen showed the PRE-migration row —
 *   usually little more than an email address — and the guard on all sixteen
 *   module layouts checked that same old row for `profileComplete`, did not
 *   find it, and sent them to /hub/register, which forwards to
 *   /profile?notice=complete-your-hub-registration.
 *
 *   The member is shown an empty profile and told to complete it, at every
 *   login, while the record the rest of the platform uses is already complete.
 *
 *   MY FIRST ACCOUNT OF THIS WAS WRONG AND IS CORRECTED HERE RATHER THAN
 *   QUIETLY REWRITTEN. I wrote that the screen displayed the RESOLVED profile,
 *   because user-cache.getUserProfile resolves and I assumed the screen went
 *   through it. It does not — getUserProfileAction reads the raw document. The
 *   symptom is worse than I first described, not better: the member does not
 *   see a finished profile they are told to finish, they see an EMPTY one while
 *   their real data sits in a row the screen never opens.
 *
 *   ALL THREE MOVE TOGETHER OR NOT AT ALL. Fixing only the guard would swap one
 *   mismatch for another — the save would stamp `profileComplete` on the row
 *   nobody reads, and the redirect loop would survive the save meant to end it.
 *   Fixing only the screen would show the right data and still file the edits
 *   against the wrong document.
 *
 * ── WHY IT SURVIVED THIS LONG ───────────────────────────────────────────────
 *
 *   #366 ran this guard for the first time and pinned six behaviours, including
 *   "the refusal of an incomplete profile". Every one of those tests seeds a
 *   row at the session's own id, so the pointer is never exercised — the guard
 *   and the resolver agree in every case the suite constructs.
 *
 *   It is the audit's most common shape once more: several readers of one fact,
 *   and the one that disagreed was the one standing at the door.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the guard's pointer walk removed again        KILLED (2 tests)
 *     the writer's pointer walk removed again       KILLED (1)
 *     the screen's pointer walk removed again       KILLED (1)
 *     reword the source header                      SURVIVED, as intended
 *
 *   Each of the three was mutated SEPARATELY, because the failure this finding
 *   is about is precisely two of them disagreeing. A single mutant removing all
 *   three at once would have restored the old, self-consistent-but-wrong state
 *   and told me nothing.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';

class RedirectSignal extends Error {
    constructor(public readonly to: string) {
        super(`NEXT_REDIRECT;${to}`);
        this.name = 'NEXT_REDIRECT';
    }
}

jest.mock('next/navigation', () => ({
    redirect: (to: string) => { throw new RedirectSignal(to); },
}));

//   Redis unset, which is how this platform is deployed — #453 quotes the
//   startup log. It matters here: with a warm cache the guard would read the
//   profile session-guard had already RESOLVED and the defect would be hidden.
//   Unset, the guard falls through to its own read, which is the broken one.
jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
    CacheKeys: { userProfile: (id: string) => `user:profile:${id}` },
}));

/**
 * The harness the existing profile suites use.
 *
 * updateUserProfileAction writes through versionedUpdate inside a transaction
 * and then invalidates a cache and syncs the auth email; none of those work
 * under the fake, and a throw in any of them lands in withSafeAction's catch
 * and comes back as a generic connection message that looks exactly like a
 * defect in the code under test.
 *
 * Mocking versionedUpdate also gives the better assertion: which DOCUMENT the
 * write was aimed at, which is precisely what this finding is about.
 */
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (fn: unknown) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));
jest.mock('@/lib/auth-revocation', () => ({
    syncAuthEmail: jest.fn(async () => ({ primaryRevoked: true, error: null })),
    revokeAuthAccess: jest.fn(async () => ({ primaryRevoked: true })),
}));

const mockVersionedUpdate = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/lib/optimistic-locking', () => ({
    versionedUpdate: (...a: any[]) => mockVersionedUpdate(...a),
}));

/** The id of the document the save was aimed at. */
const writtenTo = (): string | undefined => {
    const ref = mockVersionedUpdate.mock.calls[0]?.[1] as { id?: string; path?: string } | undefined;
    return ref?.id ?? ref?.path?.split('/').pop();
};

let store: FakeDbHandle;

/** The old row the session still names, and the live row it points at. */
const OLD_ID = 'legacy-uid-1';
const LIVE_ID = 'supabase-uid-1';

async function outcome(): Promise<{ redirectedTo: string } | { returned: true } | { threw: string }> {
    try {
        await (await import('@/lib/hub-guard')).requireHubRegistration();
        return { returned: true };
    } catch (e) {
        if (e instanceof RedirectSignal) return { redirectedTo: e.to };
        return { threw: (e as Error).message };
    }
}

function signedInAs(id: string): void {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id, roles: ['general_user'], email: `${id}@example.com`, name: id } },
        error: null,
    });
}

/**
 * The exact production shape: the session still names the pre-migration row,
 * that row carries the pointer, and the LIVE row holds the finished profile.
 */
function seedMigratedMemberWithCompleteProfile(): void {
    store.seed('users', OLD_ID, {
        email: `${OLD_ID}@example.com`,
        _migratedTo: LIVE_ID,
    });
    store.seed('users', LIVE_ID, {
        email: `${OLD_ID}@example.com`,
        firstName: 'Ada', lastName: 'Obi',
        phone: '+2348031111111', gender: 'female', location: 'Jos',
        profileComplete: true,
    });
}

beforeEach(() => {
    jest.resetModules();
    store = installFakeDb();
    mockVersionedUpdate.mockClear();
    (global as any).mockRequireSession.mockReset();
    signedInAs(OLD_ID);
});

afterEach(() => {
    store.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#542 — the guard reads the profile the member actually has', () => {
    it('A MIGRATED MEMBER WITH A COMPLETE PROFILE IS LET THROUGH', async () => {
        //   THE test. Before the fix this redirected to /hub/register, which
        //   forwards to /profile — the loop the owner reported.
        seedMigratedMemberWithCompleteProfile();

        expect(await outcome()).toEqual({ returned: true });
    });

    it('AND ONE WHOSE LIVE PROFILE IS STILL INCOMPLETE IS STILL REFUSED', async () => {
        //   The vacuity guard. A "fix" that admitted everybody passes the test
        //   above and takes the gate off sixteen module layouts.
        store.seed('users', OLD_ID, { _migratedTo: LIVE_ID });
        store.seed('users', LIVE_ID, { firstName: 'Ada', profileComplete: false });

        expect(await outcome()).toEqual({ redirectedTo: '/hub/register' });
    });

    it('AND AN UNMIGRATED MEMBER IS UNAFFECTED', async () => {
        //   The ordinary case, which is every case #366's suite constructs.
        store.seed('users', OLD_ID, { profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });

    it('AND A POINTER TO A ROW THAT IS NOT THERE KEEPS THE ROW THAT IS', async () => {
        //   user-identity's rule: a broken chain degrades to the newest row that
        //   EXISTS, never to no row. A member must not be locked out because a
        //   migration left a dangling pointer.
        store.seed('users', OLD_ID, { _migratedTo: 'nonexistent-row', profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });

    it('AND TWO ROWS POINTING AT EACH OTHER DO NOT HANG THE DOOR', async () => {
        store.seed('users', OLD_ID, { _migratedTo: LIVE_ID, profileComplete: true });
        store.seed('users', LIVE_ID, { _migratedTo: OLD_ID, profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });

    it('AND supabaseAuthId IS FOLLOWED TOO, not only _migratedTo', async () => {
        //   pointerOf reads both spellings. A guard that honoured one of them
        //   would fix half the affected accounts — the "reached one of N doors"
        //   result this audit keeps producing.
        store.seed('users', OLD_ID, { supabaseAuthId: LIVE_ID });
        store.seed('users', LIVE_ID, { profileComplete: true });

        expect(await outcome()).toEqual({ returned: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#542 — the screen and the save use that same row', () => {
    /**
     * The guard is only a third of it. If the screen still read the old row a
     * migrated member would be admitted and shown an empty profile; if the save
     * still wrote to the old row, completing that profile would stamp the flag
     * on a document the guard no longer reads, and the loop would come back.
     */
    async function profileActions() {
        return import('@/app/actions/profile');
    }

    it('THE SCREEN SHOWS THE LIVE ROW, NOT THE PRE-MIGRATION ONE', async () => {
        seedMigratedMemberWithCompleteProfile();

        const { getUserProfileAction } = await profileActions();
        const result: any = await getUserProfileAction();

        expect(result.success).toBe(true);
        //   The old row holds only an email. Seeing a first name at all means
        //   the pointer was followed.
        expect(result.data.profile.firstName).toBe('Ada');
        expect(result.data.profile.phone).toBe('+2348031111111');
    });

    it('AND THE SAVE IS AIMED AT THE ROW THE SCREEN SHOWED', async () => {
        seedMigratedMemberWithCompleteProfile();

        const { updateUserProfileAction } = await profileActions();
        await updateUserProfileAction({ location: 'Abuja' });

        //   Not the row the session names — the row the platform considers live.
        expect(writtenTo()).toBe(LIVE_ID);
    });

    it('AND AN UNMIGRATED MEMBER STILL SAVES TO THEIR OWN ROW', async () => {
        //   The vacuity guard: a resolver that always returned some other id
        //   would pass the test above and break every ordinary member.
        store.seed('users', OLD_ID, {
            email: `${OLD_ID}@example.com`, firstName: 'Ada', profileComplete: true,
        });

        const { updateUserProfileAction } = await profileActions();
        await updateUserProfileAction({ location: 'Kano' });

        expect(writtenTo()).toBe(OLD_ID);
    });
});
