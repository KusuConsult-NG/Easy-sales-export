/**
 * @jest-environment node
 */

/**
 * lib/paystack-transfer.ts was at 7.1%. It is the single helper every automated
 * bank payout on this platform goes through:
 *
 *     wallet.ts                     member wallet withdrawals
 *     admin/_withdrawals.ts         the combined admin withdrawal queue
 *     admin/_loans.ts               cooperative loan disbursement
 *     order-management.ts           marketplace escrow release
 *     wave/_wv_admin_withdrawals.ts WAVE commission withdrawals
 *
 * Three defects, and the first two compound into the same outcome: paying
 * somebody twice.
 *
 *   #249 EVERY PAYOUT WENT OUT WITH A RANDOM REFERENCE.
 *   #250 A NETWORK FAILURE WAS REPORTED AS "THE TRANSFER FAILED".
 *   #251 NOTHING CHECKED THE AMOUNT BEFORE SENDING IT.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const ACCOUNT = { accountNumber: '0123456789', bankCode: '058', accountName: 'A Member' };

let calls: Array<{ url: string; body: any }>;
let realFetch: typeof globalThis.fetch;

/** Queue of responses, consumed in order. A thrown value rejects. */
let queue: any[];

const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ status: true, data }) });
const refused = (message: string, status = 400) =>
    ({ ok: false, status, json: async () => ({ status: false, message }) });

beforeEach(() => {
    calls = [];
    queue = [];
    realFetch = globalThis.fetch;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';

    globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
        const next = queue.shift();
        if (next === undefined) throw new Error('no queued response');
        if (next instanceof Error) throw next;
        return next;
    }) as any;
});

afterEach(() => { globalThis.fetch = realFetch; });

const transfers = async () => await import('@/lib/paystack-transfer');

/** The two calls a successful payout makes. */
const happyPath = () => {
    queue.push(ok({ recipient_code: 'RCP_1' }));
    queue.push(ok({ transfer_code: 'TRF_1' }));
};

const transferBody = () => calls.find(c => c.url.endsWith('/transfer'))?.body;

// ─────────────────────────────────────────────────────────────────────────────
describe('#249 — the reference is the idempotency key', () => {
    /**
     *   #249 EVERY PAYOUT WENT OUT WITH A RANDOM REFERENCE.
     *
     *        paystackPayout called initiateTransfer without one, and
     *        initiateTransfer then invented:
     *
     *            `ESE-${Date.now()}-${Math.random()...}`
     *
     *        Paystack's `reference` is the idempotency key for a transfer: send
     *        the same one twice and the second is refused. A fresh random one
     *        every time means there is no idempotency at all, so the SAME
     *        withdrawal retried after an ambiguous failure is a SECOND transfer
     *        and the member is paid twice.
     *
     *        Every caller had a natural key to hand — the transaction id, the
     *        withdrawal id, the loan application id, the order id — and none of
     *        them could pass it, because the parameter was optional and unused.
     *        It is required now, so a new payout site cannot forget it.
     */
    it('SENDS THE CALLER\'S REFERENCE, NOT A RANDOM ONE', async () => {
        happyPath();
        const { paystackPayout } = await transfers();

        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(true);
        expect(transferBody().reference).toBe('WALLET-txn-1');
        expect(res.reference).toBe('WALLET-txn-1');
    });

    it('THE SAME WITHDRAWAL RETRIED SENDS THE SAME REFERENCE', async () => {
        // Was: two different ESE-<random> references, so Paystack saw two
        // unrelated transfers and honoured both.
        const { paystackPayout } = await transfers();

        happyPath();
        await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');
        const first = transferBody().reference;

        calls = [];
        happyPath();
        await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(transferBody().reference).toBe(first);
    });

    it('AND PAYSTACK REFUSING A DUPLICATE IS REPORTED AS A DUPLICATE, NOT A FAILURE', async () => {
        // The retry that matters: the first transfer really did go out, so this
        // refusal is proof the member HAS been paid. Reading it as "the payout
        // failed" is how a caller decides to try again.
        queue.push(ok({ recipient_code: 'RCP_1' }));
        queue.push(refused('Transfer reference must be unique'));

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(res.duplicate).toBe(true);
        expect(res.indeterminate).toBeFalsy();
    });

    it('refuses an empty reference rather than inventing one', async () => {
        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', '   ');

        expect(res.success).toBe(false);
        expect(calls).toHaveLength(0);   // no money left the building
    });

    it('builds a stable reference from a prefix and an entity id', async () => {
        const { payoutReference } = await transfers();

        expect(payoutReference('WALLET', 'txn-1')).toBe(payoutReference('WALLET', 'txn-1'));
        expect(payoutReference('WALLET', 'txn-1')).not.toBe(payoutReference('WALLET', 'txn-2'));
        expect(payoutReference('LOAN', 'txn-1')).not.toBe(payoutReference('WALLET', 'txn-1'));
        // Paystack accepts alphanumerics and -._= only.
        expect(payoutReference('ESCROW', 'ORD/2026 #7')).toMatch(/^[A-Za-z0-9\-._=]+$/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#250 — "it failed" versus "we do not know"', () => {
    /**
     *   #250 A NETWORK FAILURE WAS REPORTED AS "THE TRANSFER FAILED".
     *
     *        Every error path returned the same shape: { success: false, error }.
     *        A connection reset or a timeout means the request MAY have reached
     *        Paystack and been accepted — the money may already be gone — and
     *        the caller cannot tell that from a flat refusal.
     *
     *        wallet.ts acted on exactly that. On !success it reverted the
     *        withdrawal from `payout_initiated` back to `pending`, which is the
     *        state an admin approves from. So: transfer accepted, response lost,
     *        record reopened, admin clicks again, second transfer with a fresh
     *        random reference (#249). The member is paid twice and both ledger
     *        rows look correct.
     *
     *        A 5xx is the same story. A 4xx with a message is not — Paystack
     *        understood the request and refused it, and nothing was sent.
     */
    it('A CONNECTION FAILURE IS INDETERMINATE, NOT A REFUSAL', async () => {
        queue.push(ok({ recipient_code: 'RCP_1' }));
        queue.push(new Error('ECONNRESET: socket hang up'));

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(res.indeterminate).toBe(true);
    });

    it('A 5xx IS INDETERMINATE TOO — PAYSTACK MAY HAVE TAKEN IT', async () => {
        queue.push(ok({ recipient_code: 'RCP_1' }));
        queue.push({ ok: false, status: 503, json: async () => ({ status: false, message: 'Service unavailable' }) });

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.indeterminate).toBe(true);
    });

    it('a 4xx refusal is NOT indeterminate — nothing was sent', async () => {
        queue.push(ok({ recipient_code: 'RCP_1' }));
        queue.push(refused('Your balance is not enough to fulfil this request'));

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(res.indeterminate).toBeFalsy();
        expect(res.error).toMatch(/balance/i);
    });

    it('a failure creating the RECIPIENT is not indeterminate — no transfer was attempted', async () => {
        queue.push(refused('Invalid account number'));

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(res.indeterminate).toBeFalsy();
        expect(calls.some(c => c.url.endsWith('/transfer'))).toBe(false);
    });

    it('but a connection failure while creating the recipient stops the payout', async () => {
        queue.push(new Error('ETIMEDOUT'));

        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(calls.some(c => c.url.endsWith('/transfer'))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#251 — the amount, before it is sent', () => {
    /**
     *   #251 NOTHING CHECKED THE AMOUNT BEFORE SENDING IT.
     *
     *        The body was built as `Math.round(amountNaira * 100)` with no
     *        guard. NaN — which is what `Math.abs(undefined)` or a missing
     *        stored field produces — serialises to `null` in the JSON body; a
     *        negative amount serialises to a negative kobo figure; Infinity to
     *        null as well. Every one of those is a request to move money built
     *        from a value nobody looked at.
     *
     *        The callers cannot be relied on for this: the amount reaches here
     *        from five different stored documents.
     */
    it.each([
        ['NaN', NaN],
        ['negative', -5000],
        ['zero', 0],
        ['Infinity', Infinity],
        ['sub-kobo', 0.001],
    ])('REFUSES %s WITHOUT CALLING PAYSTACK', async (_label, amount) => {
        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, amount as number, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/amount/i);
        expect(calls).toHaveLength(0);
    });

    it('still converts a valid amount to kobo', async () => {
        happyPath();
        const { paystackPayout } = await transfers();
        await paystackPayout(ACCOUNT, 1234.56, 'Wallet withdrawal', 'WALLET-txn-1');

        expect(transferBody().amount).toBe(123456);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ordinary payout still works', () => {
    it('creates a recipient then transfers, and reports the transfer code', async () => {
        happyPath();
        const { paystackPayout } = await transfers();

        const res = await paystackPayout(ACCOUNT, 5000, 'Escrow release for order ORD-1', 'ESCROW-ORD-1');

        expect(res).toMatchObject({ success: true, transferCode: 'TRF_1', reference: 'ESCROW-ORD-1' });
        expect(calls[0].url).toMatch(/\/transferrecipient$/);
        expect(calls[0].body).toMatchObject({
            type: 'nuban', account_number: '0123456789', bank_code: '058', currency: 'NGN',
        });
        expect(calls[1].body).toMatchObject({ source: 'balance', recipient: 'RCP_1' });
    });

    it('falls back to a placeholder name when the account has none', async () => {
        happyPath();
        const { paystackPayout } = await transfers();
        await paystackPayout({ ...ACCOUNT, accountName: '' }, 5000, 'x', 'REF-1');

        expect(calls[0].body.name).toBe('Recipient');
    });

    it('refuses to run at all without a configured secret key', async () => {
        delete process.env.PAYSTACK_SECRET_KEY;
        const { paystackPayout } = await transfers();

        const res = await paystackPayout(ACCOUNT, 5000, 'x', 'REF-1');
        expect(res.success).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('resolveAccountNumber reports the account name, and an error for a bad one', async () => {
        const { resolveAccountNumber } = await transfers();

        queue.push(ok({ account_name: 'A MEMBER' }));
        expect(await resolveAccountNumber('0123456789', '058'))
            .toMatchObject({ success: true, accountName: 'A MEMBER' });

        queue.push(refused('Could not resolve account name'));
        expect(await resolveAccountNumber('0000000000', '058'))
            .toMatchObject({ success: false });
    });
});
