/**
 * @jest-environment node
 */

/**
 *   #243 THE BANK-ACCOUNT ORACLE HAD NO METER, AND ITS LOGS KEPT THE ANSWERS.
 *
 *        verifyBankAccount (actions/paystack.ts) resolves ANY 10-digit NUBAN
 *        to the account holder's real name through the platform's Paystack
 *        key. Two faults:
 *
 *        NO RATE LIMIT. Nothing bounded how often a signed-in caller could
 *        ask, so any account on the platform was a name-lookup service over
 *        the bank system. Ownership cannot be checked before resolving —
 *        verifying your own account before a withdrawal is the feature — so
 *        the limit IS the control: ten an hour per account absorbs mistyped
 *        digits and a wrong bank picked twice, and is useless for
 *        enumeration. Its own config bucket (`bankVerification`), because #76
 *        is what happens when two operations share a name.
 *
 *        PII IN THE LOGS. Four log lines wrote the full account number, and
 *        the success line paired it with the RESOLVED HOLDER'S NAME — exactly
 *        the pair the #151 sweep took out of the admin screens, written to a
 *        log aggregator instead, which is a wider audience than any admin
 *        list. Numbers are masked to the last four now and the name is not
 *        logged at all.
 *
 *        This file also executes the input validation and the Paystack error
 *        mapping for the first time — the whole file was at 0%.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const check = jest.fn(async (_key: string) => ({ success: true, remaining: 9 }));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: (config: { name?: string }) => ({
        check: (key: string) => check(`${config?.name ?? 'unnamed'}:${key}`),
    }),
    getActionClientIp: async () => '127.0.0.1',
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const logLines: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
    logger: {
        info: (...args: unknown[]) => logLines.push({ level: 'info', args }),
        warn: (...args: unknown[]) => logLines.push({ level: 'warn', args }),
        error: (...args: unknown[]) => logLines.push({ level: 'error', args }),
    },
}));

const CALLER = 'member-1';
const NUBAN = '0123456789';
const HOLDER = 'ADAEZE OBIANUJU OKAFOR';

const actions = async () => await import('@/app/actions/paystack');

const paystackResolves = (ok = true) => {
    (global as any).fetch = jest.fn(async () => ({
        ok,
        status: ok ? 200 : 422,
        json: async () => (ok
            ? { status: true, message: 'Account number resolved', data: { account_number: NUBAN, account_name: HOLDER, bank_id: 1 } }
            : { status: false, message: 'Could not resolve account name. Check parameters or try again.' }),
    }));
};

const loggedText = () => JSON.stringify(logLines);

beforeEach(() => {
    jest.clearAllMocks();
    logLines.length = 0;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
    check.mockImplementation(async () => ({ success: true, remaining: 9 }));
    mockRequireSession.mockResolvedValue({
        session: { user: { id: CALLER, email: 'ada@example.com', roles: ['general_user'] } },
        error: null,
    });
    paystackResolves();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#243 — the oracle is metered', () => {
    it('CONSULTS ITS OWN RATE-LIMIT BUCKET, KEYED ON THE ACCOUNT', async () => {
        const { verifyBankAccount } = await actions();
        await verifyBankAccount(NUBAN, '058');

        // Was: no limiter call at all.
        expect(check).toHaveBeenCalledWith(`bankVerification:${CALLER}`);
    });

    it('REFUSES WHEN THE BUCKET IS SPENT, BEFORE TOUCHING PAYSTACK', async () => {
        check.mockImplementation(async () => ({ success: false, remaining: 0 }));

        const { verifyBankAccount } = await actions();
        const res = await verifyBankAccount(NUBAN, '058') as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/too many/i);
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('still resolves a real account for a caller within the limit', async () => {
        const { verifyBankAccount } = await actions();
        const res = await verifyBankAccount(NUBAN, '058') as any;

        expect(res.success).toBe(true);
        expect(res.data.accountName).toBe(HOLDER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#243 — the logs no longer keep the answers', () => {
    it('NEVER LOGS THE RESOLVED HOLDER NAME', async () => {
        const { verifyBankAccount } = await actions();
        await verifyBankAccount(NUBAN, '058');

        // Was: logger.info('verifyBankAccount: Success', { accountNumber, accountName }).
        expect(loggedText()).not.toContain(HOLDER);
    });

    it('NEVER LOGS THE FULL ACCOUNT NUMBER — masked to the last four', async () => {
        const { verifyBankAccount } = await actions();
        await verifyBankAccount(NUBAN, '058');

        expect(loggedText()).not.toContain(NUBAN);
        expect(loggedText()).toContain('******6789');
    });

    it('a failed resolution logs the masked number too', async () => {
        paystackResolves(false);

        const { verifyBankAccount } = await actions();
        const res = await verifyBankAccount(NUBAN, '058') as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/account not found/i);
        expect(loggedText()).not.toContain(NUBAN);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the validation and error mapping, executed for the first time', () => {
    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'Unauthorized' } });

        const { verifyBankAccount } = await actions();
        expect(await verifyBankAccount(NUBAN, '058')).toMatchObject({ success: false });
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it.each(['123', '12345678901', 'abcdefghij', ''])(
        'refuses the malformed account number %s before any network call', async (bad) => {
            const { verifyBankAccount } = await actions();
            expect(await verifyBankAccount(bad, '058')).toMatchObject({ success: false });
            expect((global as any).fetch).not.toHaveBeenCalled();
        });

    it('refuses a malformed bank code the same way', async () => {
        const { verifyBankAccount } = await actions();
        expect(await verifyBankAccount(NUBAN, '58; DROP TABLE')).toMatchObject({ success: false });
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('reports a missing Paystack key as a configuration error', async () => {
        delete process.env.PAYSTACK_SECRET_KEY;

        const { verifyBankAccount } = await actions();
        const res = await verifyBankAccount(NUBAN, '058') as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/not configured/i);
    });

    it('maps a Paystack 429 to a wait message', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: false, status: 429,
            json: async () => ({ status: false, message: 'Too many requests' }),
        }));

        const { verifyBankAccount } = await actions();
        const res = await verifyBankAccount(NUBAN, '058') as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/too many verification attempts/i);
    });

    it('getBankList requires a session and returns the banks', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ status: true, message: 'ok', data: [{ id: 1, name: 'GTBank', code: '058', slug: 'gtbank' }] }),
        }));

        const { getBankList } = await actions();
        const res = await getBankList() as any;

        expect(res.success).toBe(true);
        expect(res.data.banks).toHaveLength(1);
    });
});
