/**
 * @jest-environment node
 */

/**
 * A forensic check that inspected nothing, and a duplicate-guard that did not
 * survive the one condition it existed for.
 *
 * ONE COLLECTION, TWO ENTITIES, TWO VOCABULARIES
 * ---------------------------------------------
 * export_windows holds two different things, told apart by nothing but which
 * fields they carry. admin/_exports.ts names the split in its own comment —
 * "Safe mapping for Split-Schema (Private Requests vs Crowdfunded
 * Opportunities)" — and each has its own creator writing its own status:
 *
 *   the SHIPMENT      _ex_windows.ts::createExportWindowAction. orderId,
 *                     commodity, quantity, deliveryDate, userId. Created
 *                     "pending"; moves pending → in_transit → delivered →
 *                     completed.
 *   the AGGREGATION   export-aggregation.ts. slotPrice, currentVolume,
 *                     startDate/endDate, createdBy. Created "open"; investors
 *                     buy slots in it.
 *
 * THE CHECK THAT INSPECTED NOTHING
 * --------------------------------
 * forensics.ts's Investment Cap Breach check queried
 * `where("status", "==", "active")` on export_windows. Nothing writes "active"
 * to that collection — every write is accounted for: "open" and "pending" from
 * the two creators, the four shipment statuses from the two
 * updateExportStatusAction endpoints, and "completed" from the escrow cron.
 * "active" appears only on EXPORT_SLOTS and EXPORT_INVESTMENTS.
 *
 * So the check read zero windows and reported clean every time an admin ran it.
 * It is the same shape as the integrity report that never built the index it
 * consulted: a safety net that cannot catch anything, reporting that it caught
 * nothing.
 *
 * THE DUPLICATE-GUARD THAT DID NOT SURVIVE CONCURRENCY
 * ---------------------------------------------------
 * _ex_windows.ts::updateExportStatusAction read `data.status`, compared it to
 * newStatus, and then updated — under a comment reading "Prevent duplicate
 * status updates to avoid multiple completion emails". On "completed" it emails
 * EVERY investor a statement of their returns and marks every slot completed.
 * Two callers landing together both read a status that is not yet "completed",
 * both pass the guard, and both send. The guard existed for the emails and
 * failed in exactly the case it was written for. Now claimed, so one caller
 * wins and only the winner notifies.
 *
 * RECORDED, NOT FIXED: because EXPORT_WINDOW_STATUSES cannot express "open",
 * once an admin moves an aggregation window onto one of the four shipment
 * statuses, refuseExportStatusChange rejects "open" as "Invalid status value"
 * and there is no way back — the window leaves the browse query permanently.
 * Merging the two entities is a schema decision, not an audit's.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    EXPORT_WINDOW_STATUSES,
    EXPORT_WINDOW_ALL_STATUSES,
    EXPORT_WINDOW_INVESTABLE_STATUSES,
    normaliseExportWindowStatus,
    refuseExportStatusChange,
} from '@/lib/export-window-status';

const FORENSICS = 'src/app/actions/forensics.ts';
const WINDOWS = 'src/app/actions/export/_ex_windows.ts';
const AGGREGATION = 'src/app/actions/export-aggregation.ts';
const INVESTMENTS = 'src/app/actions/export/_ex_investments.ts';
const ADMIN_EXPORTS = 'src/app/actions/admin/_exports.ts';

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

describe('the two vocabularies really are both live', () => {
    it('the aggregation creator writes "open"', () => {
        // THE premise. Without both creators this is one vocabulary and there is
        // no finding.
        expect(code(AGGREGATION)).toContain('status: "open"');
        expect(code(AGGREGATION)).toContain('COLLECTIONS.EXPORT_WINDOWS');
    });

    it('the shipment creator writes "pending"', () => {
        expect(code(WINDOWS)).toContain('status: "pending",');
        expect(code(WINDOWS)).toContain('COLLECTIONS.EXPORT_WINDOWS');
    });

    it('and the admin list already knew the collection was split', () => {
        // The platform's own words, so this is not a reading invented here.
        expect(source(ADMIN_EXPORTS)).toContain('Split-Schema');
    });

    it('while the status union covers only the shipment half', () => {
        expect([...EXPORT_WINDOW_STATUSES]).toEqual(['pending', 'in_transit', 'delivered', 'completed']);
        expect(normaliseExportWindowStatus('open')).toBeNull();
        expect(normaliseExportWindowStatus('closed')).toBeNull();
    });

    it('and the union of both is what a window can actually hold', () => {
        expect([...EXPORT_WINDOW_ALL_STATUSES])
            .toEqual(['pending', 'in_transit', 'delivered', 'completed', 'open', 'closed']);
    });
});

describe('the investment cap breach check', () => {
    const forensics = code(FORENSICS);

    it('asks for the statuses a window can actually have', () => {
        // THE test.
        expect(forensics).toContain('.where("status", "in", [...EXPORT_WINDOW_INVESTABLE_STATUSES])');
        expect(forensics).not.toContain('.where("status", "==", "active")');
    });

    it('"open" being among them, which is what the browse query uses too', () => {
        expect([...EXPORT_WINDOW_INVESTABLE_STATUSES]).toContain('open');
        expect(code(AGGREGATION)).toContain('.where("status", "==", "open")');
    });

    it('and "active" being a status nothing writes to a window', () => {
        // Vacuity guard on the whole finding: if some writer did produce
        // "active" on export_windows, the old filter was fine and this is not a
        // defect. The investability check honours "active", which is why the
        // constant keeps it — but no writer produces it.
        expect([...EXPORT_WINDOW_INVESTABLE_STATUSES]).toContain('active');
        expect(code(INVESTMENTS)).toContain('!== "active"');

        // The three "active" writes in the export module all land elsewhere.
        for (const rel of [INVESTMENTS, 'src/app/actions/export-payment.ts', 'src/infrastructure/payments/service.ts']) {
            const src = code(rel);
            for (const m of src.matchAll(/status: "active"/g)) {
                const before = src.slice(Math.max(0, m.index! - 600), m.index!);
                expect(before).toMatch(/EXPORT_SLOTS|EXPORT_INVESTMENTS/);
            }
        }
    });

    it('and it sweeps unbounded, because a partial forensic report is a wrong one', () => {
        expect(forensics).toContain('.all()');
        expect(forensics).toContain('if (activeWindows.truncated)');
    });
});

describe('completing an export window', () => {
    const windows = code(WINDOWS);

    it('claims the transition rather than reading then writing', () => {
        // THE test.
        expect(windows).toContain('const claim = await claimStatusTransitionFromAny({');
        expect(windows).toContain('collection: COLLECTIONS.EXPORT_WINDOWS,');
        expect(windows).toContain('fromAny: EXPORT_WINDOW_ALL_STATUSES.filter((s) => s !== newStatus),');
        expect(windows).toContain('to: newStatus,');
    });

    it('with the read-then-write it replaced gone', () => {
        expect(windows).not.toContain('if (data?.status === newStatus) {');
        expect(windows).not.toContain('await exportRef.update({ status: newStatus,');
    });

    it('and the loser told the status is already set, as before', () => {
        expect(windows).toContain('if (claim.status === newStatus) {');
        expect(windows).toContain('`Status is already ${newStatus}`');
    });

    it('so only the winner emails every investor', () => {
        // Vacuity guard, and the reason the race mattered: the side effect is
        // not idempotent. It is reached only after the claim.
        const claimAt = windows.indexOf('const claim = await claimStatusTransitionFromAny({');
        const emailAt = windows.indexOf('sendExportWindowCompleteEmail');

        expect(claimAt).toBeGreaterThan(-1);
        expect(emailAt).toBeGreaterThan(claimAt);
        expect(windows).toContain('if (newStatus === "completed")');
    });

    it('and the authorization rule still runs first', () => {
        // The claim decides who WINS, not who MAY. Losing that ordering would
        // let a non-owner claim the transition before being refused.
        const refusalAt = windows.indexOf('const refusal = refuseExportStatusChange({');
        const claimAt = windows.indexOf('const claim = await claimStatusTransitionFromAny({');

        expect(refusalAt).toBeGreaterThan(-1);
        expect(claimAt).toBeGreaterThan(refusalAt);
    });
});

describe('the one-way trapdoor, recorded rather than fixed', () => {
    it('an admin may move a window onto a shipment status', () => {
        expect(refuseExportStatusChange({
            callerId: 'admin-1',
            callerRoles: ['admin'],
            ownerId: undefined,          // an aggregation window has createdBy, not userId
            currentStatus: 'open',
            newStatus: 'delivered',
        })).toBeNull();
    });

    it('and cannot move it back, because "open" is not a value this rule accepts', () => {
        // THE trapdoor. The window drops out of `where status == "open"` — the
        // investor-facing browse query — and nothing can restore it.
        expect(refuseExportStatusChange({
            callerId: 'admin-1',
            callerRoles: ['super_admin'],
            ownerId: undefined,
            currentStatus: 'delivered',
            newStatus: 'open',
        })).toBe('Invalid status value');
    });

    it('which is why the union is documented in one place', () => {
        expect(source('src/lib/export-window-status.ts')).toContain('ONE COLLECTION, TWO ENTITIES, TWO VOCABULARIES');
        expect(source('src/lib/export-window-status.ts')).toContain('there is no way back');
    });
});
