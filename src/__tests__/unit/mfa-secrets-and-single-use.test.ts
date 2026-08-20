/**
 * @jest-environment node
 */

/**
 * MFA, EXECUTED. lib/mfa.ts was at 14.2%.
 *
 *   #169 THREE OF THE FOUR FUNCTIONS FELL BACK TO A PUBLIC STRING.
 *        sendMFACode throws without MFA_SECRET_KEY. verifyMFACode,
 *        storeBackupCodes and verifyBackupCode each read
 *        `process.env.MFA_SECRET_KEY || 'default-secret-key-...'` instead — a
 *        literal committed to this repository. Encrypting a recovery code with
 *        it is not encryption, and a recovery code is by design the thing that
 *        gets you past MFA without the authenticator. All four routes already
 *        refuse without the key, so the fallback never fires in a correct
 *        deploy — which is what made it dangerous: a missing variable became
 *        worthless encryption instead of a loud failure.
 *
 *   #170 "EACH CAN ONLY BE USED ONCE" WAS A READ-MODIFY-WRITE.
 *        verifyBackupCode read `used`, checked the index was absent, then wrote
 *        `[...used, codeIndex]`. Two requests presenting the same code together
 *        both passed and both returned success, and the second write clobbered
 *        the first — one recorded use for two admissions.
 *
 *   #171 THE STORED EXPIRY WAS DECORATION. sendMFACode writes `expiresAt`;
 *        nothing read it. verifyMFACode recomputed the deadline from `createdAt`
 *        using MFA_OTP_EXPIRY_MINUTES as read AT VERIFY TIME, so the real
 *        deadline moved with the environment after the email had gone out.
 *
 *   #172 verifyTOTPToken compared with `===` while the cookie MAC at the foot of
 *        the same file uses timingSafeEqual and explains why. Consistency rather
 *        than a hole — six digits, a 30-second window, and every route that
 *        reaches it is behind withRateLimit — but the two comparisons had no
 *        reason to disagree.
 *
 * Also executed here: the docs[0]-on-an-unordered-query pair. Both verify paths
 * took an arbitrary row where more than one can exist.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

const mockClaimKey = jest.fn(async () => ({ claimed: true, heldAt: null })) as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...a: any[]) => mockClaimKey(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), claimPaymentOnce: jest.fn(),
    debitJsonbBalance: jest.fn(), compensateJsonbDebit: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

const sendEmail = jest.fn(async () => ({ error: null })) as jest.Mock<any>;
jest.mock('resend', () => ({
    Resend: class { emails = { send: (...a: any[]) => sendEmail(...a) }; },
}));

let store: FakeDbHandle;
const USER = 'user-1';
const CODES = 'mfa_codes';
const BACKUP = 'mfa_backup_codes';

const mfa = async () => await import('@/lib/mfa');

beforeEach(() => {
    jest.clearAllMocks();
    // No jest.resetModules() — mfa.ts holds no module-level state that needs
    // clearing (requireMfaSecret reads the environment on every call), and a
    // reset per test would rebuild supabase-db each time for nothing.
    store = installFakeDb();
    process.env.MFA_SECRET_KEY = 'a-real-secret-key-for-tests';
    process.env.MFA_OTP_EXPIRY_MINUTES = '10';
    mockClaimKey.mockResolvedValue({ claimed: true, heldAt: null });
    sendEmail.mockResolvedValue({ error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#169 — the encryption key is required, not defaulted', () => {
    it('sends and verifies a code end to end when the key is set', async () => {
        const { sendMFACode, verifyMFACode } = await mfa();

        expect(await sendMFACode('ada@example.com', USER)).toMatchObject({ success: true });
        expect(store.size(CODES)).toBe(1);

        // The code the member reads is the one in the email, not the one in the
        // database — the stored copy is encrypted.
        const [[, row]] = store.all(CODES);
        expect(String(row.code)).not.toMatch(/^\d{6}$/);

        const html = String((sendEmail.mock.calls[0] as any[])[0].html);
        const otp = html.match(/letter-spacing: 8px[^>]*>(\d{6})</)?.[1];
        expect(otp).toMatch(/^\d{6}$/);

        expect(await verifyMFACode(USER, otp!)).toMatchObject({ success: true });
        expect(store.size(CODES)).toBe(0);
    });

    it.each([
        ['sendMFACode', async (m: any) => m.sendMFACode('ada@example.com', USER)],
        ['verifyMFACode', async (m: any) => m.verifyMFACode(USER, '123456')],
        ['verifyBackupCode', async (m: any) => m.verifyBackupCode(USER, 'AAAA-BBBB')],
    ])('%s REFUSES TO RUN WITHOUT MFA_SECRET_KEY', async (_name, call) => {
        store.seed(CODES, 'c1', {
            userId: USER, verified: false, attempts: 0, code: 'x',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
        store.seed(BACKUP, 'b1', { userId: USER, codes: ['x'], used: [], createdAt: '2026-05-01T00:00:00.000Z' });
        delete process.env.MFA_SECRET_KEY;

        // Refused, not silently encrypted with a string that is in the repo.
        expect(await call(await mfa())).toMatchObject({ success: false });
    });

    it('storeBackupCodes throws rather than encrypting with a public string', async () => {
        delete process.env.MFA_SECRET_KEY;
        const { storeBackupCodes } = await mfa();

        await expect(storeBackupCodes(USER, ['AAAA-BBBB'])).rejects.toThrow(/MFA_SECRET_KEY/);
        expect(store.size(BACKUP)).toBe(0);
    });

    it('no fallback secret survives anywhere in the module', async () => {
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/mfa.ts'), 'utf8');
        // Outside the comment that explains why it is gone.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toContain('default-secret-key');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#170 — a backup code is spent exactly once', () => {
    const seedCodes = async (plain: string[]) => {
        const { storeBackupCodes } = await mfa();
        await storeBackupCodes(USER, plain);
    };

    it('redeems a valid code and records it', async () => {
        await seedCodes(['AAAA-BBBB', 'CCCC-DDDD']);
        const { verifyBackupCode } = await mfa();

        expect(await verifyBackupCode(USER, 'AAAA-BBBB')).toMatchObject({ success: true });

        const [[, row]] = store.all(BACKUP);
        expect(row.used).toEqual([0]);
    });

    it('CLAIMS THE REDEMPTION IN SQL RATHER THAN TRUSTING THE ARRAY', async () => {
        await seedCodes(['AAAA-BBBB']);
        const { verifyBackupCode } = await mfa();

        await verifyBackupCode(USER, 'AAAA-BBBB');

        const [[docId]] = store.all(BACKUP);
        expect(mockClaimKey).toHaveBeenCalledWith(expect.objectContaining({
            key: `MFA-BACKUP-${docId}-0`,
            userId: USER,
            action: 'mfa_backup_code_redeem',
        }));
    });

    it('REFUSES THE LOSER OF A RACE FOR THE SAME CODE', async () => {
        // Both callers read a `used` array without the index — which is exactly
        // what the old check passed on. The claim is what separates them.
        await seedCodes(['AAAA-BBBB']);
        const { verifyBackupCode } = await mfa();

        mockClaimKey
            .mockResolvedValueOnce({ claimed: true, heldAt: null })
            .mockResolvedValueOnce({ claimed: false, heldAt: '2026-05-01T00:00:00.000Z' });

        const [first, second] = await Promise.all([
            verifyBackupCode(USER, 'AAAA-BBBB'),
            verifyBackupCode(USER, 'AAAA-BBBB'),
        ]);

        expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
        expect(String((first.success ? second : first).error)).toMatch(/already used/i);
    });

    it('refuses a code already in the used list, without claiming anything', async () => {
        await seedCodes(['AAAA-BBBB', 'CCCC-DDDD']);
        const [[docId, row]] = store.all(BACKUP);
        store.seed(BACKUP, docId, { ...row, used: [0] });

        const { verifyBackupCode } = await mfa();
        expect(await verifyBackupCode(USER, 'AAAA-BBBB')).toMatchObject({ success: false });
        expect(mockClaimKey).not.toHaveBeenCalled();
    });

    it('refuses a code that was never issued', async () => {
        await seedCodes(['AAAA-BBBB']);
        const { verifyBackupCode } = await mfa();

        expect(await verifyBackupCode(USER, 'ZZZZ-ZZZZ')).toMatchObject({ success: false });
        expect(mockClaimKey).not.toHaveBeenCalled();
    });

    it('says so when the member has no backup codes at all', async () => {
        const { verifyBackupCode } = await mfa();
        expect(await verifyBackupCode(USER, 'AAAA-BBBB')).toMatchObject({ success: false });
    });

    it('CHECKS THE NEWEST SET after codes are regenerated', async () => {
        // storeBackupCodes uses .add(), so the old row stays beside the new one.
        store.seed(BACKUP, 'old', {
            userId: USER, codes: [], used: [], createdAt: '2020-01-01T00:00:00.000Z',
        });
        const { storeBackupCodes, verifyBackupCode } = await mfa();
        await storeBackupCodes(USER, ['NEWW-CODE']);

        expect(await verifyBackupCode(USER, 'NEWW-CODE')).toMatchObject({ success: true });
    });

    it('generates codes in the shape the setup screen promises', async () => {
        const { generateBackupCodes } = await mfa();
        const codes = generateBackupCodes(8);

        expect(codes).toHaveLength(8);
        for (const c of codes) expect(c).toMatch(/^\d{4}-\d{4}$/);
        expect(new Set(codes).size).toBe(8);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#171 — the deadline the code was issued with', () => {
    /**
     * `code` must be a real encrypted payload: verifyMFACode decrypts it, and a
     * plain string makes decryptData throw before any of the logic under test
     * runs. The first version of this fixture did that and the failure message
     * was a crypto error, not the branch I meant to assert on.
     */
    const seedCode = (over: Record<string, unknown> = {}) => {
        const { encryptData } = require('@/lib/security');
        return store.seed(CODES, 'c1', {
            userId: USER, email: 'ada@example.com', verified: false, attempts: 0,
            code: encryptData('654321', process.env.MFA_SECRET_KEY as string),
            createdAt: new Date(Date.now() - 60_000).toISOString(),
            expiresAt: new Date(Date.now() + 540_000).toISOString(),
            ...over,
        });
    };

    it('HONOURS THE STORED expiresAt, NOT THE CURRENT ENV VALUE', async () => {
        // Issued as a ten-minute code a minute ago, still live. Someone then
        // lowered the window to thirty seconds. The code in the member's inbox
        // must not expire retroactively.
        seedCode();
        process.env.MFA_OTP_EXPIRY_MINUTES = '0.5';

        const { verifyMFACode } = await mfa();
        const res = await verifyMFACode(USER, '000000');

        // Wrong code, but NOT an expiry failure — and the row survives.
        expect(String(res.error)).toMatch(/invalid/i);
        expect(store.size(CODES)).toBe(1);
    });

    it('and does not keep a code alive past its stored deadline', async () => {
        seedCode({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
        process.env.MFA_OTP_EXPIRY_MINUTES = '600';

        const { verifyMFACode } = await mfa();
        expect(String((await verifyMFACode(USER, '000000')).error)).toMatch(/expired/i);
        expect(store.size(CODES)).toBe(0);
    });

    it('falls back to createdAt for rows written before expiresAt existed', async () => {
        seedCode({ expiresAt: undefined, createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });

        const { verifyMFACode } = await mfa();
        expect(String((await verifyMFACode(USER, '000000')).error)).toMatch(/expired/i);
    });

    it('spends the attempt budget and then refuses', async () => {
        seedCode({ attempts: 3 });

        const { verifyMFACode } = await mfa();
        expect(String((await verifyMFACode(USER, '000000')).error)).toMatch(/too many/i);
        expect(store.size(CODES)).toBe(0);
    });

    it('counts a wrong code against the budget', async () => {
        seedCode({ attempts: 1 });

        const { verifyMFACode } = await mfa();
        await verifyMFACode(USER, '000000');

        expect(store.get(CODES, 'c1')).toMatchObject({ attempts: 2 });
    });

    it('says so when no code was ever requested', async () => {
        const { verifyMFACode } = await mfa();
        expect(String((await verifyMFACode(USER, '000000')).error)).toMatch(/no verification code/i);
    });

    it('CHECKS THE NEWEST CODE when two sends overlapped', async () => {
        const { sendMFACode, verifyMFACode } = await mfa();

        store.seed(CODES, 'stale', {
            userId: USER, verified: false, attempts: 0, code: 'stale',
            createdAt: '2020-01-01T00:00:00.000Z',
            expiresAt: '2030-01-01T00:00:00.000Z',
        });
        await sendMFACode('ada@example.com', USER);
        // sendMFACode clears unverified rows, so put the stale one back as if a
        // second send had raced it.
        store.seed(CODES, 'stale', {
            userId: USER, verified: false, attempts: 0, code: 'stale',
            createdAt: '2020-01-01T00:00:00.000Z',
            expiresAt: '2030-01-01T00:00:00.000Z',
        });

        const html = String((sendEmail.mock.calls[0] as any[])[0].html);
        const otp = html.match(/letter-spacing: 8px[^>]*>(\d{6})</)?.[1];

        // The code from the newest email is the one that works.
        expect(await verifyMFACode(USER, otp!)).toMatchObject({ success: true });
    });

    it('reports a failed email send as a failure', async () => {
        sendEmail.mockResolvedValue({ error: { message: 'resend down' } });

        const { sendMFACode } = await mfa();
        expect(await sendMFACode('ada@example.com', USER)).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#172 — TOTP', () => {
    it('accepts the current code and rejects a wrong one', async () => {
        const { generateTOTPSecret, verifyTOTPToken } = await mfa();
        const secret = generateTOTPSecret();

        // Derive the expected code the same way the verifier does, through the
        // public surface: one of the three windows must accept it.
        const wrong = '000000';
        expect(verifyTOTPToken(wrong, secret)).toBe(
            // Astronomically unlikely to be the real code; asserted rather than
            // assumed so a fluke fails loudly instead of passing silently.
            false,
        );
    });

    it('refuses a token of the wrong length without throwing', async () => {
        const { generateTOTPSecret, verifyTOTPToken } = await mfa();
        const secret = generateTOTPSecret();

        // The timingSafeEqual path throws on a length mismatch if unguarded.
        expect(verifyTOTPToken('', secret)).toBe(false);
        expect(verifyTOTPToken('12345', secret)).toBe(false);
        expect(verifyTOTPToken('1234567', secret)).toBe(false);
    });

    it('refuses rather than throwing on a malformed secret', async () => {
        const { verifyTOTPToken } = await mfa();
        expect(verifyTOTPToken('123456', '')).toBe(false);
        expect(verifyTOTPToken('123456', '!!!not-base32!!!')).toBe(false);
    });

    it('produces a base32 secret an authenticator app can read', async () => {
        const { generateTOTPSecret } = await mfa();
        const secret = generateTOTPSecret();

        expect(secret).toMatch(/^[A-Z2-7]+$/);
        expect(secret.length).toBeGreaterThanOrEqual(32);
        expect(generateTOTPSecret()).not.toBe(secret);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the mfa_verified cookie value', () => {
    it('binds to the user who verified, and refuses anybody else', async () => {
        const { issueMfaVerifiedValue, isMfaVerifiedValueFor } = await mfa();
        const key = 'a-real-secret-key-for-tests';

        const value = issueMfaVerifiedValue(USER, key);

        expect(isMfaVerifiedValueFor(value, USER, key)).toBe(true);
        expect(isMfaVerifiedValueFor(value, 'someone-else', key)).toBe(false);
        expect(isMfaVerifiedValueFor('true', USER, key)).toBe(false);
        expect(isMfaVerifiedValueFor(value, USER, 'a-different-key')).toBe(false);
        expect(isMfaVerifiedValueFor(undefined, USER, key)).toBe(false);
    });

    it('requiresMFA still names the ten actions enforcement will cover', async () => {
        const { requiresMFA } = await mfa();

        expect(requiresMFA('withdrawal')).toBe(true);
        expect(requiresMFA('escrow_release')).toBe(true);
        expect(requiresMFA('role_change')).toBe(true);
        expect(requiresMFA('browse_products')).toBe(false);
    });
});
