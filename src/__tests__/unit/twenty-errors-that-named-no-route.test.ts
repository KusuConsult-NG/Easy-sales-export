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
 *
 * AND THAT ARGUMENT HAD A HOLE IN IT, WHICH THIS FILE MISSED.
 *
 *   "Fails noisy" is true of a REWORD. It was never true of an OVER-MATCH.
 *   `"aborted"` was in the substring list, so every server error whose message
 *   merely contained the word — Postgres's "current transaction is aborted,
 *   commands ignored until end of transaction block" among them — was
 *   classified as a dead connection and withheld from Sentry. A real fault
 *   silently removed from the error tracker produces nothing to notice, which
 *   is the lockout guard's failure mode exactly.
 *
 *   The control below ('AND IT IS NOT A CATCH-ALL') existed and did not catch
 *   it, because not one of its negative cases contained the word. A control is
 *   only as good as the cases somebody thought to put in it.
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
        //   THE CASES THIS CONTROL WAS MISSING. Every one of these was
        //   classified as a dead connection and withheld from Sentry, because
        //   `"aborted"` was matched as a substring.
        expect(isConnectionGoneAway(new Error(
            'current transaction is aborted, commands ignored until end of transaction block',
        ))).toBe(false);
        expect(isConnectionGoneAway(new Error('Payment aborted by provider'))).toBe(false);
        expect(isConnectionGoneAway(new Error('Upload aborted: invalid file type'))).toBe(false);
        expect(isConnectionGoneAway(new Error('Escrow release aborted — ledger mismatch'))).toBe(false);
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

    it('THE test for the over-match — a Postgres abort REACHES Sentry', async () => {
        /*
         *   The assertion that discriminates, and the reason it is written at
         *   the hook rather than at the classifier.
         *
         *   `expect(isConnectionGoneAway(...)).toBe(false)` above says the
         *   classifier changed its mind. What anybody actually cares about is
         *   the consequence: this error appears in the error tracker. Before
         *   the fix it did not — it was logged as a client disconnect and
         *   dropped, with nothing anywhere to say a real fault had been
         *   removed.
         *
         *   Postgres emits this verbatim, and this platform talks to Postgres.
         */
        const pg = new Error(
            'current transaction is aborted, commands ignored until end of transaction block',
        );

        await (await hook())(pg, REQUEST, CONTEXT);

        expect(captureRequestError).toHaveBeenCalledTimes(1);
        expect(captureRequestError).toHaveBeenCalledWith(pg, REQUEST, CONTEXT);
        //   And it is NOT written off as a disconnect in the log either.
        expect(warn).not.toHaveBeenCalled();
    });

    it('while the genuine Node abort is still held back', async () => {
        //   The other side of the same line. `Error: aborted` is what Node
        //   throws on a real client disconnect and it must keep its old
        //   treatment, or the fix has traded one fault for another.
        await (await hook())(new Error('aborted'), REQUEST, CONTEXT);

        expect(captureRequestError).not.toHaveBeenCalled();
        expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('/dashboard');
    });

    it('and a thrown classifier reports rather than swallows', async () => {
        //   Fail towards reporting. An error that cannot be classified is still
        //   an error, and the one outcome that must never happen is silence.
        const hostile = { get message() { throw new Error('boom'); } };

        await (await hook())(hostile, REQUEST, CONTEXT);

        expect(captureRequestError).toHaveBeenCalledTimes(1);
    });
});
