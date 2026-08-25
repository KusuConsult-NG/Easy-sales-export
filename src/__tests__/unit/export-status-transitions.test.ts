/**
 * @jest-environment node
 */

/**
 * export-status.ts — 67 lines, one endpoint, and in better shape than most.
 *
 * It validates the status against a whitelist before writing it — the check
 * export-admin.ts was missing until #112 — and it verifies ownership. The
 * findings here are smaller than in the files audited before it, and are
 * described that way rather than inflated.
 *
 * WHAT WAS WRONG
 * --------------
 * Any of the four statuses could be set from any other, by the window's OWNER
 * as readily as by an admin. Two consequences worth separating:
 *
 *   "completed" is a settlement statement, and an owner could declare their own
 *   export finished without an admin ever seeing it.
 *
 *   Moving OUT of "completed" reopens a settled record — and dashboard.ts sums
 *   windows in in_transit/delivered as that user's Total Escrow, so the same
 *   call that reopens the record also puts the figure back.
 *
 * Roles were also read from `session.user.roles`, so a token kept its access
 * until it refreshed — the stale-JWT pattern fixed for admin-content.ts in #114,
 * on an endpoint that decides who may change a record the dashboard reads as
 * escrow.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * A full state machine. Which transitions are legal in the middle of the flow —
 * whether delivered may return to in_transit, say — is a wider question than
 * this function should answer alone. That is the same line drawn for export
 * order status in #112, and drawing it differently here would be inconsistent
 * for no reason beyond that this file was audited later.
 *
 * Admins keep full control in both directions, because correcting a mistake is
 * exactly what they are for.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';
const EXPORT_ID = 'window-1';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p), createAdminAuditLog: jest.fn(async () => ({})) }));

function setCaller(id: string, dbRoles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        // The session deliberately carries NO roles: the endpoint should read
        // them from the database, and a fixture that supplied them here could
        // not tell the two implementations apart.
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
    (global as any).__dbRoles = dbRoles;
}

function setWindow(status: string, ownerId: string = OWNER, exists = true) {
    (global as any).mockFirestoreGet.mockImplementation((id: string) => {
        if (id === EXPORT_ID) {
            return Promise.resolve(
                exists
                    ? { exists: true, empty: false, docs: [], data: () => ({ userId: ownerId, status }) }
                    : { exists: false, empty: true, docs: [], data: () => undefined }
            );
        }
        // The caller's user document, for the live role read.
        return Promise.resolve({
            exists: true, empty: false, docs: [],
            data: () => ({ roles: (global as any).__dbRoles ?? [] }),
        });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ userId: ownerId, status }),
    }));
}

function statusWritten(): string | undefined {
    return (global as any).mockFirestoreUpdate.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .find((p: any) => p && 'status' in p)?.status;
}

function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

async function setStatus(status: string, exportId = EXPORT_ID) {
    const { updateExportStatusAction } = await import('@/app/actions/export-status');
    return updateExportStatusAction(
        { success: true, error: null, data: null } as any,
        form({ exportId, status })
    );
}

describe('an owner moves their export along, but does not settle it', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(OWNER, ['exporter']);
        setWindow('in_transit');
    });

    it('refuses an owner marking their own export completed', async () => {
        // THE test. "completed" is a settlement statement about somebody else's
        // obligation.
        const r: any = await setStatus('completed');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/administrator/i);
        expect(statusWritten()).toBeUndefined();
    });

    it('refuses an owner reopening a completed export', async () => {
        // dashboard.ts sums in_transit/delivered windows as that user's Total
        // Escrow, so reopening the record also restores the figure.
        setWindow('completed');

        const r: any = await setStatus('in_transit');

        expect(r.success).toBe(false);
        expect(statusWritten()).toBeUndefined();
    });

    it('still lets an owner move pending to in_transit', async () => {
        // Vacuity guard. Refusing every owner transition would take the feature
        // away rather than secure it.
        setWindow('pending');

        const r: any = await setStatus('in_transit');

        expect(r.success).toBe(true);
        expect(statusWritten()).toBe('in_transit');
    });

    it('still lets an owner mark delivered', async () => {
        const r: any = await setStatus('delivered');

        expect(r.success).toBe(true);
        expect(statusWritten()).toBe('delivered');
    });
});

describe('an admin keeps full control', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(ADMIN, ['export_admin']);
        setWindow('in_transit', OWNER);
    });

    it('marks an export completed', async () => {
        const r: any = await setStatus('completed');

        expect(r.success).toBe(true);
        expect(statusWritten()).toBe('completed');
    });

    it('reopens a completed export, because correcting a mistake is the job', async () => {
        setWindow('completed', OWNER);

        const r: any = await setStatus('in_transit');

        expect(r.success).toBe(true);
        expect(statusWritten()).toBe('in_transit');
    });

    it('updates an export they do not own', async () => {
        // The pre-existing admin bypass on the ownership check.
        setWindow('pending', OWNER);

        const r: any = await setStatus('delivered');

        expect(r.success).toBe(true);
    });
});

describe('roles come from the database, not the token', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses a caller whose token would say admin but whose record does not', async () => {
        // The session in this fixture never carries roles; the record decides.
        // A stale JWT used to be enough to settle an export.
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: STRANGER, email: 's@e.com', roles: ['export_admin'] } },
            error: null,
        }));
        (global as any).mockFirestoreGet.mockImplementation((id: string) =>
            Promise.resolve(
                id === EXPORT_ID
                    ? { exists: true, empty: false, docs: [], data: () => ({ userId: OWNER, status: 'in_transit' }) }
                    : { exists: true, empty: false, docs: [], data: () => ({ roles: ['exporter'] }) }
            )
        );

        const r: any = await setStatus('completed');

        expect(r.success).toBe(false);
        expect(statusWritten()).toBeUndefined();
    });
});

describe('the checks that were already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(OWNER, ['exporter']);
        setWindow('pending');
    });

    it('refuses a status outside the whitelist', async () => {
        // export-admin.ts took a free string until #112; this file already
        // validated. Asserted so it stays that way.
        const r: any = await setStatus('shiped');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/invalid status/i);
        expect(statusWritten()).toBeUndefined();
    });

    it('refuses a caller who neither owns the export nor administers it', async () => {
        setCaller(STRANGER, ['exporter']);
        setWindow('pending', OWNER);

        const r: any = await setStatus('delivered');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });

    it('refuses an export window that does not exist', async () => {
        setWindow('pending', OWNER, false);

        const r: any = await setStatus('delivered');

        expect(r.success).toBe(false);
        expect(statusWritten()).toBeUndefined();
    });

    it('refuses a missing export id', async () => {
        const r: any = await setStatus('delivered', '');

        expect(r.success).toBe(false);
    });
});
