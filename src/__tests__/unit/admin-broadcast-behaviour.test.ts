/**
 * @jest-environment node
 */

/**
 * The broadcast and maintenance actions, EXECUTED.
 * admin-communications.ts was at 0%.
 *
 *   #187 BULK EMAIL COULD NOT SEND.
 *        The From header was built twice: `from: \`Easy Sales Export
 *        <${fromAddress}>\`` where fromAddress ALREADY holds a complete
 *        "Name <address>" string — its own default is
 *        'Easy Sales Export <info@easysalesexport.com>'. The header came out as
 *
 *            Easy Sales Export <Easy Sales Export <info@easysalesexport.com>>
 *
 *        which is not a valid address. Ten other EMAIL_FROM call sites in this
 *        codebase pass the variable straight through; this file alone wrapped it.
 *
 *   #188 AND REPORTED A DELIVERY COUNT IT HAD NOT ACHIEVED.
 *        It returned `emails.length` while the database row beside it recorded
 *        `successfulSends`, so on a partial failure the screen told the admin
 *        everyone had been reached and the history said otherwise.
 *
 *   #189 FOUR FILES GATED ON requireAdmin() RECORDED NOTHING.
 *        sms-broadcast, in-app-broadcast, maintenance and admin-communications —
 *        eighteen writes between them, including "message every member matching
 *        this filter" and a bulk rewrite of payment and wallet timestamps.
 *        in-app-broadcast was worse: its log row said `sentBy: "admin"`, a
 *        literal string, so the one question a broadcast log answers — WHICH
 *        admin sent this to everybody — it could not.
 *
 *   #190 AND THE RATCHET THAT EXISTS TO CATCH THAT COULD NOT SEE THEM.
 *        admin-action-audit-trail.test.ts matched `hasAdminPermission(` only.
 *        The same blind spot hid the dispute resolver until #157 changed its
 *        gate. requireAdmin() is in the pattern now — and widening it exposed a
 *        SECOND gap: the list of audit helpers was missing logAdminAction and
 *        logAdminFinancialAction, so five correctly-audited functions were
 *        reported as unrecorded. A gate that cries wolf gets switched off, so
 *        both halves are fixed together.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

const mockRequireAdmin = jest.fn(async () => ({ userId: 'admin-1' })) as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));

const batchSend = jest.fn(async () => ({ error: null })) as jest.Mock<any>;
jest.mock('resend', () => ({
    Resend: class { batch = { send: (...a: any[]) => batchSend(...a) }; emails = { send: jest.fn() }; },
}));

const getTargetedUsers = jest.fn(async () => ['a@e.com', 'b@e.com']) as jest.Mock<any>;
jest.mock('@/services', () => ({
    communicationsService: { getTargetedUsers: (...a: any[]) => getTargetedUsers(...a) },
}));

let store: FakeDbHandle;
const HISTORY = COLLECTIONS.EMAIL_HISTORY;

const comms = async () => await import('@/app/actions/admin-communications');

const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
};

const sendBulk = async (over: Record<string, string> = {}) =>
    (await comms()).sendBulkEmailAction(null as never, form({
        recipients: 'all', subject: 'Notice', body: '<p>Hello</p>', ...over,
    }) as never) as any;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' });
    batchSend.mockResolvedValue({ error: null });
    getTargetedUsers.mockResolvedValue(['a@e.com', 'b@e.com']);
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_FROM_EMAIL;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#187 — the From header', () => {
    it('SENDS A VALID FROM, NOT A NAME WRAPPED AROUND A NAME', async () => {
        await sendBulk();

        const [payload] = batchSend.mock.calls[0] as [any[]];
        expect(payload[0].from).toBe('Easy Sales Export <info@easysalesexport.com>');
        // The shape that could never be delivered.
        expect(payload[0].from).not.toMatch(/<.*<.*>.*>/);
    });

    it('passes a configured EMAIL_FROM through unchanged, like every other call site', async () => {
        process.env.EMAIL_FROM = 'Kusu Consult <hello@kusu.example>';

        await sendBulk();

        const [payload] = batchSend.mock.calls[0] as [any[]];
        expect(payload[0].from).toBe('Kusu Consult <hello@kusu.example>');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — the count the admin is shown', () => {
    it('reports what was delivered on a clean send', async () => {
        const res = await sendBulk();

        expect(res.success).toBe(true);
        expect(res.data.recipientCount).toBe(2);
        expect(res.data.attemptedCount).toBe(2);
    });

    it('DOES NOT CLAIM DELIVERY IT DID NOT ACHIEVE', async () => {
        getTargetedUsers.mockResolvedValue(
            Array.from({ length: 150 }, (_, i) => `u${i}@e.com`),
        );
        // 150 recipients is two chunks of 100/50; fail the first.
        batchSend
            .mockResolvedValueOnce({ error: { message: 'rate limited' } })
            .mockResolvedValueOnce({ error: null });

        const res = await sendBulk();

        expect(res.success).toBe(true);
        expect(res.data.attemptedCount).toBe(150);
        expect(res.data.recipientCount).toBe(50);      // NOT 150
        // And the history row agrees with what the caller was told.
        const [[, row]] = store.all(HISTORY);
        expect(row).toMatchObject({ recipientCount: 50, attemptedCount: 150, status: 'partial' });
    });

    it('fails outright when every chunk fails', async () => {
        batchSend.mockResolvedValue({ error: { message: 'provider down' } });

        expect(await sendBulk()).toMatchObject({ success: false });
        expect(store.size(HISTORY)).toBe(0);
    });

    it('refuses a caller who is not an admin', async () => {
        mockRequireAdmin.mockResolvedValue({ error: 'nope' });

        expect(await sendBulk()).toMatchObject({ success: false });
        expect(batchSend).not.toHaveBeenCalled();
    });

    it('requires all three fields', async () => {
        expect(await sendBulk({ subject: '' })).toMatchObject({ success: false });
        expect(batchSend).not.toHaveBeenCalled();
    });

    it('says so when the segment matches nobody', async () => {
        getTargetedUsers.mockResolvedValue([]);

        expect(await sendBulk()).toMatchObject({ success: false });
        expect(batchSend).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#189 — the broadcasts are recorded', () => {
    const auditCalls = () => (globalThis as any).mockRecordAdminAction.mock.calls.map(([e]: any[]) => e);

    it('records a bulk email against the admin who sent it', async () => {
        await sendBulk();

        expect(auditCalls()).toContainEqual(expect.objectContaining({
            action: 'broadcast_sent',
            userId: 'admin-1',
            targetType: 'email_broadcast',
        }));
    });

    it('carries the delivered and attempted counts into the audit row', async () => {
        await sendBulk();

        const entry = auditCalls().find((e: any) => e.targetType === 'email_broadcast');
        expect(entry.metadata).toMatchObject({ attempted: 2, delivered: 2, partial: false });
    });

    it('records an announcement, and writes both field vocabularies', async () => {
        const res = await (await comms()).createAnnouncementAction(null as never, form({
            title: 'Downtime', message: 'Back at 9', priority: 'high',
        }) as never) as any;

        expect(res.success).toBe(true);
        const [[, row]] = store.all(COLLECTIONS.ANNOUNCEMENTS);
        expect(row).toMatchObject({ title: 'Downtime', message: 'Back at 9', content: 'Back at 9' });

        expect(auditCalls()).toContainEqual(expect.objectContaining({
            action: 'announcement_created', userId: 'admin-1',
        }));
    });

    it('refuses an announcement from a non-admin', async () => {
        mockRequireAdmin.mockResolvedValue({ error: 'nope' });

        const res = await (await comms()).createAnnouncementAction(null as never, form({
            title: 'x', message: 'y', priority: 'high',
        }) as never) as any;

        expect(res.success).toBe(false);
        expect(store.size(COLLECTIONS.ANNOUNCEMENTS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#190 — the ratchet can see requireAdmin, and knows every audit helper', () => {
    const ratchetSource = () => require('fs').readFileSync(
        require('path').join(process.cwd(), 'src/__tests__/unit/admin-action-audit-trail.test.ts'),
        'utf8',
    );

    it('treats requireAdmin() as an admin gate', () => {
        expect(ratchetSource()).toContain('requireAdmin');
    });

    it('counts logAdminAction and logAdminFinancialAction as audit writes', () => {
        // Without these the ratchet reports _releaseEscrowAction — a money path
        // that records through logAdminFinancialAction, exactly as it should —
        // as unrecorded.
        const src = ratchetSource();
        expect(src).toContain('logAdminFinancialAction');
        expect(src).toContain('logAdminAction');
    });

    it('the four files it could not see now record something', () => {
        const fs = require('fs');
        const path = require('path');
        const AUDITS = /createAdminAuditLog|createAuditLog|logAuditAction|recordAdminAction|logAdminAction|logAdminFinancialAction/;

        for (const f of [
            'src/app/actions/sms-broadcast.ts',
            'src/app/actions/in-app-broadcast.ts',
            'src/app/actions/maintenance.ts',
            'src/app/actions/admin-communications.ts',
        ]) {
            expect(`${f}: ${AUDITS.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8'))}`)
                .toBe(`${f}: true`);
        }
    });

    it('the in-app broadcast log names the admin, not the string "admin"', () => {
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/actions/in-app-broadcast.ts'), 'utf8');
        expect(src).toContain('sentBy: authCheck.userId');
        // Comments stripped first: the fix's own note quotes the old line as the
        // record of what it replaced, and asserting over raw source would fail
        // on the explanation rather than on the code.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code).not.toContain('sentBy: "admin"');
    });
});
