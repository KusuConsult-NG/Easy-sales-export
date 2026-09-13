/**
 * @jest-environment node
 */

/**
 *   #694 THE PLATFORM RECORDS WHICH ADDRESSES BOUNCE AND KEPT SENDING TO THEM.
 *
 *   `api/webhooks/resend` carefully writes every `email.bounced` and
 *   `email.complained` into BOUNCED_EMAILS, keyed by address. Two readers
 *   consult it — the admin broadcast, and the bulk sender #395 established
 *   nothing reaches — and `broadcast-logic.ts` states the reason in its own
 *   words: "BOUNCED_EMAILS exists precisely because sender reputation matters
 *   here."
 *
 *   `sendEmailNotification` — the ONE path every transactional email takes,
 *   the thirteen #394 converted plus everything #688, #690 and #693 have since
 *   wired onto it — made no mention of bounces at all.
 *
 *   So the rule was enforced on the mail that goes out in thousands and not on
 *   the mail that goes out all day. This audit's dominant class again: a
 *   correct rule applied to some of the places it names.
 *
 * ── TWO COSTS, AND THE SECOND IS THE ONE THAT MATTERS HERE ──────────────────
 *
 *     REPUTATION. Continuing to send to a hard-bounced address is what degrades
 *     a sending domain, and that degradation reaches the broadcasts the
 *     existing check was written to protect.
 *
 *     "WE TOLD THE MEMBER" WAS FALSE. #688 and #690 have just made thirteen
 *     more decisions announce themselves by email. For an address that cannot
 *     receive, Resend accepts the send, sendEmailNotification returns
 *     `{ success: true }`, and the message arrives nowhere — the platform
 *     believing it has communicated something it has not. That is precisely the
 *     shape those findings exist to close, one layer down.
 *
 * ── A BOUNCE IS NOT A COMPLAINT ─────────────────────────────────────────────
 *
 *   The broadcast excludes on EITHER, and for bulk mail that is right: somebody
 *   who marked a newsletter as spam should not get the next one.
 *
 *   Transactional mail gets a different answer, deliberately. `email.bounced`
 *   means the address REFUSED the message — a loan decision sent there cannot
 *   arrive however much it is wanted. `email.complained` means it DID arrive
 *   and the person did not want that message; their bank details being wrong is
 *   still theirs to hear about.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

describe('#694 — the transactional sender consults the bounce list', () => {
    let sent: any[];
    let store: any;
    let COLLECTIONS: any;

    async function harness(apiKey: string | undefined = 'test-key') {
        jest.resetModules();
        sent = [];
        process.env.RESEND_API_KEY = apiKey as string;
        if (apiKey === undefined) delete process.env.RESEND_API_KEY;

        jest.doMock('resend', () => ({
            Resend: class {
                emails = { send: async (e: any) => { sent.push(e); return { data: { id: 'e1' }, error: null }; } };
            },
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        COLLECTIONS = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore').COLLECTIONS;
        return await import('@/lib/email-notifications');
    }

    const bounce = (email: string, reason: string) =>
        store.seed(COLLECTIONS.BOUNCED_EMAILS, email.toLowerCase(), {
            email: email.toLowerCase(), reason, source: 'webhook',
        });

    beforeEach(() => { jest.clearAllMocks(); });

    it('THE DEFECT: a hard-bounced address is not sent to', async () => {
        const mod = await harness();
        bounce('gone@example.com', 'email.bounced');

        const res = await mod.sendEmailNotification({
            to: 'gone@example.com', subject: 'Loan Approved', message: '<p>hi</p>',
        } as any);

        expect(sent).toEqual([]);
        expect(res.success).toBe(false);
        expect(String(res.error)).toContain('bounced');
    });

    it('AND A GOOD ADDRESS STILL RECEIVES', async () => {
        /*
         *   THE control, and it has to come first in spirit: a check that
         *   refused everything would satisfy the line above and silence every
         *   transactional email on the platform.
         */
        const mod = await harness();
        bounce('gone@example.com', 'email.bounced');

        const res = await mod.sendEmailNotification({
            to: 'ada@example.com', subject: 'Loan Approved', message: '<p>hi</p>',
        } as any);

        expect(res.success).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe('ada@example.com');
    });

    it('AND A SPAM COMPLAINT IS NOT A BOUNCE', async () => {
        /*
         *   The distinction this finding draws, asserted rather than described.
         *   A complaint means the message ARRIVED and was unwanted; the
         *   broadcast is right to exclude on it and a loan decision is not.
         */
        const mod = await harness();
        bounce('annoyed@example.com', 'email.complained');

        const res = await mod.sendEmailNotification({
            to: 'annoyed@example.com', subject: 'Your withdrawal', message: '<p>hi</p>',
        } as any);

        expect(res.success).toBe(true);
        expect(sent).toHaveLength(1);
    });

    it('AND THE ADDRESS IS MATCHED CASE-INSENSITIVELY', async () => {
        //   The webhook lowercases before writing; a caller passes whatever the
        //   member typed. Matching only the exact string would suppress nothing
        //   for half the platform.
        const mod = await harness();
        bounce('gone@example.com', 'email.bounced');

        const res = await mod.sendEmailNotification({
            to: 'GONE@Example.COM', subject: 'x', message: 'y',
        } as any);

        expect(res.success).toBe(false);
        expect(sent).toEqual([]);
    });

    it('AND A READ FAILURE SENDS ANYWAY, RATHER THAN SILENCING THE PLATFORM', async () => {
        /*
         *   Fails OPEN, deliberately. A missed suppression costs a little
         *   reputation; a suppression that fires on a database hiccup costs
         *   every transactional email until somebody notices — and nobody
         *   would, because every caller treats email as non-fatal (#394).
         */
        jest.resetModules();
        sent = [];
        process.env.RESEND_API_KEY = 'test-key';
        jest.doMock('resend', () => ({
            Resend: class {
                emails = { send: async (e: any) => { sent.push(e); return { data: { id: 'e1' }, error: null }; } };
            },
        }));
        jest.doMock('@/lib/supabase-db', () => ({
            getAdminDb: () => { throw new Error('database down'); },
            supabaseDb: {},
        }));

        const mod = await import('@/lib/email-notifications');
        const res = await mod.sendEmailNotification({
            to: 'ada@example.com', subject: 'x', message: 'y',
        } as any);

        expect(res.success).toBe(true);
        expect(sent).toHaveLength(1);
    });

    it('AND THE BOUNCE CHECK RUNS AFTER THE KEY CHECK, NOT BEFORE', () => {
        /*
         *   Order matters for what an operator reads. A platform with no
         *   RESEND_API_KEY should say so — that is the diagnosis #308 and #394
         *   were both about — rather than reporting a database lookup for an
         *   address it was never going to mail.
         */
        const src = code('src/lib/email-notifications.ts');
        const at = src.indexOf('export async function sendEmailNotification');
        const body = src.slice(at, src.indexOf('\n}', at));
        expect(body.indexOf('RESEND_API_KEY')).toBeGreaterThan(-1);
        expect(body.indexOf('isUndeliverable')).toBeGreaterThan(body.indexOf('RESEND_API_KEY'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#694 — and the rule reaches both doors now', () => {
    it('THE BROADCAST STILL EXCLUDES BOUNCED RECIPIENTS', () => {
        /*
         *   The half that already worked, pinned. This finding is that the rule
         *   reached one door of two; removing it from the door that HAD it
         *   would "fix" the asymmetry the wrong way round.
         */
        /*
         *   READ AS THE EXPRESSION THAT DOES THE WORK, not as the words.
         *
         *   The first version asserted that the file CONTAINED
         *   'COLLECTIONS.BOUNCED_EMAILS' and 'excludedBounced', and a mutant
         *   that deleted the lookup of the recipient's own address SURVIVED —
         *   because the second lookup (the slash-normalised spelling) and the
         *   counter were both still there. Satisfied by a different line than
         *   the one it was about, which is the trap this audit keeps meeting.
         */
        const route = code('src/app/api/admin/broadcast/send/route.ts');

        //   The recipient's address is looked up…
        expect(route).toMatch(
            /refs\.push\(db\.collection\(COLLECTIONS\.BOUNCED_EMAILS\)\.doc\(r\.email\.toLowerCase\(\)\)\)/);
        /*
         *   …and so is the spelling the webhook may have written instead —
         *   read from the RAW file.
         *
         *   That line is `r.email.toLowerCase().replace(/\//g, "_")`, and a
         *   comment stripper cannot tell a regex literal containing a slash
         *   from the start of a comment. Asserting it through the stripper
         *   failed on the stripper's own mangling — the trap
         *   strip-comments.test.ts keeps a list of twenty-one files for. The
         *   surrounding assertions go through the stripper, because for them
         *   prose is exactly what must not be matched.
         */
        const raw = readFileSync(join(ROOT, 'src/app/api/admin/broadcast/send/route.ts'), 'utf8');
        expect(raw).toContain('replace(/\\//g, "_")');
        //   …and the answer is what decides who is mailed.
        expect(route).toContain('const bouncedIds = new Set(');
        expect(route).toMatch(/const validChunk = chunk\.filter\(/);
        expect(route).toContain('excludedBounced++');
    });

    it('AND THE WEBHOOK STILL RECORDS WHAT IT HEARS', () => {
        //   The premise of the whole finding: if nothing wrote the list, the
        //   check above would be reading an empty collection for ever.
        const hook = code('src/app/api/webhooks/resend/route.ts');
        expect(hook).toContain('email.bounced');
        expect(hook).toContain('email.complained');
        expect(hook).toContain('COLLECTIONS.BOUNCED_EMAILS');
    });

    it('AND THE BULK PATH IS UNTOUCHED — it batches its own check', () => {
        /*
         *   Recorded so the per-send read is not mistaken for a cost on bulk.
         *   sendBatchEmailNotifications goes to resend.batch.send() and never
         *   through sendEmailNotification, and the broadcast checks its
         *   recipients in batches with getAll() before it gets there. Adding a
         *   read per recipient to a forty-thousand-address broadcast would have
         *   been a real regression; it does not happen.
         */
        const src = code('src/lib/email-notifications.ts');
        const at = src.indexOf('export async function sendBatchEmailNotifications');
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, src.indexOf('\n}', at));
        expect(body).toContain('batch');
        expect(body).not.toContain('isUndeliverable');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the sender stops checking the bounce list           KILLED
 *     every address is treated as undeliverable                       KILLED
 *     a spam complaint suppresses transactional mail too              KILLED
 *     the address is matched case-sensitively                         KILLED
 *     a read failure silences every transactional email               KILLED
 *     the bounce check runs before the missing-key check              KILLED
 *     the broadcast stops excluding bounced recipients                KILLED
 *       — SURVIVED the first time; see below
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword lib/bounced-address.ts's header                          SURVIVED ✓
 *
 * ── THE LAST ONE SURVIVED, AND TWICE FOR DIFFERENT REASONS ──────────────────
 *
 *   First because the assertion read the FILE for the words
 *   'COLLECTIONS.BOUNCED_EMAILS' and 'excludedBounced', and the mutant deleted
 *   only the lookup of the recipient's own address — the slash-normalised
 *   lookup and the counter were both still there. Satisfied by a different line
 *   than the one it was about.
 *
 *   Then, once narrowed to the expression that does the work, because that
 *   expression is `replace(/\//g, "_")` and it was being read THROUGH the
 *   comment stripper — which cannot tell a regex literal containing a slash
 *   from the start of a comment. strip-comments.test.ts keeps a list of
 *   twenty-one files mangled exactly that way; this is the trap met from the
 *   other side, in an assertion rather than in a subject. That one line is read
 *   raw now, and the assertions around it still go through the stripper,
 *   because for those prose is exactly what must not match.
 */
