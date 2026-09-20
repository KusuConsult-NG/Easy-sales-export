/**
 * @jest-environment node
 */

/**
 *   THE OWNER'S LOG SHOWED TWENTY IDENTICAL ERRORS AND NAMED NO ROUTE.
 *
 *       ⨯ Error: The destination stream closed early.
 *           at ignore-listed frames { digest: '2398141500' }
 *
 *   Twenty of them, one digest, no path, no method, no route file. Which means
 *   three completely different situations produce a log that looks the same:
 *
 *       a person navigated away, closed the tab, or lost signal mid-render
 *       a proxy cut a response that took too long — ONE route being slow
 *       the container restarted with requests in flight
 *
 *   Spread across many routes it is ordinary internet and there is nothing to
 *   do. All on one route it is that route, and there is a great deal to do.
 *   Nothing in the codebase recorded which, so the honest answer to "what is
 *   this?" was a guess — and a guess is what was given first.
 *
 *   `onRequestError` has the request. These tests are about making the next
 *   log answer the question rather than pose it, and about the one thing that
 *   must never happen while doing so: a real error going quiet.
 *
 * ── WHY MATCHING NEXT'S WORDING IS DEFENSIBLE *HERE* ────────────────────────
 *
 *   The login lockout broke this week because a guard matched wording that
 *   rate-limit.ts owned, the wording was improved, and the guard silently
 *   stopped firing. Doing the same thing again needs a reason.
 *
 *   The difference is which way it fails. That guard failed OPEN — brute-force
 *   protection off, nothing said so. This one fails NOISY: if Next rewords the
 *   message, aborts reach Sentry again, which is visible immediately and costs
 *   nothing but noise. Node's `code` is checked first precisely because it does
 *   not depend on anybody's prose, and the last test here is the ratchet on
 *   that ordering.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { isConnectionGoneAway } from '@/lib/request-abort';

const captureRequestError = jest.fn();
jest.mock('@sentry/nextjs', () => ({
    captureRequestError: (...a: any[]) => captureRequestError(...a),
    init: jest.fn(),
}));

const REQUEST = { path: '/dashboard?tab=wallet', method: 'GET', headers: {} };
const CONTEXT = {
    routerKind: 'App Router' as const,
    routePath: '/dashboard',
    routeType: 'render' as const,
    renderSource: 'react-server-components' as const,
    revalidateReason: undefined,
};

/** The exact error from the production log, digest and all. */
const THE_LOGGED_ERROR = Object.assign(
    new Error('The destination stream closed early.'), { digest: '2398141500' },
);

describe('classifying a connection that went away', () => {
    it('recognises the error the production log is full of', () => {
        expect(isConnectionGoneAway(THE_LOGGED_ERROR)).toBe(true);
    });

    it('and the Node-level one it was interleaved with', () => {
        expect(isConnectionGoneAway(
            Object.assign(new Error('aborted'), { code: 'ECONNRESET' }),
        )).toBe(true);
    });

    it('and a caller that aborted deliberately', () => {
        expect(isConnectionGoneAway(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))).toBe(true);
    });

    it('BY CODE BEFORE MESSAGE — so a reword cannot silence the common case', () => {
        //   THE ratchet on the lockout's lesson. Node's code is stable and is
        //   not anybody's prose; if this only read messages, the next rename
        //   upstream would take the whole classification with it.
        expect(isConnectionGoneAway({ code: 'ECONNRESET', message: 'something entirely new' })).toBe(true);
        expect(isConnectionGoneAway({ code: 'EPIPE' })).toBe(true);
        expect(isConnectionGoneAway({ code: 'ERR_STREAM_PREMATURE_CLOSE' })).toBe(true);
    });

    it('and capitalisation alone cannot silence it either', () => {
        expect(isConnectionGoneAway(new Error('The Destination Stream Closed Early.'))).toBe(true);
    });

    it('AND IT IS NOT A CATCH-ALL — a real fault is not a disconnect', () => {
        //   THE control, and the one that matters most. A classifier that said
        //   "true" to everything would pass every test above and hide the
        //   platform's entire error stream.
        expect(isConnectionGoneAway(new Error('Cannot read properties of undefined'))).toBe(false);
        expect(isConnectionGoneAway(new Error('Wallet debit failed: insufficient funds'))).toBe(false);
        expect(isConnectionGoneAway(new TypeError('x is not a function'))).toBe(false);
        expect(isConnectionGoneAway({ code: 'ENOENT', message: 'no such file' })).toBe(false);
        expect(isConnectionGoneAway(null)).toBe(false);
        expect(isConnectionGoneAway(undefined)).toBe(false);
        expect(isConnectionGoneAway({})).toBe(false);
    });
});

describe('what the hook does with each', () => {
    let warn: jest.SpiedFunction<typeof console.warn>;

    async function hook() {
        const mod = jest.requireActual('@/instrumentation') as any;
        return mod.onRequestError as (e: unknown, r: any, c: any) => Promise<void>;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('THE test — a closed connection is logged WITH ITS ROUTE', async () => {
        //   The whole point. Twenty anonymous lines become twenty lines naming
        //   a route, and the question answers itself.
        await (await hook())(THE_LOGGED_ERROR, REQUEST, CONTEXT);

        const line = String(warn.mock.calls[0]?.[0] ?? '');
        expect(line).toContain('/dashboard?tab=wallet');
        expect(line).toContain('GET');
        expect(line).toContain('/dashboard');
        expect(line).toContain('render');
    });

    it('and is NOT reported to Sentry, where it would bury real errors', async () => {
        await (await hook())(THE_LOGGED_ERROR, REQUEST, CONTEXT);

        expect(captureRequestError).not.toHaveBeenCalled();
    });

    it('AND A REAL ERROR IS STILL REPORTED — the control on all of the above', async () => {
        //   If this hook swallowed everything, the platform would go silent and
        //   every test above would still pass. Adding onRequestError is what
        //   makes App Router errors reach Sentry at all, so getting this wrong
        //   would lose more than it filtered.
        const real = new Error('Cannot read properties of undefined');

        await (await hook())(real, REQUEST, CONTEXT);

        expect(captureRequestError).toHaveBeenCalledTimes(1);
        expect(captureRequestError).toHaveBeenCalledWith(real, REQUEST, CONTEXT);
        expect(warn).not.toHaveBeenCalled();
    });

    it('and a thrown classifier reports rather than swallows', async () => {
        //   Fail towards reporting. An error that cannot be classified is still
        //   an error, and the one outcome that must never happen is silence.
        const hostile = { get message() { throw new Error('boom'); } };

        await (await hook())(hostile, REQUEST, CONTEXT);

        expect(captureRequestError).toHaveBeenCalledTimes(1);
    });
});
