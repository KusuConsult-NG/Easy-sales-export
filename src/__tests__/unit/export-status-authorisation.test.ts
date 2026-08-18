/**
 * @jest-environment node
 */

/**
 * Two endpoints named updateExportStatusAction. One was hardened; the other,
 * which does strictly more, was not.
 *
 * Both act on EXPORT_WINDOWS, take the same four statuses, and are wired to
 * live UI:
 *
 *   export-status.ts        a FormData action. Used by StatusUpdateModal.
 *   export/_ex_windows.ts   positional arguments. Used by /admin/export, and
 *                           re-exported through the export barrel.
 *
 * The first was hardened in an earlier pass, and its own comment sets out why:
 *
 *     "completed" is a settlement statement. An owner could declare their own
 *     export finished without an admin ever seeing it.
 *
 *     Moving OUT of "completed" reopens a settled record. dashboard.ts sums
 *     windows in in_transit/delivered as the owner's Total Escrow, so the same
 *     call that reopens the record also puts the figure back.
 *
 * The second applied none of it. Any of the four statuses could be set from any
 * other, by the window's owner as readily as by an admin — and that endpoint
 * does more than write a field. On "completed" it emails every investor a
 * statement of their returns and marks every one of their slots completed. So an
 * owner could settle their own export, tell every investor it had paid out, and
 * close their slots, with no admin involved.
 *
 * Two further divergences: it read roles from the session TOKEN rather than the
 * database, and it did not recognise `export_admin` at all — so a genuine export
 * administrator was refused by one endpoint and allowed by the other.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    refuseExportStatusChange,
    hasExportAdminAccess,
    normaliseExportWindowStatus,
    EXPORT_WINDOW_STATUSES,
    EXPORT_ADMIN_ROLES,
} from '@/lib/export-window-status';

const WINDOWS = 'src/app/actions/export/_ex_windows.ts';
const STATUS = 'src/app/actions/export-status.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const owner = (over: Partial<Parameters<typeof refuseExportStatusChange>[0]> = {}) => ({
    callerId: 'u1',
    callerRoles: [] as string[],
    ownerId: 'u1',
    currentStatus: 'in_transit',
    newStatus: 'delivered',
    ...over,
});

describe('the rule', () => {
    it('lets an owner move their export along', () => {
        expect(refuseExportStatusChange(owner())).toBeNull();
        expect(refuseExportStatusChange(owner({ currentStatus: 'pending', newStatus: 'in_transit' }))).toBeNull();
    });

    it('but does NOT let them settle it', () => {
        // THE test. This is the call that also emails every investor.
        const refusal = refuseExportStatusChange(owner({ newStatus: 'completed' }));

        expect(refusal).toBe('Only an administrator can mark an export completed');
    });

    it('and does not let them reopen a settled one', () => {
        const refusal = refuseExportStatusChange(
            owner({ currentStatus: 'completed', newStatus: 'in_transit' })
        );

        expect(refusal).toBe('This export is completed and can only be changed by an administrator');
    });

    it('refuses a stranger outright', () => {
        expect(refuseExportStatusChange(owner({ ownerId: 'someone-else' })))
            .toBe('Unauthorized to update this export');
    });

    it('and refuses a status that is not one of the four', () => {
        for (const bad of ['shipped', 'COMPLETE', '', null, undefined, 'released']) {
            expect(refuseExportStatusChange(owner({ newStatus: bad }))).toBe('Invalid status value');
        }
    });

    it('while an admin keeps full control in both directions', () => {
        for (const role of EXPORT_ADMIN_ROLES) {
            expect(refuseExportStatusChange(owner({
                callerId: 'admin-1', ownerId: 'u1', callerRoles: [role], newStatus: 'completed',
            }))).toBeNull();

            expect(refuseExportStatusChange(owner({
                callerId: 'admin-1', ownerId: 'u1', callerRoles: [role],
                currentStatus: 'completed', newStatus: 'in_transit',
            }))).toBeNull();
        }
    });

    it('including export_admin, which one endpoint did not recognise', () => {
        expect(hasExportAdminAccess(['export_admin'])).toBe(true);
        expect(hasExportAdminAccess(['admin'])).toBe(true);
        expect(hasExportAdminAccess(['super_admin'])).toBe(true);
        expect(hasExportAdminAccess(['exporter'])).toBe(false);
        expect(hasExportAdminAccess([])).toBe(false);
        expect(hasExportAdminAccess(undefined)).toBe(false);
    });

    it('and normalises the four statuses without inventing a fifth', () => {
        expect([...EXPORT_WINDOW_STATUSES]).toEqual(['pending', 'in_transit', 'delivered', 'completed']);
        expect(normaliseExportWindowStatus(' Delivered ')).toBe('delivered');
        expect(normaliseExportWindowStatus('released')).toBeNull();
    });
});

describe('both endpoints apply it', () => {
    it.each([
        ['the positional one', WINDOWS],
        ['the FormData one', STATUS],
    ])('%s calls refuseExportStatusChange', (_label: string, rel: string) => {
        expect(code(rel)).toContain('refuseExportStatusChange({');
    });

    it('reading roles from the database, not from the session token', () => {
        // A token keeps its roles until it refreshes, and this decides who may
        // change a record the dashboard reads as escrow.
        for (const rel of [WINDOWS, STATUS]) {
            const src = code(rel);
            expect(src).toContain('COLLECTIONS.USERS).doc(session.user.id).get()');
            expect(src).toContain('callerDoc.data()?.roles');
        }
    });

    it('and the positional one no longer trusts session.user.roles for it', () => {
        const src = code(WINDOWS);
        const fn = src.slice(src.indexOf('export async function updateExportStatusAction'));
        const body = fn.slice(0, fn.indexOf('\nexport async function '));

        expect(body).not.toContain('session.user.roles?.includes("admin")');
    });

    it('refusing before the status is written', () => {
        for (const rel of [WINDOWS, STATUS]) {
            const src = code(rel);
            const refuse = src.indexOf('refuseExportStatusChange({');
            const write = src.indexOf('exportRef.update({ status: newStatus');

            expect(refuse).toBeGreaterThan(-1);
            expect(write).toBeGreaterThan(refuse);
        }
    });

    it('and before the investor emails go out', () => {
        // The reason this endpoint mattered more than its sibling.
        const src = code(WINDOWS);
        const refuse = src.indexOf('refuseExportStatusChange({');
        const emails = src.indexOf('sendExportWindowCompleteEmail');

        expect(emails).toBeGreaterThan(refuse);
    });

    it('which really do fire on completion, and close the slots', () => {
        // Vacuity guard: without this the ordering assertion protects nothing.
        const src = code(WINDOWS);

        expect(src).toContain('if (newStatus === "completed")');
        expect(src).toContain('sendExportWindowCompleteEmail');
        expect(src).toContain('slotDoc.ref.update({ status: "completed"');
    });

    it('and neither keeps its own copy of the status list', () => {
        for (const rel of [WINDOWS, STATUS]) {
            expect(code(rel)).not.toContain('["pending", "in_transit", "delivered", "completed"]');
        }
    });
});
