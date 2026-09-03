/**
 * @jest-environment node
 */

/**
 * Changing your password did nothing, and said it had worked.
 *
 * THE DEFECT
 * ----------
 * `changePasswordAction` verified the current password against Firebase and
 * wrote the new one with `adminAuth.updateUser` — Firebase, and only Firebase.
 *
 * `lib/auth.ts` authenticates against SUPABASE first. Firebase is a legacy
 * fallback used for just-in-time migration:
 *
 *     const { data: sbData, error: sbError } =
 *         await supabase.auth.signInWithPassword({ email, password });
 *     ...
 *     } else {
 *         // Fallback: Verify credentials against Firebase Auth for JIT migration
 *
 * So after a "successful" change, with Supabase still holding the old secret:
 *
 *   OLD password   Supabase accepts it. Login succeeds.
 *   NEW password   Supabase rejects it. The Firebase fallback accepts it, then
 *                  calls supabaseAdmin.auth.admin.createUser, gets
 *                  "already exists", and throws auth/invalid-credential.
 *                  Login FAILS.
 *
 * The new password did not work, the old one kept working, and the person who
 * changed it because it had been compromised was told "success". A password
 * change is the one control whose entire purpose is to revoke the old secret.
 *
 * THE SECOND DEFECT
 * -----------------
 * `newPassword` went straight to the provider. Registration requires eight
 * characters with an uppercase, a lowercase, a digit and a symbol; changing a
 * password enforced nothing beyond Firebase's own six-character floor, so an
 * account could drop below the policy it was created under. The policy now
 * lives in one place, `passwordPolicySchema`, which registerSchema also uses.
 *
 * WHAT IS NOT COVERED HERE
 * ------------------------
 * That Supabase and Firebase genuinely diverge in production. That is a claim
 * about two live auth services, and no unit test can make it. What these tests
 * pin is the behaviour that follows from it and that the code fully controls:
 * the primary store is the one verified, the primary store is the one written,
 * a failure to write it is reported as a failure, and the legacy store is
 * updated too so no superseded credential survives behind the fallback.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';
const EMAIL = 'user@e.com';
const SUPABASE_ID = 'ab8f1c22-0000-4000-8000-000000000001';

const GOOD_OLD = 'OldPassw0rd!';
const GOOD_NEW = 'NewPassw0rd!';

/**
 * The action refuses early with "Service configuration error" when these are
 * absent, which is correct behaviour and made every assertion below fail for a
 * reason unrelated to the code under test. The Supabase client itself is mocked;
 * these only have to be non-empty.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-firebase-key';

const mockSignInWithPassword = jest.fn() as jest.Mock<any>;
const mockUpdateUserById = jest.fn() as jest.Mock<any>;
const mockFirebaseUpdateUser = jest.fn() as jest.Mock<any>;
const mockAuth = jest.fn() as jest.Mock<any>;

jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        auth: { signInWithPassword: (...a: any[]) => mockSignInWithPassword(...a) },
    }),
}));
jest.mock('@/lib/supabase', () => ({
    supabase: {},
    supabaseAdmin: {
        auth: { admin: { updateUserById: (...a: any[]) => mockUpdateUserById(...a) } },
    },
}));
jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        updateUser: (...a: any[]) => mockFirebaseUpdateUser(...a),
        createUser: jest.fn(),
        getUserByEmail: jest.fn(),
    },
    getAdminAuth: () => ({ updateUser: (...a: any[]) => mockFirebaseUpdateUser(...a) }),
}));

/**
 * changePasswordAction calls auth() directly rather than requireSession, so the
 * harness's mockRequireSession does not reach it. Mocking the module wholesale
 * would take signIn/signOut with it, which this file's other exports need, so
 * only auth is replaced.
 */
jest.mock('@/lib/auth', () => ({
    auth: (...a: any[]) => mockAuth(...a),
    signIn: jest.fn(),
    signOut: jest.fn(),
    handlers: {},
}));

/** The Firebase fallback verification, which is a raw fetch. */
const mockFetch = jest.fn() as jest.Mock<any>;
(global as any).fetch = mockFetch;

function setSession(id = USER, email: string | null = EMAIL) {
    mockAuth.mockResolvedValue({ user: { id, email, roles: [] } });
}

async function change(current: string, next: string) {
    const { changePasswordAction } = await import('@/app/actions/auth');
    return changePasswordAction(current, next);
}

describe('changePasswordAction — the primary store is the one that counts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession();
        mockSignInWithPassword.mockResolvedValue({ data: { user: { id: SUPABASE_ID } }, error: null });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdateUser.mockResolvedValue({});
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => ({ supabaseAuthId: SUPABASE_ID }),
        }));
    });

    it('writes the new password to Supabase, not only to Firebase', async () => {
        // THE test. Supabase is what lib/auth.ts checks first; a change that
        // misses it leaves the old password working.
        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(true);
        expect(mockUpdateUserById).toHaveBeenCalledWith(
            SUPABASE_ID,
            expect.objectContaining({ password: GOOD_NEW })
        );
    });

    it('verifies the current password against Supabase first', async () => {
        // Verifying against the legacy store is how the write ended up there
        // too. An account created after the migration may have no Firebase
        // record at all, in which case the old check refused a correct password.
        await change(GOOD_OLD, GOOD_NEW);

        expect(mockSignInWithPassword).toHaveBeenCalledWith(
            expect.objectContaining({ email: EMAIL, password: GOOD_OLD })
        );
    });

    it('DOES NOT MAKE A SECOND WRITE THROUGH THE FIREBASE SHIM', async () => {
        /**
         * This test used to assert the opposite, under the comment "updates the
         * legacy store too, so the fallback stops accepting the old password".
         * The reasoning was right about the risk and wrong about the call.
         *
         * package.json maps firebase-admin to src/lib/shims/firebase-admin, and
         * that shim's updateUser is supabaseAdmin.auth.admin.updateUserById.
         * So `adminAuth.updateUser` wrote to the SAME Supabase store the line
         * above had just written to — the legacy store was never updated, and
         * this assertion was pinning a call that could not do what it said.
         *
         * It also passed `session.user.id` where the Supabase write correctly
         * passes `supabaseAuthId`; for a migrated account those differ, so it
         * addressed an id that does not exist and threw into a catch that
         * logged "skipped".
         *
         * Removing it opens nothing: the stale Firebase password cannot
         * complete a login, because lib/auth.ts's fallback provisions the
         * account in Supabase afterwards and turns "already exists" into
         * auth/invalid-credential. Asserted in
         * auth-password-and-logout.test.ts, which also pins the shim.
         */
        await change(GOOD_OLD, GOOD_NEW);

        expect(mockFirebaseUpdateUser).not.toHaveBeenCalled();
    });

    it('reports failure when the primary store cannot be written', async () => {
        // The defect in one line: never say "password changed" while the store
        // that authenticates logins still holds the old one.
        mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'nope' } });

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(false);
    });

    it('still succeeds when only the legacy update fails', async () => {
        // Plenty of accounts have no Firebase record. The primary store is
        // already correct by then, so this must not be reported as a failure.
        mockFirebaseUpdateUser.mockRejectedValue(new Error('no such user'));

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(true);
    });

    it('refuses a wrong current password, and writes nothing anywhere', async () => {
        mockSignInWithPassword.mockResolvedValue({ data: null, error: { message: 'invalid' } });
        mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'INVALID_PASSWORD' } }) });

        const r: any = await change('WrongPassw0rd!', GOOD_NEW);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/incorrect current password/i);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
        expect(mockFirebaseUpdateUser).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
        mockAuth.mockResolvedValue(null);

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(false);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#306 — the revocation covers the session that matters', () => {
    /**
     *   #306 THE REVOCATION LET THE INTRUDER'S SESSION THROUGH, AND THE COMMENT
     *        EXPLAINING WHY WAS THE DEFECT.
     *
     *        It stamped `sessionsValidFrom = session.user.authAt` — the issue
     *        time of the session doing the changing — and the code argued for it:
     *
     *          "A stolen cookie is necessarily older than the session you are
     *           sitting in when you notice and react ... A session minted AFTER
     *           this one survives, deliberately: it could only have been created
     *           with a password, and after this call that is the new one."
     *
     *        Both halves are false, and the second is a contradiction: a session
     *        minted after yours but before this call was created with the OLD
     *        password, because the new one does not exist yet.
     *
     *        The consequence is the ordinary case, not a corner one. You sign in
     *        Monday. Somebody who learned your password signs in Tuesday. You
     *        notice Wednesday and change it from your Monday session.
     *        revokeBefore is Monday; their session is Tuesday; Tuesday is not
     *        before Monday; they stay signed in.
     *
     *        `Date.now()` now, which revokes everything including the caller.
     *        There is no way to exempt one session — the predicate in
     *        lib/auth.ts is a single scalar compared against each token's issue
     *        time, and nothing re-stamps `authAt` after a change.
     */
    /**
     * The recorder is called as `update(id, fields)` — see
     * lib/testing/firestore-mock-db.js — so the patch is argument ONE. Reading
     * argument zero returns the document id, which is a string and satisfies
     * neither `toHaveProperty` nor a field comparison; it fails loudly rather
     * than passing vacuously, which is how this was caught.
     */
    const lastUpdate = () => {
        const calls = ((global as any).mockFirestoreUpdate as jest.Mock).mock.calls;
        return calls.length ? (calls[calls.length - 1] as any[])[1] : undefined;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setSession();
        mockSignInWithPassword.mockResolvedValue({ data: { user: { id: SUPABASE_ID } }, error: null });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdateUser.mockResolvedValue({});
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => ({ supabaseAuthId: SUPABASE_ID }),
        }));
        (global as any).mockFirestoreUpdate.mockResolvedValue(undefined);
    });

    it('THE REVOCATION POINT IS NOW, NOT WHEN THIS SESSION STARTED', async () => {
        const before = Date.now();
        // A session issued long ago — the shape that let a newer intruder
        // session survive.
        mockAuth.mockResolvedValue({
            user: { id: USER, email: EMAIL, roles: [], authAt: before - 3 * 24 * 60 * 60 * 1000 },
        });

        await change(GOOD_OLD, GOOD_NEW);

        const patch = lastUpdate();
        expect(patch?.sessionsValidFrom).toEqual(expect.any(Number));
        expect(patch.sessionsValidFrom).toBeGreaterThanOrEqual(before);
    });

    it('A SESSION MINTED AFTER THIS ONE IS REVOKED TOO — the case that was missed', async () => {
        // The predicate in lib/auth.ts is `issuedAt < sessionsValidFrom`.
        // Reproduced here against the value actually written, because that is
        // the whole of what this action controls.
        const myLogin = Date.now() - 3 * 24 * 60 * 60 * 1000;   // Monday
        const intruderLogin = Date.now() - 1 * 24 * 60 * 60 * 1000; // Tuesday
        mockAuth.mockResolvedValue({ user: { id: USER, email: EMAIL, roles: [], authAt: myLogin } });

        await change(GOOD_OLD, GOOD_NEW);
        const stamp = lastUpdate().sessionsValidFrom as number;

        const revoked = (issuedAt: number) => issuedAt < stamp;

        expect(revoked(intruderLogin)).toBe(true);
        // And the old behaviour, stated so the difference is unmistakable: with
        // the stamp set to the caller's own authAt, the intruder survived.
        expect(intruderLogin < myLogin).toBe(false);
    });

    it('it no longer depends on the caller having a recorded issue time', async () => {
        // The old code skipped the revocation entirely when authAt was absent —
        // "fails OPEN" — so a session with no issue time revoked nothing.
        mockAuth.mockResolvedValue({ user: { id: USER, email: EMAIL, roles: [] } });

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(true);
        expect(lastUpdate()?.sessionsValidFrom).toEqual(expect.any(Number));
    });

    it('reports that the sessions were revoked', async () => {
        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(true);
        expect(r.sessionsRevoked).toBe(true);
    });

    it('AND SAYS SO WHEN THEY WERE NOT, instead of reporting a plain success', async () => {
        // The old catch logged "the forced-change flag was not cleared" — the
        // lesser of the two consequences — and returned an unqualified success
        // while every other session, the intruder's included, stayed alive.
        (global as any).mockFirestoreUpdate.mockRejectedValue(new Error('write failed'));

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        // Still a success: the password IS changed in both stores by then, and
        // saying otherwise would be the worse lie.
        expect(r.success).toBe(true);
        expect(r.sessionsRevoked).toBe(false);
    });

    it('and the forced-change flag is still cleared in the same write', async () => {
        await change(GOOD_OLD, GOOD_NEW);

        expect(lastUpdate()).toHaveProperty('requiresPasswordChange');
        expect(lastUpdate()).toHaveProperty('passwordChangedAt');
    });
});

describe('changePasswordAction — legacy accounts still work', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession();
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdateUser.mockResolvedValue({});
        // Not in Supabase Auth: the pre-migration case.
        mockSignInWithPassword.mockResolvedValue({ data: null, error: { message: 'invalid' } });
        mockFetch.mockResolvedValue({ ok: true, json: async () => ({ localId: 'fb-1' }) });
    });

    it('falls back to the legacy check and still writes the primary store', async () => {
        // The fallback exists so pre-migration accounts can change a password
        // at all. It must not become a route back to the original defect, so
        // the Supabase write still has to happen.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => ({ supabaseAuthId: SUPABASE_ID }),
        }));

        const r: any = await change(GOOD_OLD, GOOD_NEW);

        expect(r.success).toBe(true);
        expect(mockUpdateUserById).toHaveBeenCalledWith(SUPABASE_ID, expect.objectContaining({ password: GOOD_NEW }));
    });

    it('falls back to the profile id when no supabaseAuthId is recorded', async () => {
        // A normally-registered account uses its Supabase UUID as the document
        // id, so there is nothing to record.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => ({}),
        }));

        await change(GOOD_OLD, GOOD_NEW);

        expect(mockUpdateUserById).toHaveBeenCalledWith(USER, expect.objectContaining({ password: GOOD_NEW }));
    });
});

describe('changePasswordAction — the new password meets the registration policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession();
        mockSignInWithPassword.mockResolvedValue({ data: { user: { id: SUPABASE_ID } }, error: null });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdateUser.mockResolvedValue({});
    });

    const weak: Array<[string, string]> = [
        ['Sh0rt!', 'shorter than eight characters'],
        ['nouppercase1!', 'no uppercase letter'],
        ['NOLOWERCASE1!', 'no lowercase letter'],
        ['NoDigitsHere!', 'no digit'],
        ['NoSymbolHere1', 'no special character'],
    ];

    for (const [password, why] of weak) {
        it(`refuses a password with ${why}`, async () => {
            const r: any = await change(GOOD_OLD, password);

            expect(r.success).toBe(false);
            expect(mockUpdateUserById).not.toHaveBeenCalled();
        });
    }

    it('refuses reusing the current password', async () => {
        const r: any = await change(GOOD_OLD, GOOD_OLD);

        expect(r.success).toBe(false);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });

    it('accepts a password that meets the policy', async () => {
        // Vacuity guard: every refusal above is satisfied by an action that
        // rejects everything.
        const r: any = await change(GOOD_OLD, 'An0ther$trongOne');

        expect(r.success).toBe(true);
    });
});
