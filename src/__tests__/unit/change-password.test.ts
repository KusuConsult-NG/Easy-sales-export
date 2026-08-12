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

    it('updates the legacy store too, so the fallback stops accepting the old password', async () => {
        // lib/auth.ts falls back to Firebase whenever Supabase rejects a
        // password. Leaving Firebase on the old secret keeps a superseded
        // credential alive behind that fallback.
        await change(GOOD_OLD, GOOD_NEW);

        expect(mockFirebaseUpdateUser).toHaveBeenCalledWith(
            USER,
            expect.objectContaining({ password: GOOD_NEW })
        );
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
