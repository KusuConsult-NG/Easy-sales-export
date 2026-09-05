/**
 * @jest-environment node
 */

/**
 * Resetting a password did nothing, in the path people use when locked out.
 *
 * This is #108's defect again, in the more critical of the two places. That one
 * fixed changePasswordAction, which requires the CURRENT password. This one is
 * reachable with only an email — it is what somebody uses when they cannot get
 * in, or believe their password is compromised.
 *
 * `resetPasswordAction` called `adminAuth.updateUser` and nothing else.
 * lib/auth.ts authenticates against SUPABASE first and treats Firebase as a
 * legacy fallback, so with Supabase still holding the old secret:
 *
 *   OLD password   Supabase accepts it. Login succeeds.
 *   NEW password   Supabase rejects it. The Firebase fallback accepts, then
 *                  tries to provision the user in Supabase, gets "already
 *                  exists", and throws auth/invalid-credential. Login fails.
 *
 * The reset did nothing, the old password kept working, and the person was told
 * to sign in with the new one.
 *
 * THREE MORE, IN THE SAME FUNCTION
 * --------------------------------
 * The password was checked for LENGTH alone — `password.length < 8` — making a
 * reset the weakest of the three ways to set a password here, and the only one
 * reachable without knowing the old one. Registration and (since #108)
 * changePasswordAction both enforce the full policy.
 *
 * The token was marked used at the very END, after the password write and after
 * clearing requiresPasswordChange. A failure in between left a valid reset link
 * in the database.
 *
 * The user was resolved with Firebase's getUserByEmail, so an account created
 * after the migration with no Firebase record — registerAction catches that
 * failure and logs a warning — could not reset its password at all.
 *
 * AND ONE IN THE OTHER FUNCTION
 * -----------------------------
 * `sendResetEmailAction` is unauthenticated, sends a real email on every call,
 * and had no rate limit of any kind. One address could be mailed as fast as
 * requests could be made, at the platform's cost and the recipient's expense.
 *
 * It is keyed on the email, because the caller is anonymous and the address is
 * what is being abused — and deliberately NOT on the login bucket, which is
 * keyed by email too: spending that here would let reset requests lock the same
 * person out of signing in. A refusal returns the same shape as an unknown
 * address, so the limit does not become an oracle for which emails are
 * registered.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, jest } from '@jest/globals';

const EMAIL = 'person@example.com';
const SUPABASE_ID = 'ab8f1c22-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(64);
const GOOD_PASSWORD = 'NewPassw0rd!';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

const mockUpdateUserById = jest.fn() as jest.Mock<any>;
const mockFirebaseUpdate = jest.fn() as jest.Mock<any>;
const mockGetUserByEmail = jest.fn() as jest.Mock<any>;
const mockClaimKey = jest.fn() as jest.Mock<any>;
const mockSendEmail = jest.fn() as jest.Mock<any>;
const mockLimitCheck = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/supabase', () => ({
    supabase: {},
    supabaseAdmin: { auth: { admin: { updateUserById: (...a: any[]) => mockUpdateUserById(...a) } } },
}));
jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        updateUser: (...a: any[]) => mockFirebaseUpdate(...a),
        getUserByEmail: (...a: any[]) => mockGetUserByEmail(...a),
    },
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...a: any[]) => mockClaimKey(...a),
    claimPaymentOnce: jest.fn(), creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: (...a: any[]) => mockLimitCheck(...a) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));
jest.mock('resend', () => ({
    Resend: class { emails = { send: (...a: any[]) => mockSendEmail(...a) }; },
}));

/** A live, unused reset token for EMAIL, and the user profile behind it. */
function setWorld(opts: { expired?: boolean; tokenFound?: boolean; profileFound?: boolean } = {}) {
    const expiry = opts.expired ? Date.now() - 1000 : Date.now() + 3_600_000;
    const tokenFound = opts.tokenFound ?? true;
    const profileFound = opts.profileFound ?? true;

    (global as any).mockFirestoreGet.mockImplementation((collection: string) => {
        if (collection === 'password_resets') {
            return Promise.resolve({
                exists: false, empty: !tokenFound,
                docs: tokenFound
                    ? [{ id: 'reset-1', ref: { id: 'reset-1' }, data: () => ({ email: EMAIL, expiry, used: false }) }]
                    : [],
                data: () => ({}),
            });
        }
        if (collection === 'users') {
            return Promise.resolve({
                exists: false, empty: !profileFound,
                docs: profileFound
                    ? [{ id: SUPABASE_ID, data: () => ({ email: EMAIL, supabaseAuthId: SUPABASE_ID }) }]
                    : [],
                data: () => ({}),
            });
        }
        return Promise.resolve({ exists: false, empty: true, docs: [], data: () => ({}) });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

async function reset(password = GOOD_PASSWORD, token = TOKEN) {
    const { resetPasswordAction } = await import('@/app/actions/password-reset');
    return resetPasswordAction({ success: true, error: null } as any,
        form({ token, password, confirmPassword: password }));
}

describe('resetPasswordAction — the new password reaches the store that authenticates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockClaimKey.mockResolvedValue({ claimed: true });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
        mockGetUserByEmail.mockResolvedValue({ uid: 'fb-uid-1' });
        mockLimitCheck.mockResolvedValue({ success: true });
    });

    it('writes the new password to Supabase, not only to Firebase', async () => {
        // THE test. Supabase is what lib/auth.ts checks first; a reset that
        // misses it leaves the old password working.
        const r: any = await reset();

        expect(r.success).toBe(true);
        expect(mockUpdateUserById).toHaveBeenCalledWith(
            SUPABASE_ID, expect.objectContaining({ password: GOOD_PASSWORD })
        );
    });

    it('updates the legacy store too, so the fallback stops accepting the old one', async () => {
        await reset();

        expect(mockFirebaseUpdate).toHaveBeenCalledWith(
            'fb-uid-1', expect.objectContaining({ password: GOOD_PASSWORD })
        );
    });

    it('reports failure when the primary store cannot be written', async () => {
        mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'nope' } });

        const r: any = await reset();

        expect(r.success).toBe(false);
    });

    it('still succeeds when only the legacy update fails', async () => {
        // Accounts created after the migration have no Firebase record at all.
        mockFirebaseUpdate.mockRejectedValue(new Error('no such user'));

        const r: any = await reset();

        expect(r.success).toBe(true);
    });

    it('resolves the account from the profile, not from Firebase', async () => {
        // getUserByEmail is Firebase's. An account it does not know about could
        // not reset its password at all.
        mockGetUserByEmail.mockRejectedValue(new Error('user not found'));

        const r: any = await reset();

        expect(r.success).toBe(true);
        expect(mockUpdateUserById).toHaveBeenCalledWith(SUPABASE_ID, expect.anything());
    });
});

describe('resetPasswordAction — the token is spent before the password changes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockClaimKey.mockResolvedValue({ claimed: true });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
        mockGetUserByEmail.mockResolvedValue({ uid: 'fb-uid-1' });
    });

    it('claims the token before touching any password', async () => {
        // It used to be marked used at the very end. A failure in between left
        // a working reset link in the database.
        await reset();

        expect(mockClaimKey).toHaveBeenCalled();
        expect(mockClaimKey.mock.invocationCallOrder[0])
            .toBeLessThan(mockUpdateUserById.mock.invocationCallOrder[0]);
    });

    it('refuses when the token was already claimed', async () => {
        mockClaimKey.mockResolvedValue({ claimed: false });

        const r: any = await reset();

        expect(r.success).toBe(false);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });

    it('refuses an expired token', async () => {
        setWorld({ expired: true });

        const r: any = await reset();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/expired/i);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });

    it('refuses an unknown token', async () => {
        setWorld({ tokenFound: false });

        const r: any = await reset();

        expect(r.success).toBe(false);
        expect(mockUpdateUserById).not.toHaveBeenCalled();
    });
});

describe('resetPasswordAction — the same policy as everywhere else', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockClaimKey.mockResolvedValue({ claimed: true });
        mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
        mockFirebaseUpdate.mockResolvedValue({});
        mockGetUserByEmail.mockResolvedValue({ uid: 'fb-uid-1' });
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
            const r: any = await reset(password);

            expect(r.success).toBe(false);
            expect(mockUpdateUserById).not.toHaveBeenCalled();
        });
    }

    it('accepts a password that meets the policy', async () => {
        // Vacuity guard for the five above.
        const r: any = await reset('An0ther$trongOne');

        expect(r.success).toBe(true);
    });
});

describe('sendResetEmailAction — somebody else\'s inbox is not a megaphone', () => {
    /**
     * #393. The key has to be set for these to exercise a send at all.
     *
     * This action used to construct its own Resend client and call it whatever
     * the environment held; it now routes through sendEmailNotification, which
     * refuses and logs when RESEND_API_KEY is absent — the #217 repair, where a
     * missing key had been silent in production. So without this line the send
     * is refused before the mocked client is reached, and "still sends a
     * genuine reset email" fails for a reason that has nothing to do with the
     * behaviour it names.
     */
    const KEY = process.env.RESEND_API_KEY;
    beforeAll(() => { process.env.RESEND_API_KEY = 'test-key'; });
    afterAll(() => {
        if (KEY === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = KEY;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
        mockGetUserByEmail.mockResolvedValue({ uid: 'fb-uid-1' });
        mockSendEmail.mockResolvedValue({ data: {}, error: null });
        mockLimitCheck.mockResolvedValue({ success: true });
    });

    it('#393 reports failure rather than success when the mail provider is not configured', async () => {
        // The behaviour the beforeAll above works around, asserted rather than
        // only worked around. sendEmailNotification refuses outright with no
        // key (#217), and the caller must surface that — a reset that reports
        // success while sending nothing leaves somebody waiting for an email
        // that will never come.
        delete process.env.RESEND_API_KEY;
        try {
            const r: any = await send();
            expect(r.success).toBe(false);
            expect(mockSendEmail).not.toHaveBeenCalled();
        } finally {
            process.env.RESEND_API_KEY = 'test-key';
        }
    });

    async function send(email = EMAIL) {
        const { sendResetEmailAction } = await import('@/app/actions/password-reset');
        return sendResetEmailAction({ success: true, error: null } as any, form({ email }));
    }

    it('sends nothing once the address is over its limit', async () => {
        mockLimitCheck.mockResolvedValue({ success: false });

        const r: any = await send();

        expect(mockSendEmail).not.toHaveBeenCalled();
        // Reported as success, exactly like an unknown address, so the limit
        // does not reveal which emails are registered.
        expect(r.success).toBe(true);
    });

    it('keys the limit on the address, not on the anonymous caller', async () => {
        await send();

        expect(mockLimitCheck).toHaveBeenCalledWith(expect.stringContaining(EMAIL));
    });

    it('still sends a genuine reset email', async () => {
        // Vacuity guard: a limiter that refused everything would silently end
        // password recovery for the whole platform.
        const r: any = await send();

        expect(r.success).toBe(true);
        expect(mockSendEmail).toHaveBeenCalled();
    });

    it('still says nothing about whether an address is registered', async () => {
        // Pre-existing and correct.
        mockGetUserByEmail.mockRejectedValue(new Error('user not found'));

        const r: any = await send('nobody@example.com');

        expect(r.success).toBe(true);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });
});
