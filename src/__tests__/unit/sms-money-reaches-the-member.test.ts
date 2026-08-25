/**
 * @jest-environment node
 */

/**
 *   #266 EVERY MONEY SMS THIS PLATFORM SENDS SAYS "?25,000".
 *
 *        The four SMS templates that quote an amount build it with
 *
 *            new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" })
 *
 *        which returns "₦25,000". U+20A6 is the naira sign, and it is not
 *        in the GSM-7 character set. sendSMS runs every message through
 *        sanitiseForGSM7 before dispatch, and that function's final rule is
 *
 *            .replace(/[^\x00-\x7F...]/g, ch => gsm7Extended.has(ch) ? ch : '?')
 *
 *        so the naira sign becomes a question mark. Measured, not inferred:
 *
 *            IN : EasySales: Escrow funds of ₦25,000 for order #1234 ...
 *            OUT: EasySales: Escrow funds of ?25,000 for order #1234 ...
 *
 *        A member is told their withdrawal of "?25,000" was approved, or that
 *        escrow of "?25,000" has been released. On a message about their own
 *        money, from a platform they are deciding whether to trust.
 *
 *        WHAT MAKES THIS ONE WORTH WRITING DOWN
 *
 *        The platform BUILT a tool for exactly this character class and wired
 *        it into the right place — sms-utils.ts, with a docstring naming em
 *        dashes and curly quotes, and findNonGSM7Chars feeding a live warning
 *        in the admin SMS composer. An admin who TYPES a naira sign is told
 *        about it before sending.
 *
 *        Every message the code builds skips that review entirely. The
 *        detector was pointed at the messages a human writes and not at the
 *        ones the application writes, and the application's are the ones that
 *        go out thousands of times.
 *
 *        The signal was there the whole time. sendSMS logs
 *        "Message contained non-GSM7 characters - sanitised before send" with
 *        the before and after on every single one of these, and nobody read it.
 *
 *        THE FIX IS IN TWO PLACES ON PURPOSE
 *
 *          sanitiseForGSM7   maps ₦ to "NGN" rather than "?". This is the
 *                            one that matters, because it also covers an admin
 *                            broadcast typed with a naira sign — the single
 *                            most likely character for a Nigerian admin to type
 *                            into a message about money.
 *          the templates     emit "NGN 25,000" directly, so the common path
 *                            reads as a person would write it rather than
 *                            relying on a rescue.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { sanitiseForGSM7, getSMSInfo, findNonGSM7Chars } from '@/lib/sms-utils';

const NAIRA = '₦';

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — the naira sign survives the GSM-7 gate', () => {
    it('IS NOT TURNED INTO A QUESTION MARK', () => {
        // The whole defect, at the one line that caused it.
        expect(sanitiseForGSM7(`${NAIRA}25,000`)).not.toContain('?');
        expect(sanitiseForGSM7(`${NAIRA}25,000`)).toBe('NGN25,000');
    });

    it('and what comes out is genuinely GSM-7, not merely different', () => {
        // "NGN" would be a pointless swap if it still forced UCS-2 — that is
        // the cost this whole module exists to avoid: 160 characters per SMS
        // becomes 70, so one message is billed as three.
        const out = sanitiseForGSM7(`EasySales: Your withdrawal of ${NAIRA}25,000 was approved.`);

        expect(getSMSInfo(out).isGSM7).toBe(true);
        expect(getSMSInfo(out).parts).toBe(1);
    });

    it('an admin broadcast typed with a naira sign goes out readable', () => {
        // The composer warns a human about it; nothing MADE it survive. This
        // is the path where a Nigerian admin writing about money reaches for
        // the obvious character.
        const typed = `Dear member, your contribution of ${NAIRA}5,000 is due on Friday.`;

        expect(sanitiseForGSM7(typed)).toBe('Dear member, your contribution of NGN5,000 is due on Friday.');
    });

    it('still replaces a character it has no reading for', () => {
        // Vacuity guard. A sanitiser that stopped replacing anything would
        // satisfy every assertion above and reintroduce the UCS-2 billing
        // problem this module was written for.
        expect(sanitiseForGSM7('emoji \u{1f600} here')).toContain('?');
    });

    it('and the characters it already handled are unchanged', () => {
        expect(sanitiseForGSM7('don’t — really…')).toBe("don't - really...");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — the composer names the character instead of a codepoint', () => {
    it('reports the naira sign by name, and says what it becomes', () => {
        // findNonGSM7Chars feeds the admin composer's warning list. Its
        // KNOWN_BAD table covered curly quotes and dashes; the naira sign fell
        // through to "U+20A6", which tells an admin nothing about what to do.
        const [found] = findNonGSM7Chars(`Pay ${NAIRA}500`);

        expect(found.char).toBe(NAIRA);
        expect(found.name.toLowerCase()).toContain('naira');
        expect(found.name).toContain('NGN');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — what the member actually receives', () => {
    const REAL_ENV = { ...process.env };
    let bodies: string[] = [];

    beforeEach(() => {
        jest.resetModules();
        bodies = [];
        process.env.AT_API_KEY = 'test-key';
        process.env.AT_USERNAME = 'sandbox';

        global.fetch = (async (_url: any, init: any) => {
            bodies.push(new URLSearchParams(init.body as string).get('message') ?? '');
            return {
                ok: true,
                json: async () => ({
                    SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success', messageId: 'm1' }] },
                }),
            };
        }) as any;
    });

    afterEach(() => {
        process.env = { ...REAL_ENV };
        jest.restoreAllMocks();
    });

    const at = async () => await import('@/lib/africastalking');

    it('THE WITHDRAWAL-APPROVED SMS QUOTES AN AMOUNT, NOT A QUESTION MARK', async () => {
        const res = await (await at()).smsWithdrawalApproved('+2348012345678', 25000);

        expect(res.success).toBe(true);
        // Was: "Your withdrawal request of ?25,000 has been approved".
        expect(bodies[0]).not.toContain('?25,000');
        expect(bodies[0]).toContain('NGN 25,000');
    });

    it('so does the escrow-released SMS', async () => {
        await (await at()).smsEscrowReleased('+2348012345678', 'ORD-77', 120_000);

        expect(bodies[0]).toContain('NGN 120,000');
        expect(bodies[0]).toContain('ORD-77');
    });

    it('and the withdrawal-rejected SMS, reason included', async () => {
        await (await at()).smsWithdrawalRejected('+2348012345678', 9_500, 'Bank details mismatch');

        expect(bodies[0]).toContain('NGN 9,500');
        expect(bodies[0]).toContain('Bank details mismatch');
    });

    it.each([
        ['smsWithdrawalApproved', 25000],
        ['smsEscrowReleased', 25000],
        ['smsWithdrawalRejected', 25000],
    ])('%s is billed as ONE segment', async (fn, amount) => {
        const mod: any = await at();
        await (fn === 'smsEscrowReleased'
            ? mod[fn]('+2348012345678', 'ORD-1', amount)
            : mod[fn]('+2348012345678', amount));

        const info = getSMSInfo(bodies[0]);
        expect({ fn, isGSM7: info.isGSM7 }).toEqual({ fn, isGSM7: true });
    });

    it('does not send at all without an API key, rather than pretending', async () => {
        // Vacuity guard for this whole block: if sendSMS had stopped
        // dispatching, every "does not contain ?" above would pass on an
        // empty array.
        delete process.env.AT_API_KEY;
        jest.resetModules();

        const res = await (await at()).smsWithdrawalApproved('+2348012345678', 1000);

        expect(res.success).toBe(false);
        expect(bodies).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#266 — no SMS template builds money with a currency symbol', () => {
    /**
     * A ratchet on the SMS senders. The templates are fixed, but the next one
     * written will reach for Intl currency formatting exactly as these four
     * did — it is the obvious thing to write, and it is right everywhere in
     * this codebase EXCEPT here.
     *
     * Scoped to files that actually dispatch SMS. Intl currency in an email
     * template or a UI string is correct and stays untouched.
     */
    const SMS_SENDERS = [
        'src/lib/africastalking.ts',
        'src/lib/marketplace-notifications.ts',
    ];

    function codeOnly(rel: string): string {
        return readFileSync(join(process.cwd(), rel), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((l) => !l.trim().startsWith('//'))
            .map((l) => l.replace(/\s\/\/.*$/, ''))
            .join('\n');
    }

    it('finds the senders, so the check below is not vacuous', () => {
        for (const f of SMS_SENDERS) {
            expect(codeOnly(f).length).toBeGreaterThan(200);
        }
    });

    it('NO SMS BODY CONTAINS A NAIRA SIGN', () => {
        const offenders = SMS_SENDERS
            .flatMap((f) => codeOnly(f).split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => line.includes(NAIRA))
            .map((o) => o.at);

        expect(offenders).toEqual([]);
    });

    it('africastalking.ts formats no money with Intl currency at all', () => {
        // Every string in that file IS an SMS body, so the rule is absolute
        // there and the scan can be exact.
        //
        // marketplace-notifications.ts is deliberately NOT held to this: it
        // builds in-app notifications AND one SMS from the same function, and
        // Intl currency is CORRECT for the notifications — they render HTML.
        // Banning it file-wide would be the easy check and the wrong one, the
        // same trade #265 caught me making with isAdmin(). That file's SMS
        // line is pinned separately below.
        const offenders = codeOnly('src/lib/africastalking.ts').split('\n')
            .map((line, i) => ({ at: `src/lib/africastalking.ts:${i + 1}`, line }))
            .filter(({ line }) => /style:\s*["']currency["']/.test(line))
            .map((o) => o.at);

        // Was: the three money templates.
        expect(offenders).toEqual([]);
        expect(codeOnly('src/lib/africastalking.ts')).toContain('formatNairaForSMS');
    });

    it('and the one SMS body in marketplace-notifications uses the helper', () => {
        // The seller was told escrow was funded with "?45,000" because this
        // line reused the `formatted` variable built for the in-app copy.
        const smsLine = codeOnly('src/lib/marketplace-notifications.ts')
            .split('\n')
            .find((l) => l.includes('EasySales: Escrow is funded with'));

        expect(smsLine).toBeDefined();
        expect(smsLine).toContain('formatNairaForSMS(');
        expect(smsLine).not.toContain('${formatted}');
    });

    it('and the formatter is the only definition of the SMS money format', () => {
        // The same one-rule-many-copies shape that produced #253, #256, #259,
        // #260, #262, #263 and #265. Named here so the next reader does not
        // add a second.
        const files = readdirSync(join(process.cwd(), 'src/lib'))
            .filter((f) => f.endsWith('.ts'))
            .filter((f) => readFileSync(join(process.cwd(), 'src/lib', f), 'utf-8')
                .includes('export function formatNairaForSMS'));

        expect(files).toEqual(['sms-utils.ts']);
    });
});
