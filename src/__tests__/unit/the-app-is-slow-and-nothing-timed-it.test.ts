/**
 *   "THE ENTIRE APP IS STILL VERY SLOW" — said three times, answered three
 *   times from inference.
 *
 *   Nothing on this platform measures a server action. The admin side was
 *   repaired from a MEASUREMENT (EXPLAIN ANALYZE on the registration rollup,
 *   1,037,000 buffers down to 1,262); every user-side answer so far has come
 *   from reading code, which is how "I fixed the slowness" and "it is still
 *   slow" have both been true at once.
 *
 *   Every server action already funnels through withSafeAction or
 *   withFlexibleSafeAction. Timing the call they already make turns the
 *   complaint into a list of names and milliseconds, in production, in logs
 *   the owner already has.
 *
 *   WHAT THIS SUITE HOLDS, AND WHY EACH LINE OF IT IS HERE:
 *
 *     - the report names the ACTION, because "something was slow" is the
 *       state we are already in;
 *     - a fast action says NOTHING, because a line per call buries the answer
 *       in the evidence;
 *     - a SLOW FAILURE is reported too — a nine-second failure is usually a
 *       timeout, and a timeout is what a user actually sits through;
 *     - the timing NEVER changes the outcome: same value, same error, and a
 *       logger that throws cannot take the action down with it.
 *
 *   That last one is the one that matters most. Instrumentation that can break
 *   the thing it measures is worse than no instrumentation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('@/app/actions/telemetry', () => ({ logTelemetryAction: jest.fn() }));
jest.mock('@/lib/logger-server', () => ({ logObservabilityTrace: jest.fn() }));

/*
 *   LOADED DYNAMICALLY, NOT AT THE TOP — #392's rule, and its detector caught
 *   this file.
 *
 *   `jest` is imported from '@jest/globals' here, so the two jest.mock calls
 *   above do NOT hoist. A static `import ... from '@/lib/safe-action'` would
 *   therefore pull telemetry and logger-server in BEFORE either mock was
 *   registered, and the suite would quietly exercise the real modules while
 *   claiming to have replaced them.
 */
const subject = () => import('@/lib/safe-action');
const loggerModule = () => import('@/lib/logger');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every `[slow-action]` line this test produced. */
const slowLines = (warn: any): string[] =>
    warn.mock.calls
        .map((c: any[]) => String(c[0]))
        .filter((m: string) => m.includes('[slow-action]'));

let warn: any;
const originalThreshold = process.env.SLOW_ACTION_MS;

beforeEach(async () => {
    const { logger } = await loggerModule();
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
});

afterEach(() => {
    warn.mockRestore();
    if (originalThreshold === undefined) delete process.env.SLOW_ACTION_MS;
    else process.env.SLOW_ACTION_MS = originalThreshold;
});

describe('a server action that takes too long says so, by name', () => {
    it('NAMES THE ACTION AND THE MILLISECONDS', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const { withSafeAction } = await subject();
        const action = withSafeAction('getMyDashboard', async () => {
            await sleep(25);
            return { success: true as const, error: null, data: 'ok' };
        });

        await action();

        const lines = slowLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('getMyDashboard');
        //   The number is the whole point: "slow" without a figure cannot be
        //   compared against the next measurement.
        expect(lines[0]).toMatch(/took \d+ms/);
    });

    it('SAYS NOTHING about an action that was fast — the log must stay a shortlist', async () => {
        process.env.SLOW_ACTION_MS = '10000';
        const { withSafeAction } = await subject();
        const action = withSafeAction('getMyWalletBalance', async () =>
            ({ success: true as const, error: null, data: 0 }));

        await action();

        expect(slowLines(warn)).toEqual([]);
    });

    it('is turned OFF by a threshold of zero, for an operator who wants silence', async () => {
        process.env.SLOW_ACTION_MS = '0';
        const { withSafeAction } = await subject();
        const action = withSafeAction('anything', async () => {
            await sleep(20);
            return { success: true as const, error: null, data: 1 };
        });

        await action();

        expect(slowLines(warn)).toEqual([]);
    });

    it('REPORTS A SLOW FAILURE TOO — the nine-second timeout is the interesting one', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const { withSafeAction } = await subject();
        const action = withSafeAction('checkoutAction', async () => {
            await sleep(25);
            throw new Error('upstream timed out');
        });

        const result = await action();

        //   Reported...
        expect(slowLines(warn)[0]).toContain('checkoutAction');
        //   ...and the failure still comes back exactly as it did before.
        expect(result.success).toBe(false);
        expect(result.error).toContain('upstream timed out');
    });

    it('covers withFlexibleSafeAction as well, which wraps the academy payment gate', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const { withFlexibleSafeAction } = await subject();
        const action = withFlexibleSafeAction('checkAcademyPaymentStatusAction', async () => {
            await sleep(25);
            return { success: true as const, error: null, data: 'paid' };
        });

        expect(await action()).toEqual({ success: true, error: null, data: 'paid' });
        expect(slowLines(warn)[0]).toContain('checkAcademyPaymentStatusAction');
    });
});

describe('the measurement cannot break what it measures', () => {
    it('HANDS BACK THE VALUE UNTOUCHED', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const payload = { success: true as const, error: null, data: { deep: { value: 42 } } };
        const { withSafeAction } = await subject();
        const action = withSafeAction('getMyDashboard', async () => { await sleep(10); return payload; });

        expect(await action()).toEqual(payload);
    });

    it('A LOGGER THAT THROWS DOES NOT FAIL THE ACTION', async () => {
        process.env.SLOW_ACTION_MS = '5';
        warn.mockImplementation(() => { throw new Error('log sink is down'); });

        const { withSafeAction } = await subject();
        const action = withSafeAction('getMyDashboard', async () => {
            await sleep(20);
            return { success: true as const, error: null, data: 'still here' };
        });

        //   Without the guard around the report this rejects, and a broken log
        //   sink becomes a broken platform.
        await expect(action()).resolves.toEqual({ success: true, error: null, data: 'still here' });
    });

    it('lets a Next.js redirect through, still, rather than swallowing it as a slow failure', async () => {
        process.env.SLOW_ACTION_MS = '5';
        const redirectError: any = new Error('NEXT_REDIRECT');
        redirectError.digest = 'NEXT_REDIRECT;push;/academy/application;307;';

        const { withSafeAction } = await subject();
        const action = withSafeAction('academyGate', async () => { await sleep(10); throw redirectError; });

        await expect(action()).rejects.toBe(redirectError);
    });
});
