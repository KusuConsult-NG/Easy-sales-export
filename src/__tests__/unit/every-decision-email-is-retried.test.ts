/**
 * @jest-environment node
 */

/**
 *   #394 THE THIRTEEN #393 LEFT ON THE LIST.
 *
 *        #393 moved the password reset onto the queued sender and recorded the
 *        rest as scope: fourteen files still built their own Resend client, so
 *        a refused or rate-limited approval, rejection, revision request or
 *        payment-recovery email was logged at best and gone at worst. This
 *        converts all of them but the one that must stay outside.
 *
 *   NINETEEN SEND SITES ACROSS THIRTEEN FILES — academy decisions and revision
 *   requests, export decisions and onboarding, land decisions, the legacy
 *   onboarding welcome, loan decisions, the marketplace badge, cooperative
 *   membership, the WAVE application, payment recovery, and the contact form.
 *
 *   WHAT THE MOVE HAD TO PRESERVE, AND WHY THE SENDER GREW TWO FIELDS
 *   -----------------------------------------------------------------
 *   Several of those send as "Easy Sales Export Academy" or "Easy Sales
 *   Cooperative" rather than the platform default, and the contact form sets a
 *   Reply-To so replies reach the person who wrote in. sendEmailNotification
 *   accepted neither, so a straight conversion would have rewritten the From
 *   line on academy mail and dropped the contact form's Reply-To — a behaviour
 *   change dressed as a refactor. Both are now part of EmailData, defaulted
 *   exactly as before, and both TRAVEL WITH THE QUEUE ROW: a first attempt sent
 *   as the Academy and a retry sent as the platform are two different emails to
 *   the person receiving them.
 *
 *   FIVE OF THE NINETEEN COULD NOT SEE A FAILURE AT ALL
 *   ---------------------------------------------------
 *   They were `await resend.emails.send({...})` with the result discarded.
 *   Resend RETURNS its errors rather than throwing them, so the surrounding
 *   try/catch never fired: a refused email was not logged, not retried, not
 *   noticed. All five now read the result.
 *
 *   AND ONE OF THOSE FIVE WAS WORSE THAN SILENT
 *   -------------------------------------------
 *   api/admin/finance/recovery-emails sent, then stamped recoveryEmailSentAt on
 *   the failed-payment row and reported "sent" to the admin — whether or not
 *   the message left. That stamp is what stops anybody chasing the payment
 *   again, so a failed send became a permanent record that the customer had
 *   been contacted. It now stamps only on success and reports a failure as an
 *   error.
 *
 *   WHAT IS DELIBERATELY STILL OUTSIDE
 *   ----------------------------------
 *   lib/mfa.ts — a ten-minute code against a ten-minute cron (#393).
 *   actions/admin-communications.ts — a second BULK sender using
 *   resend.batch.send with its own chunking and partial-failure counting, which
 *   #187 and #219 both had to repair. Folding it into
 *   sendBatchEmailNotifications means re-deriving that counting, and that is
 *   its own piece of work. Named in email-retry-queue-has-a-producer.test.ts
 *   so it is a known item rather than a gap.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the sender stops honouring a per-call From       KILLED
 *     the queue row drops the sender                   KILLED
 *     the cron ignores the row's sender                KILLED
 *     recovery-emails stamps before checking the send  KILLED
 *     a converted file goes back to its own client     KILLED
 *     reword a repair note, changing no behaviour      SURVIVED, as intended
 *
 *   The first one SURVIVED on the first run. The structural assertion checked
 *   that the sender CALLED its From resolver, and the mutant gutted the
 *   resolver's body — so the wiring held while the rule was gone. It is now
 *   covered by behaviour tests through the mocked client in
 *   email-notifications-behaviour.test.ts, which is where a rule about what
 *   reaches Resend belongs.
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
const QUEUE = join(SRC, 'lib/email-queue.ts');
const CRON = join(SRC, 'app/api/cron/process-email-queue/route.ts');

/** The thirteen files #393 recorded as scope and this one converted. */
const CONVERTED = [
    'app/actions/academy/_ac_admin_review.ts',
    'app/actions/academy/_ac_applications.ts',
    'app/actions/admin/_academy.ts',
    'app/actions/admin/_exports.ts',
    'app/actions/admin/_land.ts',
    'app/actions/admin/_legacy.ts',
    'app/actions/admin/_loans.ts',
    'app/actions/admin/_marketplace.ts',
    'app/actions/cooperative/_coop_admin_members.ts',
    'app/actions/export/_ex_onboarding.ts',
    'app/actions/wave/_wv_applications.ts',
    'app/api/admin/finance/recovery-emails/route.ts',
    'app/api/contact/route.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#394 — the scan can see', () => {
    it('THERE ARE FILES TO SCAN AND THE CONVERTED SET EXISTS', () => {
        expect(FILES.length).toBeGreaterThan(500);
        for (const rel of CONVERTED) {
            expect({ rel, exists: FILES.includes(join(SRC, rel)) }).toEqual({ rel, exists: true });
        }
    });

    it('and it reads CODE, not the notes explaining what was removed', () => {
        // Several converted files carry a repair note naming the call they
        // replaced. A raw scan would rediscover the tombstone — #383, #384,
        // #392 and the contact route's own rate-limit test, all in that trap.
        const loans = join(SRC, 'app/actions/admin/_loans.ts');
        expect(/emails\s*\.\s*send/.test(readFileSync(loans, 'utf-8'))).toBe(true);
        expect(/emails\s*\.\s*send/.test(code(loans))).toBe(false);
    });

    it('and it does NOT lean on the stripper for the file the stripper mangles', () => {
        /**
         * admin/_legacy.ts is #75's documented casualty: stripComments loses
         * whole regions of it, and strip-comments.test.ts records that. Running
         * the converted-set check through the stripper reported that file as
         * unconverted when it is converted — a false finding produced entirely
         * by the tool.
         *
         * So the check below is anchored on IMPORTS, read raw. An import line
         * is unambiguous, is not something a repair note contains, and does not
         * depend on the stripper being right about this file.
         */
        const legacy = readFileSync(join(SRC, 'app/actions/admin/_legacy.ts'), 'utf-8');
        expect(legacy).toContain('sendEmailNotification');
        expect(code(join(SRC, 'app/actions/admin/_legacy.ts'))).not.toContain('sendEmailNotification(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#394 — every decision email is on the queued path', () => {
    it('ALL THIRTEEN CALL THE SHARED SENDER AND NONE HOLDS A CLIENT', () => {
        /**
         * Anchored on IMPORT LINES, read raw, rather than on call sites read
         * through stripComments — see the note above about admin/_legacy.ts.
         * An import is a structural fact: a file that imports the sender and
         * imports no Resend client cannot be building one.
         */
        const stragglers = CONVERTED.filter((rel) => {
            const raw = readFileSync(join(SRC, rel), 'utf-8');
            const importsSender = /import \{[^}]*\bsendEmailNotification\b[^}]*\} from ["']@\/lib\/email-notifications["']/.test(raw);
            const importsResend = /import \{[^}]*\bResend\b[^}]*\} from ["']resend["']/.test(raw)
                || /await import\(["']resend["']\)/.test(raw);
            return !importsSender || importsResend;
        });
        expect(stragglers).toEqual([]);
    });

    it('and no send site anywhere discards its result', () => {
        // The five that did could not see a Resend failure at all: it is
        // RETURNED, not thrown, so the try/catch around them never fired.
        const discarded: string[] = [];
        // admin/_legacy.ts excluded: the stripper mangles it (#75), so its
        // stripped text cannot be scanned for anything. Its single send site
        // reads the result — `const { error: emailError } = await ...` — and
        // the import assertion above covers its conversion.
        const MANGLED = join(SRC, 'app/actions/admin/_legacy.ts');
        for (const p of FILES.filter((f) => f !== MANGLED)) {
            for (const m of code(p).matchAll(/(^|\n)[ \t]*await sendEmailNotification\(/g)) {
                void m;
                discarded.push(relative(ROOT, p));
            }
        }
        expect([...new Set(discarded)]).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#394 — a retry delivers the same email that failed', () => {
    it('THE SENDER HONOURS A PER-CALL FROM AND REPLY-TO', () => {
        const sender = code(SENDER);
        expect(sender).toContain('function senderFor(');
        expect(sender).toContain('from: senderFor(data)');
        expect(sender).toMatch(/replyTo: data\.replyTo/);
    });

    it('and both travel onto the queue row', () => {
        const sender = code(SENDER);
        const start = sender.indexOf('async function queueForRetry(');
        expect(start).toBeGreaterThan(-1);
        const body = sender.slice(start, start + 1200);
        expect(body).toContain('from: data.from');
        expect(body).toContain('replyTo: data.replyTo');

        const queue = code(QUEUE);
        expect(queue).toContain('from: data.from ?? null');
        expect(queue).toContain('replyTo: data.replyTo ?? null');
    });

    it('and the cron sends the row back out with them', () => {
        const cron = code(CRON);
        expect(cron).toContain('from: data.from || senderEmail');
        expect(cron).toMatch(/replyTo: data\.replyTo/);
    });

    it('and the academy senders kept their own From line', () => {
        // The specific thing a careless conversion would have lost.
        const academy = code(join(SRC, 'app/actions/academy/_ac_admin_review.ts'));
        expect(academy).toContain('Easy Sales Export Academy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#394 — a failed recovery email is not recorded as a sent one', () => {
    it('THE STAMP IS WRITTEN ONLY AFTER THE SEND SUCCEEDS', () => {
        const route = code(join(SRC, 'app/api/admin/finance/recovery-emails/route.ts'));

        const sendAt = route.indexOf('sendEmailNotification(');
        const guardAt = route.indexOf('if (!sent)');
        const stampAt = route.indexOf('recoveryEmailSentAt');

        expect(sendAt).toBeGreaterThan(-1);
        // The order is the finding: send, check, then stamp.
        expect(guardAt).toBeGreaterThan(sendAt);
        expect(stampAt).toBeGreaterThan(guardAt);
        // And a failure reaches the admin as an error rather than as "sent".
        expect(route).toMatch(/status: "error", reason: sendError/);
    });
});
