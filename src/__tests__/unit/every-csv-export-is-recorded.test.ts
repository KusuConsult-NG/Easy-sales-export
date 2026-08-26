/**
 * @jest-environment node
 */

/**
 *   #309 FOURTEEN ADMIN SCREENS BUILD A CSV. ONE OF THEM RECORDED IT.
 *
 *        Every one of these assembles a file and hands it to the browser. One
 *        wrote an audit row; thirteen did not:
 *
 *          academy/applications          logged
 *          ── and then ──
 *          marketplace/sellers           marketplace/buyers
 *          wave/members                  wave/applications
 *          wave/compliance               wave/registrations
 *          export/applications           farm-nation/applications
 *          farm-nation/land-verification cooperatives/transactions
 *          cooperatives/loans            finance
 *          audit-logs
 *
 *        THE COUNT WAS TWO UNTIL I READ THE SECOND ONE. cooperatives/loans calls
 *        getAdminLoanApplicationsExportAction, which sounds like the academy's
 *        logAcademyExportAction and is not: it checks the admin gate, reads up
 *        to 5,000 rows across two collections, joins each borrower's user record
 *        for bank name, account number and account name, and returns them. It
 *        writes no audit row anywhere. I had it in the "logged" column on the
 *        strength of the word "Export" in the name — which is exactly how the
 *        original defect stayed invisible, so it is pinned below by executing
 *        the action rather than by reading its name.
 *
 *        #146 and #147 established what several of those lists contain: BVN,
 *        NIN, bank account numbers and next of kin. export/applications puts
 *        the bank name and account number in the CSV by name. So the platform's
 *        most complete copies of members' identity data could be taken to a
 *        laptop with nothing recording that anybody had.
 *
 *        THE LAST ROW IS WORTH READING TWICE. The audit log itself can be
 *        exported, and that export was not audited.
 *
 *        This is #157's shape — "resolving a dispute moved escrow money and
 *        wrote nothing to the admin audit log" — at scale. It is also the
 *        complement of the open #64 decision: #64 asks WHO may export, and this
 *        asks whether anyone can tell that they did.
 *
 *        wave/members had TWO exports, the bulk list and a single member's
 *        card, and neither left a trace. Both are recorded now: one member is
 *        still a person's record leaving the platform.
 *
 * WHY THE DATASET NAME IS A CLOSED LIST
 * ------------------------------------
 * logAcademyExportAction — the one this generalises — already had to be fixed
 * once for taking its details from the caller behind a session check alone,
 * which let any signed-in user write entries into the record of who read
 * applicant data. Its comment states the principle: "A record anybody can write
 * to is not evidence." So the admin gate is kept AND the dataset is checked
 * against a fixed set, rather than written through.
 *
 * WHAT THIS CANNOT DO
 * -------------------
 * It cannot prevent an export. Every one of those handlers builds a Blob and
 * clicks an anchor before anything else runs; the file is in the browser by the
 * time any code could object. The honest goal is that the export leaves a
 * trace, and that a failure to leave one is visible rather than silent.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { EXPORTABLE_DATASETS } from '@/app/actions/data-export-audit';

/**
 * The setup file's mocks, not local ones.
 *
 * I wrote a local jest.mock('@/lib/audit-log') with three exports first, which
 * is the incomplete-mock trap jest.setup.js spends a paragraph on: any export
 * the module under test uses and the local factory omits is `undefined` at the
 * call site, throws inside the action's own catch, and reads as a defect in the
 * code. The loans export executed at the bottom of this file goes through
 * modules I have not enumerated, so the complete shared mocks are used.
 */
const mockAudit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;
const mockRequireSession = (globalThis as any).mockRequireSession as jest.Mock<any>;

let store: FakeDbHandle;
const ADMIN = 'admin-1';

/** Every admin page that assembles a CSV, found rather than listed. */
function csvScreens(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.tsx')) {
                const src = readFileSync(full, 'utf-8');
                if (src.includes('text/csv')) out.push(full.slice(process.cwd().length + 1));
            }
        }
    };
    walk(join(process.cwd(), 'src/app/admin'));
    return out.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#309 — every admin CSV leaves a trace', () => {
    /**
     * Derived, not hand-listed. A hand-written list of screens is exactly what
     * left twelve of fourteen unrecorded — the two that logged were the two
     * somebody happened to think of. This walks src/app/admin and finds them.
     */
    const SCREENS = csvScreens();

    it('THERE ARE FOURTEEN OF THEM, and the scan finds them', () => {
        // Guards the guard: if the walk stops matching, every assertion below
        // passes over an empty list.
        expect(SCREENS.length).toBeGreaterThanOrEqual(14);
        expect(SCREENS).toContain('src/app/admin/marketplace/sellers/page.tsx');
        expect(SCREENS).toContain('src/app/admin/audit-logs/page.tsx');
    });

    it('AND NOT ONE OF THEM EXPORTS WITHOUT RECORDING IT', () => {
        // The one that already logged uses its own module-specific action, which
        // predates the shared one and still writes a data_export row.
        const RECORDS = /recordExport\(|logAcademyExportAction|recordDataExportAction/;

        const silent = SCREENS.filter((f) => !RECORDS.test(readFileSync(join(process.cwd(), f), 'utf-8')));

        expect(silent).toEqual([]);
    });

    it('the one that already recorded is untouched', () => {
        // Nothing was migrated for tidiness. It was not the defect.
        const academy = readFileSync(join(process.cwd(), 'src/app/admin/academy/applications/page.tsx'), 'utf-8');
        expect(academy).toContain('logAcademyExportAction');
    });

    it('and the loans screen — which READ as recorded — records too', () => {
        // I had this in the "logged" column because its action is called
        // ...ExportAction. See the executed proof below for what that action
        // actually does.
        const src = readFileSync(join(process.cwd(), 'src/app/admin/cooperatives/loans/page.tsx'), 'utf-8');

        expect(src).toMatch(/recordExport\("cooperative_loans"/);
    });

    it('and wave/members records BOTH of its exports', () => {
        // It had two — the bulk list and one member's card — and neither was
        // recorded. A single member is still a person's record leaving.
        const src = readFileSync(join(process.cwd(), 'src/app/admin/wave/members/page.tsx'), 'utf-8');

        expect(src.match(/recordExport\(/g) ?? []).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#309 — the recording action, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        // resetModules does NOT clear recorded calls, so without this every
        // assertion on mock.calls[0] reads the FIRST test's call and the later
        // ones pass or fail for the wrong reason. Caught by exactly that.
        jest.clearAllMocks();
        store = installFakeDb();
        mockAudit.mockImplementation(() => Promise.resolve());
        mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: ADMIN, email: 'a@e.com', roles: ['super_admin'] } },
            error: null,
        }));
    });

    const record = async (dataset: string, details?: any) =>
        (await (await import('@/app/actions/data-export-audit'))
            .recordDataExportAction(dataset, details)) as any;

    it('writes a data_export row naming the admin and the dataset', async () => {
        const res = await record('marketplace_sellers', { count: 42, filters: { status: 'active' } });

        expect(res.success).toBe(true);
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'data_export',
            userId: ADMIN,
            targetId: 'marketplace_sellers',
            targetType: 'export',
        }));
    });

    it('carries the count and the filters, so a row says what was taken', async () => {
        await record('export_applications', { count: 7, filters: { status: 'approved' } });

        const arg: any = mockAudit.mock.calls[0]![0];
        expect(arg.metadata).toMatchObject({ dataset: 'export_applications', count: 7 });
        expect(arg.metadata.filters).toEqual({ status: 'approved' });
        expect(String(arg.details)).toContain('7');
    });

    it('REFUSES A DATASET IT DOES NOT KNOW, rather than filing it anyway', async () => {
        // A row against an arbitrary target reads as evidence and is not.
        const res = await record('anything_i_like', { count: 1 });

        expect(res.success).toBe(false);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('refuses a caller with no session, BY REFUSING rather than by crashing', async () => {
        mockRequireSession.mockImplementation(() => Promise.resolve({
            session: null, error: { error: 'Authentication required' },
        }));

        const res = await record('wave_members');

        expect(mockAudit).not.toHaveBeenCalled();
        // The reason matters, and asserting success:false alone did not check
        // it. Deleting the session check made this action read session.user off
        // null, throw, and land in its own catch — no audit row either way, so
        // a bare success:false assertion passed against a missing guard. It is
        // the returned message that tells the two apart.
        expect(res).toMatchObject({ success: false, error: 'Authentication required' });
    });

    it('and refuses a signed-in NON-ADMIN, which is the gate #64 asks about', async () => {
        mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'member-1', email: 'm@e.com', roles: ['user'] } },
            error: null,
        }));

        expect(await record('wave_members')).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('copes with a count that is not a number, rather than storing NaN', async () => {
        await record('audit_logs', { count: 'lots' as any });

        expect((mockAudit.mock.calls[0]![0] as any).metadata.count).toBeNull();
    });

    it('every dataset the screens name is one the action accepts', async () => {
        // Vacuity guard from the other side: a screen passing a name the action
        // rejects would log a refusal on every export and record nothing, which
        // is the original defect wearing a fix.
        const used = new Set<string>();
        for (const f of csvScreens()) {
            const src = readFileSync(join(process.cwd(), f), 'utf-8');
            for (const m of src.matchAll(/recordExport\("([a-z_]+)"/g)) used.add(m[1]!);
        }

        expect(used.size).toBeGreaterThan(0);
        for (const d of used) {
            expect({ d, known: (EXPORTABLE_DATASETS as readonly string[]).includes(d) })
                .toEqual({ d, known: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#309 — the action whose NAME said it recorded', () => {
    /**
     * Why this is executed rather than read.
     *
     * getAdminLoanApplicationsExportAction is where my count of "two logged"
     * came from, on nothing but the shape of the name. Reading it showed a data
     * fetch. But reading is what produced the wrong answer the first time, so
     * the claim is made by running it: seed a loan, call it as an admin, and
     * look at whether ANY audit row was written.
     *
     * If somebody later adds the audit row inside the action itself, this fails
     * — and that failure is correct. It says the browser-side recordExport on
     * the loans page is now a duplicate and one of the two should go.
     */
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        store = installFakeDb();
        mockAudit.mockImplementation(() => Promise.resolve());
        mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: ADMIN, email: 'a@e.com', roles: ['super_admin'] } },
            error: null,
        }));
    });

    it('reads borrowers AND THEIR BANK DETAILS, and writes no audit row at all', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'loan-1', {
            userId: 'member-1', amount: 50_000, status: 'approved',
            appliedAt: '2026-01-02T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.USERS, 'member-1', {
            fullName: 'Ada Obi',
            bankDetails: { bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi' },
        });

        const { getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');
        const res: any = await getAdminLoanApplicationsExportAction({ statusFilter: 'all' });

        // It hands back the account number — this is a PII export by any reading.
        expect(res.success).toBe(true);
        expect(res.data[0].accountNumber).toBe('0123456789');

        // And nothing anywhere recorded that it happened.
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('so the ONLY record of a loans export is the one the page now writes', () => {
        // Which is also the honest limit of the fix: the page records it, and
        // an export performed by calling the action directly still leaves no
        // trace. #64 — who may export at all — is the decision that closes that.
        const page = readFileSync(
            join(process.cwd(), 'src/app/admin/cooperatives/loans/page.tsx'), 'utf-8');

        expect(page).toMatch(/recordExport\("cooperative_loans", \{ count: rows\.length/);
    });

    it('AND THE BUTTON THAT REACHES IT IS COMMENTED OUT — recorded, not changed', () => {
        // handleExportCSV's only caller sits inside a block commented out with
        // "Temporarily removed Export CSV button". The handler is live code and
        // is wired, so it records whenever the button comes back. Restoring the
        // button is a product decision and is not mine to make; pinning it here
        // means the next person to uncomment it finds this note in the same
        // search rather than shipping an unrecorded PII export.
        const page = readFileSync(
            join(process.cwd(), 'src/app/admin/cooperatives/loans/page.tsx'), 'utf-8');

        expect(page).toContain('{/* Temporarily removed Export CSV button */}');
        expect(stripComments(page)).not.toContain('onClick={handleExportCSV}');
    });
});
