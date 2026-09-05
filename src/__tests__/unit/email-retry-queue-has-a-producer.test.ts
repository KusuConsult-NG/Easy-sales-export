/**
 * @jest-environment node
 */

/**
 *   #354 THE EMAIL RETRY QUEUE HAD NO PRODUCER. A CRON RAN ON A SCHEDULE TO
 *        DRAIN A COLLECTION NOTHING EVER FILLED.
 *
 *        Three pieces, and only two of them were connected.
 *
 *          lib/email-queue.ts          exports queueEmail — "send now, save to
 *                                      the queue if that fails". ZERO CALLERS.
 *                                      Its private saveToQueue was the only
 *                                      writer of COLLECTIONS.EMAIL_QUEUE
 *                                      anywhere in the repository.
 *          api/cron/process-email-queue  reads that collection on a schedule,
 *                                      retries each row, and — since #326 —
 *                                      claims each one so the same email
 *                                      cannot go out twice.
 *          lib/email-notifications.ts  sendEmailNotification, the choke point
 *                                      seventeen of the nineteen typed
 *                                      send*Email helpers route through —
 *                                      sendPasswordResetEmail,
 *                                      sendSellerApprovalEmail,
 *                                      sendWithdrawalApprovedEmail and the
 *                                      rest.
 *
 *        (My first write-up of this said "seventeen action files call it
 *        directly". That was wrong — nothing outside this module calls it by
 *        name; the seventeen are the typed helpers INSIDE it, and the
 *        application calls those. The count was right and the topology was
 *        not, and the assertion below now measures the real one.)
 *
 *        So there was a consumer, a schedule and a double-send guard, all built
 *        around a queue with no producer — and the live sender, on a Resend
 *        failure, logged the error, returned `{ success: false }`, and dropped
 *        the message.
 *
 *        WHAT THAT COST. A 429 during a broadcast, or a network blip while a
 *        password-reset link was going out, lost that email with no second
 *        attempt. #308 made nine decision paths stop skipping their email in
 *        silence; this is the layer below — the send itself failing quietly.
 *
 *        The two ends are connected now. A failure to QUEUE is swallowed on
 *        purpose: the caller has already been told the send failed, and
 *        throwing there would turn a lost email into a failed operation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const SENDER = 'src/lib/email-notifications.ts';
const QUEUE = 'src/lib/email-queue.ts';
const CRON = 'src/app/api/cron/process-email-queue/route.ts';

const EMAIL = { to: 'ada@example.com', subject: 'Reset your password', message: '<p>link</p>' };

let store: FakeDbHandle;
const send = jest.fn() as jest.Mock<any>;

jest.mock('resend', () => ({ Resend: class { emails = { send: (...a: any[]) => send(...a) }; } }));

function queued(): Record<string, any>[] {
    return store.all(COLLECTIONS.EMAIL_QUEUE).map(([, d]) => d);
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.RESEND_API_KEY = 'test-key';
});

async function sendEmail(data = EMAIL) {
    const { sendEmailNotification } = await import('@/lib/email-notifications');
    return sendEmailNotification(data as any);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#354 — a failed send reaches the queue', () => {
    it('A RESEND API ERROR IS QUEUED FOR RETRY', async () => {
        // THE test. This returned success:false and dropped the email.
        send.mockResolvedValue({ error: { message: 'Rate limit exceeded' }, data: null });

        const result = await sendEmail();

        expect(result.success).toBe(false);
        expect(queued()).toHaveLength(1);
        expect(queued()[0]).toMatchObject({
            to: 'ada@example.com',
            subject: 'Reset your password',
            status: 'pending',
            lastError: 'Rate limit exceeded',
        });
    });

    it('AND SO IS A THROWN ERROR — the network-fault path', async () => {
        // The other branch. A DNS failure or a socket reset lands here.
        send.mockRejectedValue(new Error('ECONNRESET'));

        const result = await sendEmail();

        expect(result.success).toBe(false);
        expect(queued()).toHaveLength(1);
        expect(queued()[0].lastError).toBe('ECONNRESET');
    });

    it('a SUCCESSFUL send queues nothing', async () => {
        // The vacuity guard, and the one that matters most: queueing on
        // success would send every email twice.
        send.mockResolvedValue({ error: null, data: { id: 'msg-1' } });

        const result = await sendEmail();

        expect(result.success).toBe(true);
        expect(queued()).toEqual([]);
    });

    it('the queued row carries the message body, or the retry sends a blank', async () => {
        send.mockRejectedValue(new Error('boom'));

        await sendEmail();

        expect(queued()[0].message).toBe('<p>link</p>');
    });

    it('and the metadata the sender was given', async () => {
        send.mockRejectedValue(new Error('boom'));

        await sendEmail({ ...EMAIL, metadata: { type: 'password_reset' } } as any);

        expect(queued()[0].metadata).toEqual({ type: 'password_reset' });
    });

    it('A FAILURE TO QUEUE DOES NOT BECOME A FAILURE TO OPERATE', async () => {
        // The caller has already been told the send failed. Throwing here
        // would turn a lost email into a failed password reset.
        send.mockRejectedValue(new Error('boom'));
        (global as any).mockFirestoreAdd.mockRejectedValueOnce(new Error('db down'));

        await expect(sendEmail()).resolves.toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#354 — the row matches the contract the cron selects on', () => {
    it('status "pending" and a nextRetry, which is what the query filters', async () => {
        send.mockRejectedValue(new Error('boom'));
        await sendEmail();

        const row = queued()[0];
        expect(row.status).toBe('pending');
        expect(row).toHaveProperty('nextRetry');
        expect(row.attempts).toBe(1);
    });

    it('and the cron really does select on exactly those two', () => {
        // Pinned against the consumer, so the producer cannot drift from it.
        const cron = source(CRON);

        expect(cron).toContain('.where("status", "==", "pending")');
        expect(cron).toContain('.where("nextRetry", "<=", now)');
    });

    it('the cron still claims each row, so #326 is intact', () => {
        // Vacuity guard: connecting a producer must not have disturbed the
        // guard that stops the same email going out twice.
        expect(source(CRON)).toContain('claimStatusTransition');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#354 — the wiring, and the claim it rests on', () => {
    it('THE SENDER CALLS THE QUEUE', () => {
        const code = source(SENDER);

        expect(code).toContain("await import('@/lib/email-queue')");
        expect(code).toContain('await saveToQueue(');
        expect(code.match(/await queueForRetry\(/g) ?? []).toHaveLength(2);   // both branches
    });

    it('and saveToQueue is exported, which it was not', () => {
        expect(source(QUEUE)).toContain('export async function saveToQueue(');
    });

    it('COLLECTIONS.EMAIL_QUEUE now HAS a producer', () => {
        // The finding in one grep. Before this, the only writer was inside an
        // unimported module.
        const writers: string = execSync(
            "grep -rln 'EMAIL_QUEUE).add(' --include='*.ts' src || true",
            { encoding: 'utf-8' },
        );
        const files = writers.split('\n').filter(Boolean);

        expect(files).toContain('src/lib/email-queue.ts');

        // And that module is now reachable from the live sender.
        const reachable: string = execSync(
            "grep -rln \"@/lib/email-queue\" --include='*.ts' src | grep -v __tests__ || true",
            { encoding: 'utf-8' },
        );
        expect(reachable.split('\n').filter(Boolean)).toContain('src/lib/email-notifications.ts');
    });

    it('and it is the choke point the typed senders route through', () => {
        // Measured rather than asserted. This is the assertion that caught my
        // own wrong write-up: sendEmailNotification has no callers outside its
        // own module, and it did not need any — the send*Email helpers are its
        // callers, and the application calls those.
        const code = source(SENDER);
        const helpers = [...code.matchAll(/export async function (send\w+Email\w*)\(/g)].map((m) => m[1]);

        expect(helpers.length).toBeGreaterThanOrEqual(19);

        const routed = helpers.filter((h) => {
            const start = code.indexOf(`export async function ${h}(`);
            return code.slice(start, start + 3000).includes('sendEmailNotification(');
        });

        expect(routed.length).toBeGreaterThanOrEqual(17);
        expect(routed).toContain('sendPasswordResetEmail');
    });

    it('#394 CLOSED the scope this test used to record', () => {
        /**
         * This read "RECORDED: eight files bypass this module and import Resend
         * directly", and asserted there were at least five. That was the honest
         * scope of #354 and it is no longer the state of the codebase: #393 moved
         * the password reset onto this sender and #394 moved the other twelve,
         * so the bypass list is down to the modules that must own their own
         * client.
         *
         * The assertion is inverted rather than deleted. A number that could
         * only be at least five is now a named, closed set — which is a
         * stronger claim, and it fails if somebody adds a fourteenth bypass
         * back.
         */
        const direct = execSync(
            "grep -rln \"await import('resend')\" --include='*.ts' src | grep -v __tests__ || true",
            { encoding: 'utf-8' },
        ).split('\n').filter(Boolean).sort();

        expect(direct).toEqual([
            /**
             * NOT CONVERTED, AND NOT AN OVERSIGHT. This is a second BULK
             * sender: it calls resend.batch.send with its own chunking and its
             * own partial-failure count, which #187 and #219 both had to
             * repair. lib/email-notifications.ts already has
             * sendBatchEmailNotifications doing the same job, so these are two
             * doors — but folding one into the other means re-deriving the
             * delivered-vs-attempted counting that a previous finding got
             * wrong, and that is its own piece of work rather than a rider on
             * this one. Named here so it is a known item and not a gap.
             */
            'src/app/actions/admin-communications.ts',
            // The sender itself, and the two halves of the queue it feeds.
            'src/app/api/cron/process-email-queue/route.ts',
            'src/lib/email-notifications.ts',
            'src/lib/email-queue.ts',
        ]);

        // lib/mfa.ts holds a Resend client too, through a static import rather
        // than this dynamic one. It is deliberately outside the queue — a code
        // that expires in ten minutes must not be retried by a ten-minute cron
        // (#393) — and its own file records that.
        expect(readFileSync('src/lib/mfa.ts', 'utf-8')).toMatch(/#393/);
    });
});
