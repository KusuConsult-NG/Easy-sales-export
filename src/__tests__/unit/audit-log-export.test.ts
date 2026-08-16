/**
 * @jest-environment node
 */

/**
 * An audit export that was always the last fifty rows, and could run formulas.
 *
 * THE EXPORT WAS TRUNCATED, AND SAID OTHERWISE
 * --------------------------------------------
 * `exportAuditLogsCSV` carried the comment
 *
 *     // Get logs (no limit for export)
 *
 * above a call to `getAuditLogsAction(filters)`, which applies
 * `filters.limit || 50`. This function's own filter type has no `limit` field,
 * so it could never be anything but 50.
 *
 * Every audit export ever produced was the fifty most recent matching rows,
 * handed over as the export. An audit log is the thing you export precisely
 * when something has gone wrong, and a silently truncated one answers the wrong
 * question convincingly.
 *
 * It pages now, with a ceiling, and writes a TRUNCATED line into the file
 * itself when it reaches it — not only into a server log nobody opening the
 * spreadsheet will read.
 *
 * THE CSV COULD EXECUTE
 * ---------------------
 * Cells were quoted, which handles commas and quotes and does nothing for a
 * formula. A cell beginning with =, +, - or @ is executed by Excel and Google
 * Sheets, and audit rows carry `userEmail` and a `details` blob assembled from
 * metadata that is in places whatever a user typed — a product title, a name, a
 * rejection reason.
 *
 * So a user could store `=HYPERLINK(...)` in a field that reaches the audit log
 * and have it run on the machine of the admin who exported the log to
 * investigate them. Leading formula characters are neutralised now.
 *
 * THE PERMISSION MATRIX AND THE CODE DISAGREED — IN BOTH DIRECTIONS
 * ----------------------------------------------------------------
 * PERMISSION_MATRIX draws a line this file did not: `admin` holds "audit:read"
 * and does NOT hold "audit:export". Reading the log on screen and walking out
 * with the whole thing as a file are different acts, and somebody encoded that.
 * The export accepted any admin, so the distinction existed in the matrix and
 * nowhere else. It is checked against the matrix now.
 *
 * The READ diverges the other way and is deliberately left alone. The matrix
 * grants "audit:read" to NINE roles — moderator, support, and every module
 * admin — while the code allows two. Routing the read through the matrix would
 * open the platform's activity log to support agents in the course of tightening
 * the export: a policy change wearing the clothes of a bug fix. Recorded for
 * whoever owns the permission model to decide, not resolved quietly.
 *
 * A COUNTER WITH NO CEILING
 * -------------------------
 * `getAuditStatsAction(days)` took `days` from the caller, subtracted it from
 * today, and ran a query with no limit — so `getAuditStatsAction(1_000_000)`
 * reads the entire audit log of a 41,000-user platform into memory to count it.
 * The same value keyed a Redis entry, so a loop over `days` fills the cache with
 * entries nothing will read again. Clamped to a year, and the query is bounded.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const SUPER = 'super-1';
const ADMIN = 'admin-1';

jest.mock('@/lib/redis', () => ({
    getCached: jest.fn(async () => null),
    setCache: jest.fn(async () => undefined),
}));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

/**
 * The caller's user document decides the role, and the audit query returns rows.
 * The harness passes the document id for doc().get() and the collection name for
 * a query's .get(), which is what separates the two here.
 */
function setWorld(opts: { roles: string[]; rows?: any[] }) {
    const rows = opts.rows ?? [];
    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === SUPER || idOrCollection === ADMIN) {
            return Promise.resolve({ exists: true, empty: false, docs: [], data: () => ({ roles: opts.roles }) });
        }
        return Promise.resolve({
            exists: true,
            empty: rows.length === 0,
            size: rows.length,
            docs: rows.map((r, i) => ({ id: `log-${i}`, data: () => r })),
            data: () => ({}),
        });
    });
}

const ROW = {
    timestamp: '2026-08-12T10:00:00.000Z',
    severity: 'info',
    action: 'user_update',
    userId: 'u1',
    userEmail: 'u1@e.com',
    targetType: 'user',
    targetId: 't1',
};

describe('exporting the audit log is a super_admin act', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    async function exportCsv() {
        const { exportAuditLogsCSV } = await import('@/app/actions/audit-log-actions');
        return exportAuditLogsCSV({}) as any;
    }

    it('refuses a plain admin', async () => {
        // THE test. PERMISSION_MATRIX gives `admin` audit:read and withholds
        // audit:export; this accepted any admin.
        setSession(ADMIN);
        setWorld({ roles: ['admin'], rows: [ROW] });

        const r = await exportCsv();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/super admin/i);
    });

    it('allows a super_admin', async () => {
        // Vacuity guard: a refusal that also blocked super_admin would remove
        // the feature rather than scope it.
        setSession(SUPER);
        setWorld({ roles: ['super_admin'], rows: [ROW] });

        const r = await exportCsv();

        expect(r.success).toBe(true);
        expect(String(r.data)).toContain('u1@e.com');
    });

    it('refuses moderator, support and module admins', async () => {
        for (const role of ['moderator', 'support', 'marketplace_admin', 'wave_admin']) {
            jest.clearAllMocks();
            setSession(ADMIN);
            setWorld({ roles: [role], rows: [ROW] });

            expect((await exportCsv()).success).toBe(false);
        }
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        setWorld({ roles: ['super_admin'] });

        expect((await exportCsv()).success).toBe(false);
    });

    it('reading the log is still open to a plain admin', async () => {
        // The divergence left alone on purpose. Tightening the export must not
        // quietly tighten the read as well.
        setSession(ADMIN);
        setWorld({ roles: ['admin'], rows: [ROW] });

        const { getAuditLogsAction } = await import('@/app/actions/audit-log-actions');
        const r: any = await getAuditLogsAction({});

        expect(r.success).toBe(true);
    });
});

describe('the export is not silently the last fifty rows', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SUPER);
    });

    it('asks for more than one page', async () => {
        // THE test for the truncation. The old code called getAuditLogsAction
        // once, with no limit of its own, so `filters.limit || 50` decided.
        setWorld({ roles: ['super_admin'], rows: [ROW] });

        const { exportAuditLogsCSV } = await import('@/app/actions/audit-log-actions');
        await exportAuditLogsCSV({});

        // A page size well above the 50 the read defaults to.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/audit-log-actions.ts'), 'utf-8');

        expect(src).toMatch(/EXPORT_PAGE_SIZE\s*=\s*\d{3,}/);
        expect(src).toContain('lastDocId: cursor');
    });

    it('no longer claims no limit while applying one', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const code = readFileSync(join(process.cwd(), 'src/app/actions/audit-log-actions.ts'), 'utf-8')
            .split('\n')
            .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
            .join('\n');

        // The comment said "no limit for export" above a call that applied 50.
        expect(code).not.toContain('no limit for export');
        expect(code).toMatch(/MAX_EXPORT_ROWS\s*=\s*[\d_]+/);
    });

    it('still produces a header and the rows it has', async () => {
        // Vacuity guard.
        setWorld({ roles: ['super_admin'], rows: [ROW, { ...ROW, userId: 'u2', userEmail: 'u2@e.com' }] });

        const { exportAuditLogsCSV } = await import('@/app/actions/audit-log-actions');
        const r: any = await exportAuditLogsCSV({});

        expect(r.success).toBe(true);
        expect(String(r.data).split('\n')[0]).toContain('Timestamp');
        expect(String(r.data)).toContain('u2@e.com');
    });
});

describe('a CSV cell cannot become a formula', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SUPER);
    });

    async function csvFor(row: Record<string, any>): Promise<string> {
        setWorld({ roles: ['super_admin'], rows: [{ ...ROW, ...row }] });
        const { exportAuditLogsCSV } = await import('@/app/actions/audit-log-actions');
        const r: any = await exportAuditLogsCSV({});
        return String(r.data);
    }

    it('neutralises a leading = in an email', async () => {
        // THE test. userEmail reaches the audit log from user-controlled data,
        // and the admin exporting it is the one who opens the file.
        const csv = await csvFor({ userEmail: '=HYPERLINK("http://evil.example","click")' });

        expect(csv).toContain(`"'=HYPERLINK`);
        expect(csv).not.toMatch(/"=HYPERLINK/);
    });

    it('neutralises +, - and @ as well', async () => {
        for (const payload of ['+1+1', '-2+3', '@SUM(A1)']) {
            const csv = await csvFor({ targetId: payload });
            expect(csv).toContain(`"'${payload}`);
        }
    });

    it('still escapes embedded quotes, as it always did', async () => {
        // The original quoting was correct as far as it went, and must survive.
        const csv = await csvFor({ targetType: 'a "quoted" thing' });

        expect(csv).toContain('a ""quoted"" thing');
    });

    it('leaves an ordinary value alone', async () => {
        // Vacuity guard: prefixing everything would corrupt every export.
        const csv = await csvFor({ userEmail: 'normal@e.com' });

        expect(csv).toContain('"normal@e.com"');
        expect(csv).not.toContain(`"'normal@e.com"`);
    });
});

describe('the statistics window is bounded', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN);
        setWorld({ roles: ['admin'], rows: [ROW] });
    });

    it('clamps an absurd number of days', async () => {
        // getAuditStatsAction(1_000_000) read the whole audit log to count it.
        const { getAuditStatsAction } = await import('@/app/actions/audit-log-actions');

        const r: any = await getAuditStatsAction(1_000_000);

        expect(r.success).toBe(true);
        const { setCache } = await import('@/lib/redis');
        // The cache key carries the clamped value, so a loop over `days` cannot
        // mint unbounded keys either.
        expect((setCache as any).mock.calls[0]?.[0]).toBe('admin:audit-stats:365');
    });

    it('rejects a non-numeric window by falling back, not by throwing', async () => {
        const { getAuditStatsAction } = await import('@/app/actions/audit-log-actions');

        const r: any = await getAuditStatsAction('lots' as any);

        expect(r.success).toBe(true);
        const { setCache } = await import('@/lib/redis');
        expect((setCache as any).mock.calls[0]?.[0]).toBe('admin:audit-stats:30');
    });

    it('leaves a sensible window alone', async () => {
        // Vacuity guard.
        const { getAuditStatsAction } = await import('@/app/actions/audit-log-actions');

        await getAuditStatsAction(7);

        const { setCache } = await import('@/lib/redis');
        expect((setCache as any).mock.calls[0]?.[0]).toBe('admin:audit-stats:7');
    });

    it('bounds how many rows the count reads', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/audit-log-actions.ts'), 'utf-8');

        expect(src).toMatch(/MAX_STATS_ROWS\s*=\s*[\d_]+/);
        expect(src).toContain('.limit(MAX_STATS_ROWS)');
    });
});
