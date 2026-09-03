/**
 * @jest-environment node
 */

/**
 * The email queue could send the same email twice, two ways — #326.
 *
 * 1. NO CLAIM
 *    The loop selected `status == "pending"` and called Resend, with nothing in
 *    between. Two overlapping runs — a slow send against a ten-minute schedule,
 *    or a manual trigger landing on a scheduled one — both read the same rows
 *    and both sent.
 *
 *    Every other loop in this codebase was moved onto claimStatusTransition for
 *    exactly this (#249–#251), including two loops in the sibling
 *    release-escrow cron. This queue was missed, plausibly because nothing it
 *    duplicates is money. A member receiving two copies of one loan decision is
 *    still the platform speaking twice.
 *
 * 2. A SUCCESSFUL SEND WHOSE RECORD FAILED WAS RETRIED
 *    The status update sits inside the same try as the send, so a database
 *    hiccup AFTER the message left was caught as a send failure: attempts
 *    incremented, row re-queued, next run sent it again. It was also counted in
 *    `failed`, so the one number an operator checks said the opposite of what
 *    happened. #258/#259 and #318's shape — the side effect happened, the record
 *    did not — on the queue that exists to prevent exactly that.
 *
 * Two smaller things the rewrite corrects, both visible in the same block:
 *
 *   - `data.attempts || 1` compared with `attempts >= maxAttempts` gave SIX
 *     tries for a maxAttempts of 5.
 *   - `backoffMinutes` was computed from Math.pow(3, attempts) * 5 and then
 *     never read; a fixed 15 minutes was used instead, under a comment
 *     documenting the exponential backoff that did not happen. A dead address
 *     was retried every quarter hour for the life of the row.
 *
 * The tests execute the route. "Was the message sent twice" is only answerable
 * by running it and counting the sends.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

/** collection -> docId -> data */
let DOCS: Record<string, Record<string, any>> = {};
/** Every write, in order. */
let WRITES: Array<{ id: string; data: any }> = [];
/** Every Resend send, in order. */
let SENDS: Array<Record<string, any>> = [];
/** What Resend should answer. */
let SEND_RESULT: any = { data: { id: 'msg-1' }, error: null };
/** Make the "mark as sent" write throw, to model a db hiccup after delivery. */
let FAIL_STATUS_WRITE = false;
/**
 * Ids whose claim LOSES — another run got there first.
 *
 * Needed because the claim has its side effect whether or not the caller reads
 * the result: a mutant that deleted the `if (!claim.claimed)` guard entirely
 * still moved the row to "sending", so every assertion passed while the guard
 * was gone. Losing the claim while the row is still pending is the only shape
 * that separates "checks the answer" from "asks and ignores it".
 */
let CLAIM_LOSES: Set<string> = new Set();

function makeCollection(name: string): any {
    const filters: Array<[string, string, any]> = [];
    const q: any = {
        where: (f: string, op: string, v: any) => { filters.push([f, op, v]); return q; },
        orderBy: () => q, limit: () => q, all: () => q, select: () => q,
        get: async () => {
            let rows = Object.entries(DOCS[name] ?? {});
            for (const [f, op, v] of filters) {
                if (op === '==') rows = rows.filter(([, d]) => (d as any)[f] === v);
            }
            return {
                docs: rows.map(([id, data]) => ({ id, data: () => data })),
                empty: rows.length === 0,
                size: rows.length,
            };
        },
        doc: (id: string) => ({
            id,
            get: async () => ({ id, exists: Boolean(DOCS[name]?.[id]), data: () => DOCS[name]?.[id] }),
            update: async (d: any) => {
                if (FAIL_STATUS_WRITE && d.status === 'sent') throw new Error('db unavailable');
                WRITES.push({ id, data: d });
                (DOCS[name] ||= {})[id] = { ...(DOCS[name]?.[id] ?? {}), ...d };
            },
            set: async (d: any) => {
                WRITES.push({ id, data: d });
                (DOCS[name] ||= {})[id] = { ...d };
            },
        }),
    };
    return q;
}

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: { collection: (name: string) => makeCollection(name) },
}));

// The real CAS: claims only if the row is still in `from`.
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async (p: any) => {
        const row = DOCS[p.collection]?.[p.id];
        if (CLAIM_LOSES.has(p.id)) return { claimed: false, status: 'sending' };
        if (!row || row.status !== p.from) {
            return { claimed: false, status: row?.status ?? null };
        }
        DOCS[p.collection][p.id] = { ...row, status: p.to, ...(p.patch ?? {}) };
        return { claimed: true, status: p.to };
    }),
}));

jest.mock('resend', () => ({
    Resend: class {
        emails = {
            send: async (payload: any) => { SENDS.push(payload); return SEND_RESULT; },
        };
    },
}));

const SECRET = 'test-cron-secret';

async function runCron() {
    const { GET } = await import('@/app/api/cron/process-email-queue/route');
    const res: any = await GET({
        headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${SECRET}` : null) },
    } as any);
    return { status: res.status ?? 200, body: await res.json() };
}

function queued(id: string, extra: Record<string, unknown> = {}) {
    return {
        [id]: {
            to: 'member@example.com',
            subject: 'Your loan application',
            message: '<p>Approved</p>',
            status: 'pending',
            nextRetry: new Date(Date.now() - 60_000).toISOString(),
            ...extra,
        },
    };
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history; both are needed.
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.RESEND_API_KEY = 'test-key';
    DOCS = {};
    WRITES = [];
    SENDS = [];
    SEND_RESULT = { data: { id: 'msg-1' }, error: null };
    FAIL_STATUS_WRITE = false;
    CLAIM_LOSES = new Set();
});

describe('one queued email is sent once', () => {
    it('a pending email is sent and recorded', async () => {
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e1');

        const { body } = await runCron();

        expect(SENDS).toHaveLength(1);
        expect(SENDS[0].to).toBe('member@example.com');
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e1.status).toBe('sent');
        expect(body.succeeded).toBe(1);
    });

    it('THE test: a second overlapping run does not send it again', async () => {
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e2');

        await runCron();
        jest.resetModules();
        await runCron();

        expect(SENDS).toHaveLength(1);
    });

    it('THE test: losing the claim stops the send', async () => {
        // The real race, and the only shape that tests the GUARD rather than
        // the claim's side effect: the row is pending when the query runs, and
        // another run claims it before this one gets there. A version that
        // calls claimStatusTransition and ignores the answer sends anyway.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e3');
        CLAIM_LOSES = new Set(['e3']);

        const { body } = await runCron();

        expect(SENDS).toHaveLength(0);
        expect(body.skipped).toBe(1);
        expect(body.succeeded).toBe(0);
    });

    it('a row already marked sending never reaches the loop at all', async () => {
        // The outer query filters status == "pending", so this row is excluded
        // one layer earlier. Worth pinning, but it is NOT a test of the claim —
        // it passed vacuously while the claim guard was deleted, because the
        // loop never saw the row.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e3b', { status: 'sending' });

        const { body } = await runCron();

        expect(SENDS).toHaveLength(0);
        expect(body.processed).toBe(0);
        expect(body.skipped).toBeUndefined(); // returned before the loop
    });

    it('the row is claimed BEFORE the send, not after', async () => {
        // Order is the whole point: a claim after the send prevents nothing.
        const src = source('src/app/api/cron/process-email-queue/route.ts');
        const claimAt = src.indexOf('claimStatusTransition({');
        const sendAt = src.indexOf('resend.emails.send({');

        expect(claimAt).toBeGreaterThan(-1);
        expect(sendAt).toBeGreaterThan(-1);
        expect(claimAt).toBeLessThan(sendAt);
    });
});

describe('a send that worked is never retried, whatever else fails', () => {
    it('THE test: a failed status write does not re-queue a delivered email', async () => {
        // Before the fix this landed in the catch, incremented attempts, put the
        // row back to pending, and the next run sent it again.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e4');
        FAIL_STATUS_WRITE = true;

        await runCron();

        expect(SENDS).toHaveLength(1);
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e4.status).toBe('sending');

        // A later run must not pick it up: "sending" is outside the query.
        jest.resetModules();
        FAIL_STATUS_WRITE = false;
        await runCron();

        expect(SENDS).toHaveLength(1);
    });

    it('it is reported apart from a real failure, and flagged for a human', async () => {
        // Counting a delivered email in `failed` made the one number an
        // operator checks say the opposite of what happened.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e5');
        FAIL_STATUS_WRITE = true;

        const { body } = await runCron();

        expect(body.unrecorded).toBe(1);
        expect(body.failed).toBe(0);
        expect(body.warning).toMatch(/delivered but not recorded/i);
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e5.needsReconciliation).toBe(true);
    });

    it('its attempt count is NOT incremented', async () => {
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e6', { attempts: 2 });
        FAIL_STATUS_WRITE = true;

        await runCron();

        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e6.attempts).toBe(2);
    });
});

describe('a genuine send failure is retried, with a growing gap', () => {
    it('goes back to pending so the next run can see it', async () => {
        // The claim moved it to "sending"; a row left there is invisible.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e7');
        SEND_RESULT = { data: null, error: { message: 'mailbox full' } };

        const { body } = await runCron();

        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e7.status).toBe('pending');
        expect(body.failed).toBe(1);
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e7.lastError).toBe('mailbox full');
    });

    it('the backoff grows instead of being computed and discarded', async () => {
        // 5m, 15m, 45m — what the comment always claimed and the code never did.
        const gaps: number[] = [];

        for (const attempts of [0, 1, 2]) {
            jest.resetModules();
            WRITES = []; SENDS = [];
            DOCS = { [COLLECTIONS.EMAIL_QUEUE]: queued('e8', { attempts }) };
            SEND_RESULT = { data: null, error: { message: 'nope' } };

            const before = Date.now();
            await runCron();
            const next = new Date(DOCS[COLLECTIONS.EMAIL_QUEUE].e8.nextRetry).getTime();
            gaps.push(Math.round((next - before) / 60_000));
        }

        expect(gaps).toEqual([5, 15, 45]);
    });

    it('the backoff is capped, so a row cannot be parked for years', async () => {
        // 3^n grows fast: without a cap the ninth attempt would be 68 days out.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e9', { attempts: 20 });
        SEND_RESULT = { data: null, error: { message: 'nope' } };

        const before = Date.now();
        await runCron();

        // attempts 20 is past maxAttempts, so it is retired rather than delayed —
        // the cap is asserted on the helper's arithmetic instead.
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e9.status).toBe('failed');
        expect(Math.pow(3, 20) * 5).toBeGreaterThan(24 * 60);
        expect(source('src/app/api/cron/process-email-queue/route.ts'))
            .toContain('Math.min(Math.pow(3, attempts) * 5, 24 * 60)');
        expect(before).toBeGreaterThan(0);
    });

    it('"five tries" means five, not six', async () => {
        // `data.attempts || 1` with `attempts >= maxAttempts` retired the row on
        // the SIXTH failure. The fifth is the last one.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e10', { attempts: 4 });
        SEND_RESULT = { data: null, error: { message: 'nope' } };

        await runCron();

        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e10.status).toBe('failed');
    });

    it('and the fourth failure still leaves it retryable', async () => {
        // Vacuity guard on the boundary: retiring one attempt too early would
        // satisfy the test above and drop a deliverable email.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e11', { attempts: 3 });
        SEND_RESULT = { data: null, error: { message: 'nope' } };

        await runCron();

        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e11.status).toBe('pending');
    });
});

describe('the checks that were already right stay right', () => {
    it('an unconfigured cron secret refuses to run', async () => {
        delete process.env.CRON_SECRET;

        const { status } = await runCron();

        expect(status).toBe(500);
        expect(SENDS).toHaveLength(0);
    });

    it('a missing mail key refuses rather than looping', async () => {
        delete process.env.RESEND_API_KEY;
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e12');

        const { status } = await runCron();

        expect(status).toBe(500);
        expect(SENDS).toHaveLength(0);
    });

    it('a sent row is kept, not deleted', async () => {
        // #303: the queue used to destroy its successes and keep its failures,
        // so "was this ever emailed, and when" had no record.
        DOCS[COLLECTIONS.EMAIL_QUEUE] = queued('e13');

        await runCron();

        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e13).toBeDefined();
        expect(DOCS[COLLECTIONS.EMAIL_QUEUE].e13.sentAt).toBeDefined();
        expect(source('src/app/api/cron/process-email-queue/route.ts'))
            .not.toContain('.delete()');
    });
});
