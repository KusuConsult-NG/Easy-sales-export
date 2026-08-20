/**
 * @jest-environment node
 */

/**
 * QoreID, EXECUTED. lib/qoreid.ts was at 0% — the identity verification
 * integration had never run a single line under test.
 *
 * This is the module that decides whether somebody's BVN, NIN, passport,
 * driver's licence, voter's card, CAC number or TIN matches the name they gave.
 * Its answer becomes `bvnVerified`, `ninVerified`, `cacVerified` and
 * `tinVerified` on the user document, which gate module access and appear as
 * verified badges on the admin screens.
 *
 *   #165 verifyTIN did the one thing this file twice says not to do. It read
 *        `status.state` and accepted "complete" — the value the file's own
 *        header describes as meaning "the request finished processing, NOT that
 *        the identity matched" — and never looked at `status.status`, which is
 *        where the mismatch is reported. A TIN lookup returning
 *        {state: "complete", status: "id_mismatch"} was a match. It was the only
 *        method that did not go through resolveMatch.
 *
 *   #166 resolveMatch hard-failed on four spellings of failure and let every
 *        other top-level status fall through to the positive checks. An
 *        unrecognised status — a partial-match spelling, a new value, a value
 *        from a different account plan — could come back verified. It also
 *        accepted "complete" as a positive INNER check while excluding it from
 *        the top-level list for exactly the documented reason; the two lists
 *        disagreed about the same token.
 *
 *   #167 Every identity number was written to the application log in plaintext.
 *        QoreID takes the number as a URL path segment, and this module logged
 *        the full URL on every lookup at info level, together with the request
 *        body, which carries the person's first and last name. The same numbers
 *        are SHA-256 hashed before they are allowed near the database
 *        (kyc.ts, _mp_seller_verification.ts, the WAVE application all call
 *        hashData) precisely so the raw value is never stored.
 *
 *   #168 The auth failure message named the platform's env vars and hosting
 *        provider — "Check QOREID_CLIENT_ID and QOREID_SECRET_KEY in Vercel env
 *        vars" — and api/kyc/verify-business returns a failed result whole, so
 *        that string reached the browser of anyone who could make a
 *        verification fail.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { resolveMatch } from '@/lib/qoreid';

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
    logger: {
        info: (...args: unknown[]) => { (global as any).__qoreLog.push({ level: 'info', args }); },
        warn: (...args: unknown[]) => { (global as any).__qoreLog.push({ level: 'warn', args }); },
        error: (...args: unknown[]) => { (global as any).__qoreLog.push({ level: 'error', args }); },
        debug: () => undefined,
    },
}));

(global as any).__qoreLog = logged;

const BVN = '22233344455';
const NIN = '11122233344';

const realFetch = global.fetch;
let fetchMock: jest.Mock<any>;

/** Every call the module makes, in order, as {url, body}. */
const calls = (): Array<{ url: string; body: any }> =>
    fetchMock.mock.calls.map(([url, init]: any) => ({
        url: String(url),
        body: init?.body ? JSON.parse(init.body) : null,
    }));

/** Everything written to the log, flattened to one searchable string. */
const logText = (): string =>
    logged.map((l) => `${l.level} ${l.args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`).join('\n');

function respond(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        json: async () => body,
    };
}

/** The token call, then one identity response. */
function arm(identityStatus: number, identityBody: unknown) {
    fetchMock
        .mockResolvedValueOnce(respond(200, { accessToken: 'tok_123', expiresIn: 3600 }) as never)
        .mockResolvedValueOnce(respond(identityStatus, identityBody) as never);
}

beforeEach(() => {
    logged.length = 0;
    jest.resetModules();
    process.env.QOREID_CLIENT_ID = 'client-id';
    process.env.QOREID_SECRET_KEY = 'secret-key';
    fetchMock = jest.fn() as jest.Mock<any>;
    (global as any).fetch = fetchMock;
});

afterEach(() => {
    (global as any).fetch = realFetch;
});

/** A fresh module instance, because the service caches its auth token. */
const service = async () => (await import('@/lib/qoreid')).qoreIdService;

// ─────────────────────────────────────────────────────────────────────────────
describe('#166 — resolveMatch decides who is verified', () => {
    it('accepts the documented success shape', () => {
        expect(resolveMatch({
            status: { status: 'id_verified', state: 'complete' },
            summary: { bvn_check: { status: 'EXACT_MATCH' } },
        })).toBe(true);
    });

    it('rejects an explicit mismatch even when the request completed', () => {
        expect(resolveMatch({
            status: { status: 'id_mismatch', state: 'complete' },
            summary: { bvn_check: { status: 'NO_MATCH' } },
        })).toBe(false);
    });

    // ── the denylist ────────────────────────────────────────────────────────
    it.each([
        'id_partial_match',
        'partial_match',
        'pending_review',
        'something_qoreid_added_last_tuesday',
    ])('REFUSES THE UNRECOGNISED TOP-LEVEL STATUS %s', (topStatus) => {
        /**
         * The inner check here is EXACT_MATCH, deliberately, and the first
         * version of this test used "complete" instead — which made it useless.
         *
         * Two defects were fixed in resolveMatch: the top-level denylist, and
         * "complete" being accepted as a positive inner check. With a "complete"
         * inner check, EITHER fix alone makes this return false, so restoring
         * the denylist on its own broke nothing and the mutation passed. Each
         * fix was masking the other.
         *
         * EXACT_MATCH isolates the denylist: the inner check is genuinely
         * positive, so the ONLY thing that can refuse this lookup is the
         * top-level status being required to say id_verified. QoreID saying "the
         * name matches the record" while its overall verdict is something other
         * than id_verified is precisely the case that must not read as verified.
         */
        expect(resolveMatch({
            status: { status: topStatus, state: 'complete' },
            summary: { bvn_check: { status: 'EXACT_MATCH' } },
        })).toBe(false);
    });

    it('DOES NOT TREAT AN INNER "complete" AS A MATCH', () => {
        // "complete" means the request finished processing. This file says so
        // twice, and excluded it from the top-level list for that reason — while
        // the inner list accepted it.
        expect(resolveMatch({
            status: {},
            summary: { bvn_check: { status: 'complete' } },
        })).toBe(false);
    });

    it('a single NO_MATCH sinks the whole lookup', () => {
        expect(resolveMatch({
            status: { status: 'id_verified' },
            summary: {
                bvn_check: { status: 'EXACT_MATCH' },
                name_check: { status: 'NO_MATCH' },
            },
        })).toBe(false);
    });

    it('keeps the legacy path for accounts that return no status.status', () => {
        // Absent, not unrecognised — these accounts never send the field, and
        // tightening the unknown case must not lock them out.
        expect(resolveMatch({ status: { state: 'EXACT_MATCH' } })).toBe(true);
        expect(resolveMatch({ status: { state: 'verified' } })).toBe(true);
    });

    it('but "complete" alone is still not enough on the legacy path either', () => {
        expect(resolveMatch({ status: { state: 'complete' } })).toBe(false);
    });

    it('fails closed on an empty or malformed payload', () => {
        expect(resolveMatch({})).toBe(false);
        expect(resolveMatch(null)).toBe(false);
        expect(resolveMatch(undefined)).toBe(false);
        expect(resolveMatch({ summary: {} })).toBe(false);
    });

    it('normalises the UPPERCASE values production actually returns', () => {
        expect(resolveMatch({
            status: { status: 'ID_VERIFIED' },
            summary: { nin_check: { status: 'EXACT_MATCH' } },
        })).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#165 — verifyTIN', () => {
    it('REPORTS A MISMATCHED TIN AS A MISMATCH', async () => {
        // The exact payload the old implementation passed: state "complete"
        // with an explicit id_mismatch beside it.
        arm(200, { status: { state: 'complete', status: 'id_mismatch' } });

        const res = await (await service()).verifyTIN('12345678-0001') as any;

        expect(res.success).toBe(true);
        expect(res.isMatch).toBe(false);
    });

    it('still confirms a TIN that genuinely resolved', async () => {
        arm(200, {
            status: { state: 'complete', status: 'id_verified' },
            summary: { tin_check: { status: 'EXACT_MATCH' } },
        });

        expect(await (await service()).verifyTIN('12345678-0001')).toMatchObject({
            success: true, isMatch: true,
        });
    });

    it('uses the same resolver as every sibling', async () => {
        // An unknown top-level status must sink a TIN exactly as it sinks a BVN.
        arm(200, { status: { state: 'complete', status: 'pending_review' } });

        expect(await (await service()).verifyTIN('12345678-0001')).toMatchObject({ isMatch: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#167 — what reaches the log', () => {
    it('NEVER WRITES THE BVN, AND NEVER THE NAME', async () => {
        arm(200, {
            status: { status: 'id_verified' },
            summary: { bvn_check: { status: 'EXACT_MATCH' } },
        });

        await (await service()).verifyBVN(BVN, 'Ada', 'Obi');

        const text = logText();
        expect(text).not.toContain(BVN);
        expect(text).not.toContain('Ada');
        expect(text).not.toContain('Obi');
        // The endpoint survives — knowing WHICH lookup ran is the diagnostic value.
        expect(text).toContain('bvn-basic');
        expect(text).toContain('[redacted]');
    });

    it('nor the NIN, on any outcome', async () => {
        arm(200, { status: { status: 'id_mismatch' } });

        await (await service()).verifyNIN(NIN, 'Ada', 'Obi');

        expect(logText()).not.toContain(NIN);
    });

    it('DOES NOT DUMP THE PROVIDER RESPONSE ON AN ERROR', async () => {
        // The raw body carries date of birth, address, gender and a photo URL.
        arm(422, {
            message: 'Invalid identity number',
            dateOfBirth: '1990-04-01',
            residentialAddress: '9 Farm Lane, Enugu',
        });

        await (await service()).verifyNIN(NIN, 'Ada', 'Obi');

        const text = logText();
        expect(text).not.toContain('1990-04-01');
        expect(text).not.toContain('9 Farm Lane');
        expect(text).not.toContain(NIN);
        // The message is what tells you what went wrong.
        expect(text).toContain('Invalid identity number');
    });

    it('still sends the real number to QoreID — redaction is for the log only', async () => {
        arm(200, { status: { status: 'id_verified' }, summary: { c: { status: 'EXACT_MATCH' } } });

        await (await service()).verifyBVN(BVN, 'Ada', 'Obi');

        const identityCall = calls()[1];
        expect(identityCall.url).toContain(BVN);
        expect(identityCall.body).toMatchObject({ firstname: 'Ada', lastname: 'Obi' });
    });

    it.each([
        ['verifyDrivingLicense', 'ABC12345678', 'drivers-license'],
        ['verifyVotersCard', 'VIN90210', 'voters-card'],
        ['verifyPassport', 'A01234567', 'passport'],
    ])('%s keeps its number out of the log too', async (method, number, endpoint) => {
        arm(200, { status: { status: 'id_verified' }, summary: { c: { status: 'EXACT_MATCH' } } });

        await ((await service()) as any)[method](number, 'Ada', 'Obi');

        expect(logText()).not.toContain(number);
        expect(logText()).toContain(endpoint);
        expect(calls()[1].url).toContain(number);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#168 — what reaches the caller', () => {
    it('DOES NOT NAME THE ENV VARS OR THE HOST IN THE ERROR', async () => {
        // api/kyc/verify-business returns a failed result whole, so this string
        // lands in the browser.
        fetchMock.mockResolvedValueOnce(respond(500, { message: 'upstream boom' }) as never);

        const res = await (await service()).verifyBVN(BVN, 'Ada', 'Obi') as any;

        expect(res.success).toBe(false);
        expect(res.error).not.toMatch(/QOREID_CLIENT_ID|QOREID_SECRET_KEY|Vercel/i);
        expect(res.error).toMatch(/unavailable/i);
    });

    it('keeps the diagnosis in the log, where an operator can read it', async () => {
        fetchMock.mockResolvedValueOnce(respond(500, { message: 'upstream boom' }) as never);

        await (await service()).verifyBVN(BVN, 'Ada', 'Obi');

        expect(logText()).toMatch(/QOREID_CLIENT_ID/);
        expect(logText()).toContain('upstream boom');
    });

    it('reports missing credentials without pretending the identity matched', async () => {
        delete process.env.QOREID_CLIENT_ID;

        const res = await (await service()).verifyBVN(BVN, 'Ada', 'Obi') as any;

        expect(res.success).toBe(false);
        expect(res.isMatch).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the transport, executed', () => {
    it('authenticates once and reuses the token across lookups', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(200, { accessToken: 'tok_123', expiresIn: 3600 }) as never)
            .mockResolvedValue(respond(200, {
                status: { status: 'id_verified' }, summary: { c: { status: 'EXACT_MATCH' } },
            }) as never);

        const svc = await service();
        await svc.verifyBVN(BVN, 'Ada', 'Obi');
        await svc.verifyNIN(NIN, 'Ada', 'Obi');

        const tokenCalls = calls().filter((c) => c.url.endsWith('/token'));
        expect(tokenCalls).toHaveLength(1);
        expect(calls()[0].body).toMatchObject({ clientId: 'client-id', secret: 'secret-key' });
    });

    it('re-authenticates after a 401, rather than looping on a dead token', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(200, { accessToken: 'tok_1', expiresIn: 3600 }) as never)
            .mockResolvedValueOnce(respond(401, { message: 'revoked' }) as never)
            .mockResolvedValueOnce(respond(200, { accessToken: 'tok_2', expiresIn: 3600 }) as never)
            .mockResolvedValueOnce(respond(200, {
                status: { status: 'id_verified' }, summary: { c: { status: 'EXACT_MATCH' } },
            }) as never);

        const svc = await service();
        expect(await svc.verifyBVN(BVN, 'Ada', 'Obi')).toMatchObject({ success: false });
        expect(await svc.verifyBVN(BVN, 'Ada', 'Obi')).toMatchObject({ success: true, isMatch: true });

        expect(calls().filter((c) => c.url.endsWith('/token'))).toHaveLength(2);
    });

    it('says so plainly when the provider rate-limits', async () => {
        arm(429, { message: 'slow down' });

        const res = await (await service()).verifyBVN(BVN, 'Ada', 'Obi') as any;
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/rate-limited/i);
    });

    it('reports a network failure as a failure, not as a mismatch', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(200, { accessToken: 'tok_1', expiresIn: 3600 }) as never)
            .mockRejectedValueOnce(Object.assign(new Error('ECONNRESET'), { name: 'FetchError' }) as never);

        const res = await (await service()).verifyBVN(BVN, 'Ada', 'Obi') as any;

        expect(res.success).toBe(false);
        expect(res.isMatch).toBeUndefined();
        expect(res.error).toMatch(/could not reach/i);
    });

    it('reports a timeout as a timeout', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(200, { accessToken: 'tok_1', expiresIn: 3600 }) as never)
            .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }) as never);

        expect(await (await service()).verifyBVN(BVN, 'Ada', 'Obi')).toMatchObject({
            success: false,
            error: expect.stringMatching(/timed out/i),
        });
    });

    it('survives a non-JSON response body without throwing', async () => {
        arm(200, '<html>gateway error</html>');

        const res = await (await service()).verifyBVN(BVN, 'Ada', 'Obi') as any;
        expect(res.success).toBe(true);
        expect(res.isMatch).toBe(false);   // unparseable is not a match
    });

    it('sends the CAC company name, not a person name', async () => {
        arm(200, { status: { status: 'id_verified' }, summary: { c: { status: 'EXACT_MATCH' } } });

        await (await service()).verifyCAC('RC123456', 'Kusu Consult Ltd');

        expect(calls()[1].body).toEqual({ companyName: 'Kusu Consult Ltd' });
        expect(calls()[1].url).toContain('cac-basic');
    });
});
