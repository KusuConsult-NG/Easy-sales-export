/**
 * @jest-environment node
 */

/**
 * lib/email-notifications.ts, EXECUTED. It was at 25%.
 *
 *   #217 A MISSING API KEY WAS SILENT IN THE ONE PLACE IT MATTERS.
 *
 *        Both senders logged the missing RESEND_API_KEY behind
 *
 *            if (process.env.NODE_ENV !== 'production')
 *
 *        so in PRODUCTION a missing or revoked key made every email in the
 *        platform fail with no output at all. Every caller treats email as
 *        non-fatal — "Don't block success on email failure" appears verbatim in
 *        four of them — so nothing surfaced anywhere: membership approvals,
 *        rejections, password resets, briefing confirmations, withdrawal
 *        notifications, and the legacy welcome carrying a member's temporary
 *        PIN. All quietly undelivered, indefinitely, with the operator's only
 *        clue being that nobody was receiving anything.
 *
 *        The suppression was presumably meant to keep dev logs quiet. The send
 *        SUCCESS log is the one that should be dev-only, and it already was.
 *
 *   #218 THIRTY-THREE VALUES WENT INTO HTML RAW.
 *        Names, rejection reasons, product and window titles, a temporary PIN,
 *        invite and reset URLs. The boring consequence is the common one: a
 *        name like "Smith & Sons <Nigeria> Ltd" is an ordinary Nigerian
 *        business name and an ampersand followed by a tag that never closes, so
 *        whatever came after it in the markup was swallowed by the client. The
 *        other is that a rejection reason is free text an admin types and a
 *        member reads, inside an HTML document, with nothing in between.
 *
 *        escapeHtml already existed in lib/utils.ts and this file used none of
 *        it; reviews.ts was its only caller in the whole codebase.
 *
 *   #219 THE BATCH SENDER NEVER CHUNKED, WHICH ITS OWN DOC COMMENT CLAIMED.
 *        "Supports up to 100 emails in a single extremely fast API payload" —
 *        and then it handed the WHOLE array to resend.batch.send(). A caller
 *        passing 150 would get one rejected request and zero emails delivered.
 *        LATENT: its one caller chunks at 100 itself. The limit belongs with
 *        the function that has it rather than with every caller that has to
 *        remember it. A failing chunk no longer abandons the rest, and the
 *        count returned is what was ACCEPTED — the correction made to the other
 *        bulk sender in #188.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const emailsSend = jest.fn(async () => ({ data: { id: 'e1' }, error: null })) as jest.Mock<any>;
const batchSend = jest.fn(async () => ({ data: {}, error: null })) as jest.Mock<any>;

jest.mock('resend', () => ({
    Resend: class {
        emails = { send: (...a: any[]) => emailsSend(...a) };
        batch = { send: (...a: any[]) => batchSend(...a) };
    },
}));

const mail = async () => await import('@/lib/email-notifications');

/** The HTML of the single email that was sent. */
const sentHtml = (): string => (emailsSend.mock.calls[0] as any[])[0].html;

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.EMAIL_FROM;
    emailsSend.mockResolvedValue({ data: { id: 'e1' }, error: null });
    batchSend.mockResolvedValue({ data: {}, error: null });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: ORIGINAL_ENV, configurable: true });
});

const setNodeEnv = (v: string) =>
    Object.defineProperty(process.env, 'NODE_ENV', { value: v, configurable: true });

// ─────────────────────────────────────────────────────────────────────────────
describe('#217 — a missing API key is never silent', () => {
    beforeEach(() => { delete process.env.RESEND_API_KEY; });

    it('LOGS IN PRODUCTION, WHICH IS WHERE IT WAS SUPPRESSED', async () => {
        setNodeEnv('production');

        const res = await (await mail()).sendEmailNotification({
            to: 'a@e.com', subject: 'Hello', message: '<p>hi</p>',
        });

        expect(res).toMatchObject({ success: false });
        // Was: nothing, in production only.
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('RESEND_API_KEY not configured'),
        );
    });

    it('logs in development too', async () => {
        setNodeEnv('development');

        await (await mail()).sendEmailNotification({
            to: 'a@e.com', subject: 'Hello', message: '<p>hi</p>',
        });

        expect(console.error).toHaveBeenCalled();
    });

    it('the BATCH sender logs in production as well', async () => {
        setNodeEnv('production');

        const res = await (await mail()).sendBatchEmailNotifications([
            { to: 'a@e.com', subject: 'Hi', message: '<p>x</p>' },
        ]);

        expect(res).toMatchObject({ success: false, sent: 0 });
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('RESEND_API_KEY not configured'),
        );
    });

    it('does not attempt a send it cannot make', async () => {
        setNodeEnv('production');
        await (await mail()).sendEmailNotification({
            to: 'a@e.com', subject: 'Hello', message: '<p>hi</p>',
        });
        expect(emailsSend).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#218 — user-supplied values do not reach the markup raw', () => {
    const HOSTILE = '<script>alert(1)</script>';
    const ORDINARY = 'Smith & Sons <Nigeria> Ltd';

    it('ESCAPES A NAME THAT WOULD OTHERWISE BREAK THE EMAIL', async () => {
        await (await mail()).sendMembershipApprovalEmail('a@e.com', ORDINARY);

        const html = sentHtml();
        // Was: the raw name, so the client swallowed everything after "<Nigeria>".
        expect(html).toContain('Smith &amp; Sons &lt;Nigeria&gt; Ltd');
        expect(html).not.toContain('<Nigeria>');
    });

    it('ESCAPES A REJECTION REASON, which an admin types and a member reads', async () => {
        await (await mail()).sendMembershipRejectionEmail('a@e.com', 'Ada', HOSTILE);

        const html = sentHtml();
        expect(html).not.toContain(HOSTILE);
        expect(html).toContain('&lt;script&gt;');
    });

    it.each([
        ['sendWaveApplicationEmail', (m: any) => m.sendWaveApplicationEmail('a@e.com', HOSTILE, 'approved')],
        ['sendWaveApplicationEmail (rejected)', (m: any) => m.sendWaveApplicationEmail('a@e.com', 'Ada', 'rejected', HOSTILE)],
        ['sendWithdrawalApprovedEmail', (m: any) => m.sendWithdrawalApprovedEmail('a@e.com', HOSTILE, 100, 'w1')],
        ['sendWithdrawalRejectedEmail', (m: any) => m.sendWithdrawalRejectedEmail('a@e.com', HOSTILE, 100, 'because')],
        ['sendSellerApprovalEmail', (m: any) => m.sendSellerApprovalEmail('a@e.com', HOSTILE)],
        ['sendSellerRejectionEmail', (m: any) => m.sendSellerRejectionEmail('a@e.com', 'Ada', HOSTILE)],
        ['sendExportProductApprovalEmail', (m: any) => m.sendExportProductApprovalEmail('a@e.com', 'Ada', HOSTILE)],
        ['sendExportProductRejectionEmail', (m: any) => m.sendExportProductRejectionEmail('a@e.com', 'Ada', HOSTILE, 'r')],
        ['sendLegacyMemberWelcomeEmail', (m: any) => m.sendLegacyMemberWelcomeEmail('a@e.com', HOSTILE, '123456')],
        ['sendBriefingConfirmationEmail', (m: any) => m.sendBriefingConfirmationEmail('a@e.com', HOSTILE)],
    ])('%s escapes what it is given', async (_name, call) => {
        const m = await mail();
        await call(m);

        expect(emailsSend).toHaveBeenCalled();
        expect(sentHtml()).not.toContain(HOSTILE);
    });

    it('leaves the message legible — escaping, not stripping', async () => {
        await (await mail()).sendMembershipApprovalEmail('a@e.com', "O'Brien & Co");

        const html = sentHtml();
        expect(html).toContain('O&#039;Brien &amp; Co');
    });

    it('no template interpolates a bare identifier into HTML any more', () => {
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/email-notifications.ts'), 'utf8');
        // Comments stripped: the note added by this fix names the values it
        // escapes, and a raw scan would match the explanation.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

        const bare = [...code.matchAll(/\$\{([a-zA-Z][a-zA-Z0-9_.?]*)\}/g)].map((m) => m[1]);
        // The only survivors are values inside LOG strings, which never reach a
        // mail client. `context` joined them with #308: canSendEmail names which
        // message went undelivered, and that name is a literal chosen at each
        // call site — "loan decision email", "export decision email" — not
        // anything a user supplies.
        //
        // Kept as an explicit list rather than a rule about log lines, because a
        // rule would have to recognise a logger call and that is the sort of
        // inference this ratchet exists to avoid.
        expect([...new Set(bare)].sort()).toEqual(['context', 'emails.length', 'sent']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#219 — the batch sender chunks at the limit it documents', () => {
    const many = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            to: `u${i}@e.com`, subject: 'Hi', message: '<p>x</p>',
        }));

    it('SENDS 150 AS TWO REQUESTS, NOT ONE OVERSIZED ONE', async () => {
        const res = await (await mail()).sendBatchEmailNotifications(many(150));

        // Was: one call with 150 entries, rejected by Resend, zero delivered.
        expect(batchSend).toHaveBeenCalledTimes(2);
        expect((batchSend.mock.calls[0] as any[])[0]).toHaveLength(100);
        expect((batchSend.mock.calls[1] as any[])[0]).toHaveLength(50);
        expect(res).toMatchObject({ success: true, sent: 150 });
    });

    it('sends a single request when it fits', async () => {
        await (await mail()).sendBatchEmailNotifications(many(100));
        expect(batchSend).toHaveBeenCalledTimes(1);
    });

    it('A FAILED CHUNK DOES NOT ABANDON THE REST, and the count is what was accepted', async () => {
        batchSend
            .mockResolvedValueOnce({ error: { message: 'rate limited' } })
            .mockResolvedValueOnce({ data: {}, error: null });

        const res = await (await mail()).sendBatchEmailNotifications(many(150));

        expect(res.success).toBe(true);
        expect(res.sent).toBe(50);          // NOT 150
        expect(res.error).toContain('rate limited');
    });

    it('fails outright when every chunk fails', async () => {
        batchSend.mockResolvedValue({ error: { message: 'provider down' } });

        expect(await (await mail()).sendBatchEmailNotifications(many(120)))
            .toMatchObject({ success: false, sent: 0 });
    });

    it('passes the From header straight through, as every other call site does', async () => {
        process.env.EMAIL_FROM = 'Kusu Consult <hello@kusu.example>';

        await (await mail()).sendBatchEmailNotifications(many(1));

        const [payload] = batchSend.mock.calls[0] as [any[]];
        expect(payload[0].from).toBe('Kusu Consult <hello@kusu.example>');
        // The shape #187 could never deliver.
        expect(payload[0].from).not.toMatch(/<.*<.*>.*>/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getBaseUrl, executed', () => {
    const ORIGINAL_URL = process.env.NEXTAUTH_URL;
    afterEach(() => {
        if (ORIGINAL_URL === undefined) delete process.env.NEXTAUTH_URL;
        else process.env.NEXTAUTH_URL = ORIGINAL_URL;
    });

    it.each([
        ['https://easysalesexport.com', 'https://www.easysalesexport.com'],
        ['https://wave.easysalesexport.com', 'https://www.easysalesexport.com'],
        ['https://farmnation.ng', 'https://www.easysalesexport.com'],
        ['https://www.easysalesacademy.com', 'https://www.easysalesexport.com'],
        ['https://www.easysalesexport.com', 'https://www.easysalesexport.com'],
    ])('maps %s to the apex domain', async (input, expected) => {
        process.env.NEXTAUTH_URL = input;
        jest.resetModules();
        expect((await mail()).getBaseUrl()).toBe(expected);
    });

    it('strips a known subdomain on localhost', async () => {
        process.env.NEXTAUTH_URL = 'http://wave.localhost:3000';
        jest.resetModules();
        expect((await mail()).getBaseUrl()).toBe('http://localhost:3000');
    });

    it('never returns a trailing slash, which would double up in every link', async () => {
        process.env.NEXTAUTH_URL = 'https://www.easysalesexport.com/';
        jest.resetModules();
        expect((await mail()).getBaseUrl()).toBe('https://www.easysalesexport.com');
    });

    it('falls back rather than throwing on an unparseable value', async () => {
        process.env.NEXTAUTH_URL = 'not a url';
        jest.resetModules();
        expect((await mail()).getBaseUrl()).toBe('not a url');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the senders reach Resend with what they were given', () => {
    it('reports a Resend error rather than claiming success', async () => {
        emailsSend.mockResolvedValue({ data: null, error: { message: 'invalid recipient' } });

        expect(await (await mail()).sendEmailNotification({
            to: 'nope', subject: 'x', message: '<p>y</p>',
        })).toMatchObject({ success: false, error: 'invalid recipient' });
    });

    it('survives a thrown error rather than propagating it into the caller', async () => {
        emailsSend.mockRejectedValue(new Error('socket hang up'));

        expect(await (await mail()).sendEmailNotification({
            to: 'a@e.com', subject: 'x', message: '<p>y</p>',
        })).toMatchObject({ success: false, error: 'socket hang up' });
    });

    it('carries the metadata type through as a tag', async () => {
        await (await mail()).sendEmailNotification({
            to: 'a@e.com', subject: 'x', message: '<p>y</p>',
            metadata: { type: 'withdrawal_approved' },
        });

        expect((emailsSend.mock.calls[0] as any[])[0].tags)
            .toEqual([{ name: 'type', value: 'withdrawal_approved' }]);
    });

    it('sends the approval and rejection variants to the right address', async () => {
        const m = await mail();
        await m.sendWaveApplicationEmail('member@e.com', 'Ada', 'approved');

        const [payload] = emailsSend.mock.calls[0] as [any];
        expect(payload.to).toBe('member@e.com');
        expect(payload.subject).toMatch(/Approved/);
    });
});
