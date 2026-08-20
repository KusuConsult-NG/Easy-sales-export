/**
 * @jest-environment node
 */

/**
 * The audit log itself, EXECUTED. lib/audit-log.ts was at 0%.
 *
 * Worth saying why that matters here specifically: several fixes in this audit
 * (#129, #157, #159) are of the form "this action now records what it did". Every
 * one of them depends on the recorder underneath, and the recorder had never run
 * a line under test.
 *
 *   #176 A FAILED AUDIT WRITE FAILED THE OPERATION IT WAS RECORDING.
 *        createAdminAuditLog was an alias for createAuditLog, which rethrows.
 *        All 116 admin call sites await it inside the same try block as the work
 *        itself. admin/_withdrawals.ts is the clearest: it fires the Paystack
 *        transfer, marks the withdrawal completed, writes the global ledger row,
 *        notifies the member — and then logs. A throw there lands in the outer
 *        catch and returns "Failed to process withdrawal". The money has gone,
 *        the member has been told it is coming, and the admin is told it failed.
 *
 *        A previous pass found this and deferred it ("changing them is a
 *        behaviour change to working paths"). The behaviour being preserved was
 *        the bad one.
 *
 *   #177 purgeOldAuditLogs BUILT ONE BATCH OVER EVERY EXPIRED ROW.
 *        The audit log grows with every admin action and this is a scheduled job
 *        that may not have run for a while, so that batch can be the whole
 *        table — the commit most likely to time out, and an all-or-nothing one,
 *        so a failure purged nothing.
 *
 *   #178 logAuditAction FILED ACTIONS AGAINST "system" SILENTLY.
 *        `metadata?.adminId || metadata?.userId || 'system'` — a caller that
 *        forgot to pass an id produced a row indistinguishable from a genuine
 *        cron-job action, with the real actor lost. Same family as #129/#159.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

/**
 * THE REAL MODULE, not the global stub.
 *
 * jest.setup.js mocks '@/lib/audit-log' for the whole suite so that every other
 * test can assert on `global.mockCreateAdminAuditLog` without reaching a
 * database. That is right for them and useless here: this file is the one that
 * has to execute the recorder itself. Without this unmock, even
 * getSeverityForAction returns the stub's hardcoded 'info' and 25 of the 31
 * tests below fail against a module that never ran.
 */
jest.unmock('@/lib/audit-log');

const logged: Array<{ level: string; text: string }> = [];
jest.mock('@/lib/logger', () => ({
    logger: {
        info: (...a: unknown[]) => (global as any).__auditLog.push({ level: 'info', text: a.map(String).join(' ') }),
        warn: (...a: unknown[]) => (global as any).__auditLog.push({ level: 'warn', text: a.map(String).join(' ') }),
        error: (...a: unknown[]) => (global as any).__auditLog.push({ level: 'error', text: a.map(String).join(' ') }),
        debug: () => undefined,
    },
}));
(global as any).__auditLog = logged;

let store: FakeDbHandle;
const LOGS = 'audit_logs';

const auditLog = async () => await import('@/lib/audit-log');
const logText = () => logged.map((l) => `${l.level} ${l.text}`).join('\n');

beforeEach(() => {
    jest.clearAllMocks();
    logged.length = 0;
    store = installFakeDb();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#176 — a failed audit write does not fail the operation', () => {
    it('writes the row on the happy path', async () => {
        const { createAdminAuditLog } = await auditLog();

        await createAdminAuditLog({
            action: 'withdrawal_approve',
            userId: 'admin-1',
            targetId: 'wd-1',
            targetType: 'withdrawal',
            metadata: { notes: 'looks fine' },
        });

        expect(store.size(LOGS)).toBe(1);
        const [[, row]] = store.all(LOGS);
        expect(row).toMatchObject({
            action: 'withdrawal_approve', userId: 'admin-1', targetId: 'wd-1',
        });
    });

    it('DOES NOT THROW WHEN THE WRITE FAILS', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation((() => {
            throw new Error('audit_logs table is unavailable');
        }) as never);

        const { createAdminAuditLog } = await auditLog();

        // The whole point: the caller — which has already moved money — carries on.
        await expect(createAdminAuditLog({
            action: 'withdrawal_approve', userId: 'admin-1', targetId: 'wd-1',
        })).resolves.toBeUndefined();

        spy.mockRestore();
    });

    it('says so loudly, naming what went unrecorded', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation((() => {
            throw new Error('audit_logs table is unavailable');
        }) as never);

        const { createAdminAuditLog } = await auditLog();
        await createAdminAuditLog({
            action: 'withdrawal_approve', userId: 'admin-1',
            targetId: 'wd-1', targetType: 'withdrawal',
        });
        spy.mockRestore();

        const text = logText();
        expect(text).toContain('withdrawal_approve');
        expect(text).toContain('wd-1');
        expect(text).toContain('admin-1');
        // An operator reading this must not think the withdrawal failed.
        expect(text).toMatch(/OPERATION ITSELF SUCCEEDED/i);
    });

    it('createAuditLog still throws, for a caller that wants to know', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation((() => {
            throw new Error('down');
        }) as never);

        const { createAuditLog } = await auditLog();
        await expect(createAuditLog({ action: 'user_delete', userId: 'admin-1' }))
            .rejects.toThrow();

        spy.mockRestore();
    });

    it('recordAdminAction and createAdminAuditLog are the same function', async () => {
        const { recordAdminAction, createAdminAuditLog } = await auditLog();
        expect(createAdminAuditLog).toBe(recordAdminAction);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('severity is derived, not passed', () => {
    it.each([
        ['user_delete', 'critical'],
        ['escrow_refunded', 'critical'],
        ['loan_disbursed', 'critical'],
        ['data_export', 'critical'],
        ['mfa_disabled', 'critical'],
        ['payment_failed', 'warning'],
        ['loan_rejected', 'warning'],
        ['land_rejected', 'warning'],
        ['withdrawal_approve', 'info'],
        ['certificate_issued', 'info'],
    ])('%s is %s', async (action, severity) => {
        const { getSeverityForAction } = await auditLog();
        expect(getSeverityForAction(action as never)).toBe(severity);
    });

    it('stamps the derived severity onto the row', async () => {
        const { createAdminAuditLog } = await auditLog();
        await createAdminAuditLog({ action: 'user_delete', userId: 'admin-1' });

        expect(store.all(LOGS)[0][1]).toMatchObject({ severity: 'critical' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#177 — purging expired rows', () => {
    const seedLogs = (n: number, daysAgo: number, prefix = 'old') => {
        for (let i = 0; i < n; i++) {
            const d = new Date();
            d.setDate(d.getDate() - daysAgo);
            store.seed(LOGS, `${prefix}-${i}`, {
                action: 'user_update', userId: 'admin-1', severity: 'info',
                timestamp: d.toISOString(),
            });
        }
    };

    it('deletes rows past the retention window and keeps the rest', async () => {
        process.env.AUDIT_LOG_RETENTION_DAYS = '30';
        seedLogs(3, 60, 'expired');
        seedLogs(2, 5, 'recent');

        const { purgeOldAuditLogs } = await auditLog();
        const deleted = await purgeOldAuditLogs();

        expect(deleted).toBe(3);
        expect(store.size(LOGS)).toBe(2);
        expect(store.all(LOGS).map(([id]) => id).sort()).toEqual(['recent-0', 'recent-1']);
    });

    it('COMMITS IN CHUNKS, so a large backlog is not one all-or-nothing batch', async () => {
        // 900 rows across a 400-row chunk size is three commits, not one.
        seedLogs(900, 60, 'expired');

        const { supabaseDb } = await import('@/lib/supabase-db');
        const commits = jest.fn();
        const realBatch = supabaseDb.batch.bind(supabaseDb);
        const spy = jest.spyOn(supabaseDb, 'batch').mockImplementation((() => {
            const b: any = realBatch();
            const realCommit = b.commit.bind(b);
            b.commit = async () => { commits(); return realCommit(); };
            return b;
        }) as never);

        const { purgeOldAuditLogs } = await auditLog();
        const deleted = await purgeOldAuditLogs();
        spy.mockRestore();

        expect(deleted).toBe(900);
        expect(store.size(LOGS)).toBe(0);
        expect(commits.mock.calls.length).toBeGreaterThan(1);
    });

    it('returns zero rather than failing when nothing has expired', async () => {
        seedLogs(2, 1, 'recent');
        const { purgeOldAuditLogs } = await auditLog();
        expect(await purgeOldAuditLogs()).toBe(0);
        expect(store.size(LOGS)).toBe(2);
    });

    it('honours a configured retention window', async () => {
        process.env.AUDIT_LOG_RETENTION_DAYS = '365';
        seedLogs(2, 60, 'sixty-days');

        const { purgeOldAuditLogs } = await auditLog();
        // Sixty days is inside a one-year window, so nothing goes.
        expect(await purgeOldAuditLogs()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#178 — who an action is filed against', () => {
    it('uses the adminId from the metadata', async () => {
        const { logAuditAction } = await auditLog();

        await logAuditAction('seller_approved', 'seller-1', 'seller', { adminId: 'admin-7' });

        expect(store.all(LOGS)[0][1]).toMatchObject({ userId: 'admin-7' });
        expect(logText()).not.toMatch(/no adminId/);
    });

    it('WARNS WHEN IT HAS TO FALL BACK TO "system"', async () => {
        const { logAuditAction } = await auditLog();

        await logAuditAction('seller_approved', 'seller-1', 'seller', { note: 'no id here' });

        expect(store.all(LOGS)[0][1]).toMatchObject({ userId: 'system' });
        expect(logText()).toMatch(/no adminId or userId/i);
        expect(logText()).toContain('seller_approved');
    });

    it('still supports the legacy object signature', async () => {
        const { logAuditAction } = await auditLog();

        await logAuditAction({
            userId: 'user-1',
            action: 'contribution_made',
            resourceId: 'coop-1',
            resourceType: 'cooperative',
            details: 'monthly contribution',
        });

        expect(store.all(LOGS)[0][1]).toMatchObject({
            userId: 'user-1', action: 'contribution_made',
            targetId: 'coop-1', targetType: 'cooperative',
        });
    });

    it('never throws, whichever signature is used', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation((() => {
            throw new Error('down');
        }) as never);

        const { logAuditAction } = await auditLog();
        await expect(logAuditAction('seller_approved', 's1', 'seller', { adminId: 'a1' }))
            .resolves.toBeUndefined();
        await expect(logAuditAction({ userId: 'u1', action: 'contribution_made' }))
            .resolves.toBeUndefined();

        spy.mockRestore();
    });

    it('carries the security context onto the row', async () => {
        const { logAuditAction } = await auditLog();

        await logAuditAction('seller_approved', 's1', 'seller', { adminId: 'a1' }, {
            ipAddress: '10.0.0.9', userAgent: 'Firefox', deviceFingerprint: 'fp-1',
        });

        expect(store.all(LOGS)[0][1]).toMatchObject({
            ipAddress: '10.0.0.9', userAgent: 'Firefox',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the helpers the money paths use', () => {
    it('logFinancialAction records the amount alongside the action', async () => {
        const { logFinancialAction } = await auditLog();

        await logFinancialAction('loan_disbursed', 'admin-1', 250_000, 'loan-1', { tenor: 12 });

        expect(store.all(LOGS)[0][1]).toMatchObject({
            action: 'loan_disbursed',
            userId: 'admin-1',
            targetId: 'loan-1',
            targetType: 'financial_transaction',
            severity: 'critical',
        });
        expect((store.all(LOGS)[0][1] as any).metadata).toMatchObject({ amount: 250_000, tenor: 12 });
    });

    it('logAdminFinancialAction is the same helper under its other name', async () => {
        const { logFinancialAction, logAdminFinancialAction } = await auditLog();
        expect(logAdminFinancialAction).toBe(logFinancialAction);
    });

    it('getSecurityContextFromHeaders reads the proxy chain', async () => {
        const { getSecurityContextFromHeaders } = await auditLog();

        const headers = new Headers({
            'x-forwarded-for': '203.0.113.5, 10.0.0.1',
            'user-agent': 'Chrome',
        });

        expect(getSecurityContextFromHeaders(headers)).toEqual({
            ipAddress: '203.0.113.5', userAgent: 'Chrome',
        });
        expect(getSecurityContextFromHeaders()).toEqual({});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reading the log back', () => {
    const seed = (id: string, over: Record<string, unknown>) =>
        store.seed(LOGS, id, {
            action: 'user_update', userId: 'admin-1', severity: 'info',
            timestamp: new Date().toISOString(), ...over,
        });

    it('filters by user and by action', async () => {
        seed('a', { userId: 'admin-1', action: 'user_update' });
        seed('b', { userId: 'admin-2', action: 'user_update' });
        seed('c', { userId: 'admin-1', action: 'user_delete' });

        const { getAuditLogs } = await auditLog();

        expect((await getAuditLogs({ userId: 'admin-1' })).map((r) => r.id).sort()).toEqual(['a', 'c']);
        expect((await getAuditLogs({ action: 'user_delete' })).map((r) => r.id)).toEqual(['c']);
    });

    it('applies a limit', async () => {
        for (let i = 0; i < 5; i++) seed(`r${i}`, {});
        const { getAuditLogs } = await auditLog();
        expect(await getAuditLogs({ limit: 2 })).toHaveLength(2);
    });

    it('returns an empty list rather than failing when nothing matches', async () => {
        const { getAuditLogs } = await auditLog();
        expect(await getAuditLogs({ userId: 'nobody' })).toEqual([]);
    });
});
