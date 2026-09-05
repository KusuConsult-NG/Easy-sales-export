/**
 * @jest-environment node
 */

/**
 *   #393 THE EMAIL THE RETRY QUEUE WAS BUILT FOR DID NOT GO THROUGH IT.
 *
 *   THE SWEEP
 *   ---------
 *   #391 counted callers of the marketplace notification helpers. This is the
 *   same count over the whole notification surface — admin-notifications,
 *   email-notifications, email-queue, notification-filter, sms-utils,
 *   africastalking and the notifications service. Six exports had no caller;
 *   two of those were the sweep's own blind spot and four were real:
 *
 *     sendEmailNotification            NOT an orphan — seventeen helpers in
 *                                      its own file call it, which a sweep
 *                                      that skips same-file callers cannot see
 *     notifyEscrowReleased             already settled in #391
 *     sendPasswordResetEmail           THE FINDING, below
 *     queueEmail                       superseded by #354's saveToQueue
 *     sendBriefing24HourReminderEmail  cannot be scheduled — no briefing date
 *                                      is stored anywhere
 *     smsBadgeGranted                  a spend decision, not a defect
 *
 *   Each of the last four is recorded at its own definition with the reason.
 *
 *   THE FINDING
 *   -----------
 *   #354 wired lib/email-queue behind sendEmailNotification so a failed send is
 *   queued and api/cron/process-email-queue retries it every ten minutes, five
 *   attempts. Its scope note named the payoff: "a network blip while a
 *   password-reset link was going out, lost that message with no second
 *   attempt."
 *
 *   The password reset did not come through there. actions/password-reset.ts
 *   built its own Resend client, so a provider error was logged, returned as a
 *   failure, and the message was gone — the exact loss the queue exists to
 *   prevent, on the exact email cited as the reason to prevent it. Two
 *   implementations of one email and the live one was outside the repair.
 *
 *   That email is the one a locked-out person is waiting for. It now routes
 *   through sendPasswordResetEmail, with the markup users already receive moved
 *   across unchanged, so a failure is queued. The token lives an hour and the
 *   cron drains every ten minutes, so a retry lands inside the window.
 *
 *   AND THE ONE THAT MUST NOT BE QUEUED
 *   -----------------------------------
 *   sendMFACode is the next direct sender and it is deliberately left alone.
 *   The code expires in MFA_OTP_EXPIRY_MINUTES, default 10, against a
 *   ten-minute cron — a queued code arrives at or after its own expiry, or
 *   worse, arrives stale after the user has already asked for another. The
 *   naive version of this repair ("route every email through the queue") would
 *   have shipped that.
 *
 *   SCOPE, STATED. Fourteen files still send through Resend directly. They are
 *   decision and approval notices whose loss is recoverable in-app, unlike an
 *   account-access email; converting them is a separate piece of work. The
 *   count is pinned below so it can go down and not up.
 *
 *   #394 DID THAT WORK. All thirteen are converted, so the assertion below is
 *   no longer a bound but a named set of one: lib/mfa.ts, which is outside the
 *   queue on purpose. The paragraph above is left as written because it was the
 *   scope of #393 and the record of what that commit did and did not cover.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline, alongside the
 *   #354 suite:
 *
 *     the reset goes back to its own Resend client        KILLED
 *     the queue hook is removed from the sender           KILLED
 *     the reset link goes back to a request header (#261) KILLED
 *     the MFA send is routed through the queued sender    KILLED
 *     reword a recorded reason, keeping the marker        SURVIVED, as intended
 *
 *   The fourth is the one worth noticing: this suite fails if somebody "fixes"
 *   MFA the way it would look right from a distance.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const SENDER = join(SRC, 'lib/email-notifications.ts');
const RESET = join(SRC, 'app/actions/password-reset.ts');
const MFA = join(SRC, 'lib/mfa.ts');
const QUEUE_CRON = join(SRC, 'app/api/cron/process-email-queue/route.ts');

/** Files that construct their own Resend client instead of using the sender. */
function directResendSenders(): string[] {
    return FILES
        .filter((p) => p !== SENDER && p !== join(SRC, 'lib/email-queue.ts') && p !== QUEUE_CRON)
        .filter((p) => /emails\s*\.\s*send\s*\(/.test(code(p)))
        .map((p) => relative(ROOT, p))
        .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#393 — the scan can see', () => {
    it('THERE ARE FILES TO SCAN AND A SENDER TO COMPARE AGAINST', () => {
        expect(FILES.length).toBeGreaterThan(500);
        expect(code(SENDER)).toContain('queueForRetry');
    });

    it('and it can tell a direct Resend sender from one that is not', () => {
        // Positive control both ways: MFA still sends directly by design, and
        // the password reset no longer does.
        expect(directResendSenders()).toContain('src/lib/mfa.ts');
        expect(directResendSenders()).not.toContain('src/app/actions/password-reset.ts');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#393 — a lost password-reset email gets a second attempt', () => {
    it('THE RESET ROUTES THROUGH THE SENDER THAT QUEUES ON FAILURE', () => {
        const reset = code(RESET);
        expect(reset).toContain('sendPasswordResetEmail(');
        // And it no longer holds a Resend client of its own — the whole point.
        expect(/new Resend\(/.test(reset)).toBe(false);
        expect(/emails\s*\.\s*send\s*\(/.test(reset)).toBe(false);
    });

    it('and the helper it calls really is on the queued path', () => {
        const sender = code(SENDER);
        const start = sender.indexOf('export async function sendPasswordResetEmail(');
        expect(start).toBeGreaterThan(-1);
        // The body routes through the choke point, which is what queues.
        expect(sender.slice(start, start + 3000)).toContain('sendEmailNotification(');
        expect(sender).toContain('await queueForRetry(');
    });

    it('and the reset still builds its link from the shared base URL (#261)', () => {
        // The #261 repair must survive this move: a reset link whose host comes
        // from a request header is an account takeover.
        const reset = code(RESET);
        expect(reset).toContain('getBaseUrl()');
        expect(/headers\(\)|x-forwarded-host|req\.headers/.test(reset)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#393 — the MFA code is deliberately NOT queued', () => {
    it('IT STILL SENDS DIRECTLY, AND THE FILE SAYS WHY', () => {
        // Asserted as a positive claim, not an absence. A queued second factor
        // would arrive at or after its own expiry — the default code life and
        // the cron interval are both ten minutes.
        const mfa = readFileSync(MFA, 'utf-8');
        expect(code(MFA)).toMatch(/emails\s*\.\s*send\s*\(/);
        expect(code(MFA)).not.toContain('sendEmailNotification(');
        expect(mfa).toMatch(/MFA_OTP_EXPIRY_MINUTES/);
        // The reason is written down, so this is a decision and not a gap.
        expect(mfa).toContain('#393');
    });

    it('and the two intervals that make it a bad idea are still what they were', () => {
        expect(readFileSync(MFA, 'utf-8')).toContain("MFA_OTP_EXPIRY_MINUTES || '10'");
        // If the queue's schedule changes, this assumption is worth re-reading.
        expect(readFileSync(QUEUE_CRON, 'utf-8')).toMatch(/ten-minute/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#393 — the remaining direct senders are counted, not forgotten', () => {
    it('THE LIST IS NOW A NAMED SET, NOT A COUNT', () => {
        /**
         * #394. This was `length <= 14` with a `> 5` vacuity guard, because
         * thirteen files still built their own Resend client and the honest
         * thing was to bound the number. They have all been converted, so a
         * bound is no longer the strongest available claim: the set is named,
         * and anything else appearing in it fails.
         *
         * The vacuity guard is gone with it — a named set cannot be satisfied
         * by a detector that has stopped seeing, because MFA has to be IN it.
         */
        expect(directResendSenders()).toEqual(['src/lib/mfa.ts']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#393 — the four unwired helpers each carry their reason', () => {
    it('EVERY ONE OF THEM SAYS WHY, WHERE IT IS DEFINED', () => {
        // Read RAW, deliberately: the claim under test is that a human reading
        // the file finds an explanation, and stripComments would erase exactly
        // the thing being asserted.
        const cases: Array<[string, string]> = [
            ['lib/email-notifications.ts', 'sendBriefing24HourReminderEmail'],
            ['lib/email-queue.ts', 'queueEmail'],
            ['lib/africastalking.ts', 'smsBadgeGranted'],
            ['lib/marketplace-notifications.ts', 'notifyEscrowReleased'],
        ];

        for (const [rel, name] of cases) {
            const raw = readFileSync(join(SRC, rel), 'utf-8');
            const at = raw.indexOf(name);
            expect({ file: rel, found: at > -1 }).toEqual({ file: rel, found: true });
            // The note sits immediately above the definition.
            const above = raw.slice(Math.max(0, at - 2000), at);
            expect({ file: rel, explained: /#39[13]|NO CALLER|no caller/.test(above) })
                .toEqual({ file: rel, explained: true });
        }
    });
});
