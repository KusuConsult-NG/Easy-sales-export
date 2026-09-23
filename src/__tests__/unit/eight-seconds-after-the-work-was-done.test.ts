/**
 * @jest-environment node
 */

/**
 *   THE SLOWEST LINE ON THE PLATFORM, AND THE WORK WAS ALREADY FINISHED.
 *
 *       [slow-action] submitMultiStepWaveApplicationAction took 8145ms
 *       [slow-action] submitMultiStepWaveApplicationAction took 7417ms
 *
 *   By the time those seconds were being spent the transaction had COMMITTED:
 *   the application row was written and the user record updated. What the
 *   applicant was waiting for was a confirmation email to Resend, a query for
 *   every admin, a notification row written for each of them and a push sent
 *   to each — none of which changes a byte of what comes back to her, which is
 *   an application id she already has.
 *
 *   A woman who has just filled in fifty fields, her NIN and her BVN, and then
 *   watches a spinner for eight seconds, has every reason to think it failed
 *   and press the button again.
 *
 *   `after` from next/server is the framework's own mechanism for this, and
 *   the reason it is used in place of the floating `.catch()` promise the same
 *   action already had: nothing tracked that one, and a container recycled
 *   between the response and the resolve lost the work in silence.
 *
 *   WHAT MUST NOT BE DEFERRED is the other half, and it is asserted in
 *   wave-applications-behaviour: invalidateUserCache stays awaited, because
 *   the client calls checkWaveStatusAction about a second later and that read
 *   goes through the cache entry being cleared. Defer what NOTIFIES, await
 *   what the answer is READ FROM.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const afterSpy = jest.fn();

jest.mock('next/server', () => ({
    after: (task: any) => afterSpy(task),
}));

const errors: unknown[][] = [];
jest.mock('@/lib/logger', () => ({
    logger: {
        error: (...args: unknown[]) => { errors.push(args); },
        warn: () => {},
        info: () => {},
        debug: () => {},
    },
}));

const subject = () => import('@/lib/after-response');

beforeEach(() => {
    jest.resetModules();
    afterSpy.mockReset();
    errors.length = 0;
});

describe('outside a request scope — a cron, a script, this test', () => {
    beforeEach(() => {
        //   next/server's `after` THROWS when there is no request scope. That
        //   is its real behaviour, not a contrivance: see
        //   node_modules/next/dist/server/after/after.js.
        afterSpy.mockImplementation(() => {
            throw new Error('`after` was called outside a request scope.');
        });
    });

    it('STILL RUNS THE WORK — dropping it would be a cron that notifies nobody', async () => {
        const { afterResponse, flushAfterResponses } = await subject();
        let ran = false;

        afterResponse('test', async () => { ran = true; });
        await flushAfterResponses();

        expect(ran).toBe(true);
    });

    it('and flushing WAITS for it, rather than returning while it is in flight', async () => {
        const { afterResponse, flushAfterResponses } = await subject();
        const order: string[] = [];

        afterResponse('test', async () => {
            await new Promise((r) => setTimeout(r, 30));
            order.push('work-done');
        });
        await flushAfterResponses();
        order.push('flushed');

        expect(order).toEqual(['work-done', 'flushed']);
    });

    it('waits for work that a piece of deferred work started in turn', async () => {
        //   The loop in flushAfterResponses is why: draining once would return
        //   while a second deferral was still open.
        const { afterResponse, flushAfterResponses } = await subject();
        const done: string[] = [];

        afterResponse('outer', async () => {
            await new Promise((r) => setTimeout(r, 10));
            done.push('outer');
            afterResponse('inner', async () => {
                await new Promise((r) => setTimeout(r, 10));
                done.push('inner');
            });
        });
        await flushAfterResponses();

        expect(done).toEqual(['outer', 'inner']);
    });
});

describe('inside a request scope', () => {
    it('HANDS THE WORK TO next/server, and does not run it inline', async () => {
        //   The production path. If this ran the work itself, every deferral
        //   would be a floating promise again and `after` would be decoration.
        const { afterResponse, flushAfterResponses } = await subject();
        let ran = false;

        afterResponse('test', async () => { ran = true; });

        expect(afterSpy).toHaveBeenCalledTimes(1);
        await flushAfterResponses();
        expect(ran).toBe(false);

        //   Next runs it when the response is finished. Same work, later.
        await (afterSpy.mock.calls[0] as any[])[0]();
        expect(ran).toBe(true);
    });

    it('RETURNS IMMEDIATELY, whatever the work costs', async () => {
        const { afterResponse } = await subject();
        const startedAt = Date.now();

        afterResponse('slow', async () => {
            await new Promise((r) => setTimeout(r, 400));
        });

        //   The whole point: the caller is already past this line.
        expect(Date.now() - startedAt).toBeLessThan(100);
    });
});

describe('deferred work cannot hurt the action that deferred it', () => {
    it('A THROW NEVER ESCAPES — the action already returned', async () => {
        const { afterResponse } = await subject();

        expect(() => afterResponse('boom', async () => {
            throw new Error('smtp down');
        })).not.toThrow();

        await (afterSpy.mock.calls[0] as any[])[0]();
    });

    it('and the failure is LOGGED with its label, not swallowed in silence', async () => {
        const { afterResponse } = await subject();

        afterResponse('wave-application-notifications', async () => {
            throw new Error('smtp down');
        });
        await (afterSpy.mock.calls[0] as any[])[0]();

        const said = errors.map((e) => String(e[0])).join(' | ');
        expect(said).toContain('wave-application-notifications');
    });

    it('a rejection outside a request scope does not reject the flush either', async () => {
        afterSpy.mockImplementation(() => { throw new Error('no request scope'); });
        const { afterResponse, flushAfterResponses } = await subject();

        afterResponse('boom', async () => { throw new Error('smtp down'); });

        //   An unhandled rejection here would take down the process that a
        //   cron is running in.
        await expect(flushAfterResponses()).resolves.toBeUndefined();
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('the WAVE action defers the right half', () => {
    const readSrc = (rel: string) => {
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        return readFileSync(join(process.cwd(), rel), 'utf8');
    };
    const read = () => readSrc('src/app/actions/wave/_wv_applications.ts');

    it('AND next/server IS LOADED LAZILY, or unrelated suites go red before their own code runs', () => {
        /*
         *   A static `import { after } from "next/server"` pulls in
         *   NextRequest, which reads the global `Request` at module scope.
         *   jsdom has no such global, and three suites reach this module the
         *   ordinary way — a client component imports the WAVE server actions,
         *   which is how server actions are called. Importing it at the top
         *   turned all three red with `ReferenceError: Request is not defined`
         *   before a line of their own code ran, which is a long way from the
         *   cause.
         */
        const src = readSrc('src/lib/after-response.ts');

        expect(src).not.toMatch(/^import \{[^}]*\bafter\b[^}]*\} from ["']next\/server["']/m);
        expect(src).toContain('require("next/server")');
    });

    it('THE NOTIFICATIONS ARE DEFERRED AND THE CACHE INVALIDATION IS NOT', () => {
        /*
         *   #692 is this platform's record of a correction that was invisible
         *   to its own reader. The client calls checkWaveStatusAction about a
         *   second after this action returns — it is the next line in the
         *   owner's log both times it ran — and that read goes through
         *   requireSession, which reads the very cache entry invalidated here.
         *
         *   Deferring the notifications is the fix. Deferring the invalidation
         *   would be #692 again with a timer on it.
         */
        const src = read();

        expect(src).toContain('afterResponse("wave-application-notifications"');
        expect(src).toContain('afterResponse("wave-application-audit"');
        //   Awaited, outside any deferral.
        expect(src).toMatch(/^\s*await invalidateUserCache\(session\.user\.id\);$/m);
        expect(src).not.toContain('afterResponse("wave-cache');
    });

    it('and the audit log is no longer a promise dropped on the floor', () => {
        //   It was `createAdminAuditLog({...}).catch(...)`: the same intent,
        //   with nothing tracking it.
        const src = read();

        expect(src).not.toContain('.catch(err => logger.error("Deferred audit log failed (WAVE):', );
    });
});
