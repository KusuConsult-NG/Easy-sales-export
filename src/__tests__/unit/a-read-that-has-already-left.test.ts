/**
 * @jest-environment node
 */

/**
 *   THE PRIMITIVE BEHIND "SEVEN READS IN THREE WAVES".
 *
 *   `checkCooperativeStatusAction` did seven reads in SIX waves — it waited
 *   for them almost one at a time, and six serial hops at a few hundred
 *   milliseconds each is the 1,496–2,596ms in the owner's log. Three of those
 *   lookups ask different questions about one person and need nothing from
 *   each other; they were a chain only in the source.
 *
 *   Issuing them together needs somewhere to put a promise that MIGHT NOT BE
 *   READ, and that is the whole difficulty:
 *
 *       A PROMISE NOBODY AWAITS STILL REJECTS.
 *
 *   Start a query early, return before you need it, and its failure becomes an
 *   unhandled rejection — a process-level event in Node, not a local one. That
 *   is a worse bug than the latency being fixed, so this file's central test
 *   is the one with a CONTROL showing the bare promise really does fire it.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { startedEarly } from '@/lib/started-early';

/** Let Node get far enough to decide a rejection was unhandled. */
const settleTurns = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every unhandled rejection raised while `body` ran. */
async function unhandledDuring(body: () => void): Promise<unknown[]> {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => { seen.push(reason); };

    //   Jest installs its own handler and fails the test file on an unhandled
    //   rejection. Taking the listeners off for the duration is what lets the
    //   CONTROL below actually observe one instead of exploding.
    const existing = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', onUnhandled);
    try {
        body();
        await settleTurns();
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        for (const l of existing) process.on('unhandledRejection', l as any);
    }
    return seen;
}

describe('a read started early and never read back', () => {
    it('DOES NOT BECOME AN UNHANDLED REJECTION', async () => {
        const raised = await unhandledDuring(() => {
            //   Started, fails, and the caller returns without ever asking.
            startedEarly(Promise.reject(new Error('query failed')));
        });

        expect(raised).toEqual([]);
    });

    it('AND THE CONTROL — a bare promise in the same shape really does raise one', async () => {
        /*
         *   Without this the test above passes on any implementation at all,
         *   including one that does nothing, because a test environment that
         *   never reports unhandled rejections reports zero of them.
         */
        const raised = await unhandledDuring(() => {
            void Promise.reject(new Error('query failed'));
        });

        expect(raised).toHaveLength(1);
        expect(String((raised[0] as Error).message)).toBe('query failed');
    });
});

describe('and read back, it behaves exactly as awaiting in place would', () => {
    it('hands over the value', async () => {
        const read = startedEarly(Promise.resolve({ docs: [1, 2, 3] }));

        await expect(read()).resolves.toEqual({ docs: [1, 2, 3] });
    });

    it('RE-RAISES THE ORIGINAL ERROR, not a copy and not a null', async () => {
        //   Swallowing it would turn a failed query into an empty result, and
         //  #316's rule on money is the same rule here: not knowing, reported
        //   as a fact, in the direction that harms.
        const boom = new Error('statement timeout');
        const read = startedEarly(Promise.reject(boom));

        await expect(read()).rejects.toBe(boom);
    });

    it('re-raises a FALSY rejection too, which a truthiness test would drop', async () => {
        const read = startedEarly(Promise.reject(undefined));

        await expect(read()).rejects.toBeUndefined();
    });

    it('can be read twice and answers the same both times', async () => {
        //   Two call sites reaching the same prefetch must not double the
        //   round trip, nor disagree.
        let calls = 0;
        const read = startedEarly((async () => { calls += 1; return 'row'; })());

        expect(await read()).toBe('row');
        expect(await read()).toBe('row');
        expect(calls).toBe(1);
    });
});

describe('the work is already in flight before anybody reads it', () => {
    it('STARTS IMMEDIATELY — that is the entire point', async () => {
        let started = false;
        const read = startedEarly((async () => { started = true; return 1; })());

        //   Not "when read() is called": the query left when startedEarly did.
        expect(started).toBe(true);
        await read();
    });

    it('so three reads issued together cost one wait, not three', async () => {
        /*
         *   The shape of the cooperative fix, in miniature. Sequential awaits
         *   of three 30ms reads take about 90ms; started together they take
         *   about 30.
         */
        const slow = (ms: number) => new Promise((r) => setTimeout(() => r(ms), ms));

        const startedAt = Date.now();
        const a = startedEarly(slow(30) as Promise<number>);
        const b = startedEarly(slow(30) as Promise<number>);
        const c = startedEarly(slow(30) as Promise<number>);
        await a(); await b(); await c();
        const elapsed = Date.now() - startedAt;

        //   Generous, because a loaded CI box is not a stopwatch — but nowhere
        //   near the ~90ms three serial waits would take.
        expect(elapsed).toBeLessThan(75);
    });
});

describe('the cooperative action uses it where the measurement said to', () => {
    const read = (rel: string) => {
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        return readFileSync(join(process.cwd(), rel), 'utf8');
    };

    it('THREE LOOKUPS ARE STARTED BEFORE THE FIRST IS READ', () => {
        const src = read('src/app/actions/cooperative/_coop_membership.ts');

        //   The membership row, the by-address query and the Paystack check.
        expect([...src.matchAll(/startedEarly\(/g)]).toHaveLength(3);
    });

    it('AND THE CLAIM GATE IS STILL BETWEEN THE QUERY AND ITS USE', () => {
        /*
         *   The security half, and the reason this is asserted rather than
         *   assumed. Issuing a by-address query early is not reading its rows
         *   into an answer: adopting a stranger's membership here would grant
         *   the cooperative_member role as well as visibility, which is what
         *   mayClaimMembershipByEmail exists to stop.
         */
        const src = read('src/app/actions/cooperative/_coop_membership.ts');
        const gateAt = src.indexOf('mayClaimMembershipByEmail(');
        const adoptAt = src.indexOf('memberDocData = latestByEmail.data()');

        expect(gateAt).toBeGreaterThan(-1);
        expect(adoptAt).toBeGreaterThan(gateAt);
    });
});
