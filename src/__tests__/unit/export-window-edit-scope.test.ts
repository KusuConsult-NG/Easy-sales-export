/**
 * @jest-environment node
 */

/**
 * The window edit form could write the money counters and settle the window.
 *
 * updateExportWindowAction spreads whatever the caller sends into the export
 * window document, deleting only id/createdAt/updatedAt. Three groups of fields
 * belong to code that holds a lock or performs side effects, and writing them
 * through this endpoint silently skips it:
 *
 *   fundedAmount / currentFunding / currentVolume / spotsFilled
 *     Maintained by incrementWithinCeiling (migration 015), which locks the row
 *     and checks the ceiling in one statement. A plain write desyncs the
 *     counters from the payments and bookings that produced them, and the
 *     desync is invisible — nothing recomputes them from the ledger.
 *
 *   status
 *     updateExportStatusAction applies refuseExportStatusChange AND, on
 *     "completed", emails every investor a statement of their returns and marks
 *     every one of their slots completed. Setting it here settles a window with
 *     none of that happening — so investors are never told, and their slots stay
 *     open against a window that is finished.
 *
 *   userId / createdBy
 *     Ownership. refuseExportStatusChange decides who may move a window's status
 *     by comparing the caller to userId, so rewriting it moves that authority.
 *
 * The admin edit form sends none of them — its only `status` fields are on
 * timeline phases — so refusing them changes nothing the form does.
 *
 * AND ITS ADMIN CHECK WAS NARROWER THAN THE ONE NEXT TO IT
 * -------------------------------------------------------
 * It read admin/super_admin from the session TOKEN, while the status endpoint in
 * the same file recognises export_admin and reads roles from the database. An
 * export administrator could settle a window — the larger power — and not edit
 * its description.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hasExportAdminAccess } from '@/lib/export-window-status';

const WINDOWS = 'src/app/actions/export/_ex_windows.ts';
const EDIT_PAGE = 'src/app/admin/export/edit/[id]/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function editBody(): string {
    const src = code(WINDOWS);
    const start = src.indexOf('export async function updateExportWindowAction(');
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.indexOf('\nexport async function ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('the protected fields', () => {
    const body = editBody();

    it.each([
        ['status', 'settles the window without notifying a single investor'],
        ['fundedAmount', 'desyncs the ceiling-checked funding total'],
        ['currentFunding', 'desyncs the counter the investment gate reads'],
        ['currentVolume', 'desyncs the ceiling-checked booking volume'],
        ['spotsFilled', 'desyncs the investor count'],
        ['userId', 'moves who may change the window\'s status'],
        ['createdBy', 'moves the recorded creator'],
    ])('%s is refused — %s', (field: string) => {
        expect(body).toContain(`"${field}"`);
        expect(body).toContain('PROTECTED_FIELDS');
    });

    it('and the refusal happens before the write', () => {
        const check = body.indexOf('const refused = PROTECTED_FIELDS.filter');
        const write = body.indexOf('exportRef.update({ ...cleanData');

        expect(check).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(check);
    });

    it('naming which fields were refused, so the caller can tell why', () => {
        expect(body).toContain('refused.join(", ")');
    });

    it('while everything else still goes through', () => {
        // This is an edit form; refusing the whole payload would be the wrong
        // fix. The spread survives, minus the protected keys.
        expect(body).toContain('exportRef.update({ ...cleanData');
    });
});

describe('the form is unaffected', () => {
    it('sends no protected field', () => {
        // Its only `status` values are on timeline phases, not the window.
        const page = source(EDIT_PAGE);

        expect(page).toContain('newTimeline[idx].status');
        expect(page).not.toMatch(/updateData\.status\s*=/);
        expect(page).not.toContain('fundedAmount');
        expect(page).not.toContain('currentFunding');
    });

    it('and still calls the action', () => {
        expect(source(EDIT_PAGE)).toContain('updateExportWindowAction(id, updateData)');
    });
});

describe('the admin check', () => {
    const body = editBody();

    it('uses the shared list, which includes export_admin', () => {
        expect(body).toContain('hasExportAdminAccess(callerRoles)');
        expect(hasExportAdminAccess(['export_admin'])).toBe(true);
    });

    it('and reads roles from the database, not the session token', () => {
        expect(body).toContain('COLLECTIONS.USERS).doc(session.user.id).get()');
        expect(body).toContain('callerDoc.data()?.roles');
        expect(body).not.toContain('session.user.roles?.includes("admin")');
    });

    it('which matches the status endpoint beside it', () => {
        // Vacuity guard: the point is that the two agree.
        const src = code(WINDOWS);
        const reads = src.match(/callerDoc\.data\(\)\?\.roles/g) || [];

        expect(reads.length).toBe(2);
    });
});
