/**
 * @jest-environment node
 */

/**
 * One collection, two entities, and a status vocabulary that only went one way.
 *
 * export_windows holds two different things, told apart by nothing but which
 * fields they happened to carry. admin/_exports.ts names the split in its own
 * comment — "Safe mapping for Split-Schema (Private Requests vs Crowdfunded
 * Opportunities)":
 *
 *   SHIPMENT     a private export request. orderId, commodity, quantity,
 *                userId. Created "pending", moving pending → in_transit →
 *                delivered → completed.
 *   AGGREGATION  a crowdfunded opportunity. title, targetVolume, slotPrice,
 *                currentVolume, createdBy. Created "open", and browsed by
 *                investors through `where status == "open"`.
 *
 * THE TRAPDOOR (#65)
 * ------------------
 * EXPORT_WINDOW_STATUSES lists only the four shipment statuses, and
 * refuseExportStatusChange asked normaliseExportWindowStatus, which refuses
 * everything else. The admin status endpoint never asked which entity it was
 * holding — so the moment an admin moved an aggregation window onto one of the
 * four, "open" became "Invalid status value" and there was no way back. The
 * window left the investor browse query permanently, with money already in it.
 * A one-way door reached through an ordinary dropdown.
 *
 * The fix is not to merge the vocabularies: "in_transit" is meaningless for an
 * aggregation window and "open" is meaningless for a shipment. It is to ask
 * which entity the row is before deciding which words are legal for it.
 *
 * THE MISSING GOAL (#55)
 * ----------------------
 * Nothing wrote fundingGoal onto a window. All three fulfilment paths guard
 * overfunding with incrementWithinCeiling, and that treats a MISSING ceiling
 * field as UNBOUNDED — so no window was ever capped.
 *
 * It was always derivable, and admin/_exports.ts already derived it for
 * display and threw the number away:
 *
 *     calculatedAmount = Number(data.targetVolume) * Number(data.slotPrice || 1)
 *
 * The aggregation creator records it now. A SHIPMENT window deliberately
 * records none — it has no investors, and a goal of 0 would read as "already
 * full" to anything comparing against it.
 *
 * WHAT THE DERIVATION DOES AND DOES NOT FIX. incrementWithinCeiling reads a
 * STORED field through a Postgres function, so deriving the goal in JavaScript
 * fixes every reader and caps nothing. Existing rows need
 * scripts/backfill-export-funding-goals.ts, which is written and deliberately
 * not run here — there is no database to run it against from this branch.
 *
 * The 20% ROI default is NOT changed. It is already correct: both fulfilment
 * paths compute the return as `amount * (returnMultiplier ?? 1.20)`, so a
 * window that records nothing advertises exactly what it pays. Making the page
 * show "unset" would have it disagree with the payout.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    exportWindowKind,
    exportWindowFundingGoal,
    normaliseStatusForKind,
    statusesForExportWindowKind,
    refuseExportStatusChange,
    EXPORT_WINDOW_STATUSES,
    EXPORT_AGGREGATION_STATUSES,
} from '@/lib/export-window-status';
import { kindOf, goalOf } from '../../../scripts/backfill-export-funding-goals';

const ROOT = process.cwd();

const SHIPMENT_CREATOR = 'src/app/actions/export/_ex_windows.ts';
const AGGREGATION_CREATOR = 'src/app/actions/export-aggregation.ts';
const STATUS_DOOR_A = 'src/app/actions/export/_ex_windows.ts';
const STATUS_DOOR_B = 'src/app/actions/export-status.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const AGG = { windowKind: 'aggregation', targetVolume: 1000, slotPrice: 250, status: 'open' };
const SHIP = { windowKind: 'shipment', orderId: 'ord_1', commodity: 'cocoa', status: 'pending' };

describe('which entity a window is', () => {
    it('a stamped one says so', () => {
        expect(exportWindowKind(AGG)).toBe('aggregation');
        expect(exportWindowKind(SHIP)).toBe('shipment');
    });

    it('an unstamped one — every row in production — is inferred', () => {
        expect(exportWindowKind({ targetVolume: 1000, slotPrice: 250 })).toBe('aggregation');
        expect(exportWindowKind({ slotPrice: 250 })).toBe('aggregation');
        expect(exportWindowKind({ status: 'open' })).toBe('aggregation');
        expect(exportWindowKind({ orderId: 'ord_1', quantity: '20t' })).toBe('shipment');
    });

    it('defaulting to shipment, which is the shape with no investors', () => {
        expect(exportWindowKind({})).toBe('shipment');
        expect(exportWindowKind(null)).toBe('shipment');
    });

    it('the same tell admin/_exports.ts already used', () => {
        // Vacuity guard: targetVolume was already the platform's own
        // discriminator, used for display.
        expect(code('src/app/actions/admin/_exports.ts')).toContain('const isCrowdfunded = !!data.targetVolume;');
    });
});

describe('the vocabulary follows the entity — THE trapdoor', () => {
    it('an aggregation window may be set back to open', () => {
        // THE test. Before this, once it had been moved onto a shipment status
        // there was no way back and it left the investor browse query for good.
        expect(normaliseStatusForKind('aggregation', 'open')).toBe('open');
        expect(normaliseStatusForKind('aggregation', 'closed')).toBe('closed');
    });

    it('and the old rule genuinely could not express it', () => {
        // Reconstructed, so this proves the fix changed something.
        const oldRule = (s: string) => (EXPORT_WINDOW_STATUSES as readonly string[]).includes(s) ? s : null;
        expect(oldRule('open')).toBeNull();
        expect(oldRule('closed')).toBeNull();
    });

    it('a shipment window keeps its four and gains nothing', () => {
        for (const s of EXPORT_WINDOW_STATUSES) {
            expect(normaliseStatusForKind('shipment', s)).toBe(s);
        }
        expect(normaliseStatusForKind('shipment', 'open')).toBeNull();
    });

    it('and "in_transit" is not offered to an aggregation window', () => {
        // The reason the two sets are not merged.
        expect(normaliseStatusForKind('aggregation', 'in_transit')).toBeNull();
        expect(normaliseStatusForKind('aggregation', 'delivered')).toBeNull();
    });

    it('the two sets overlapping only where they genuinely mean the same thing', () => {
        const shipment = new Set(statusesForExportWindowKind('shipment'));
        const shared = [...statusesForExportWindowKind('aggregation')].filter((s) => shipment.has(s));
        expect(shared).toEqual(['completed']);
    });

    it('normalising case and space, as the original did', () => {
        expect(normaliseStatusForKind('aggregation', '  OPEN ')).toBe('open');
        expect(normaliseStatusForKind('shipment', 'In_Transit')).toBe('in_transit');
        expect(normaliseStatusForKind('aggregation', '')).toBeNull();
        expect(normaliseStatusForKind('aggregation', undefined)).toBeNull();
    });
});

describe('the refusal rule uses it', () => {
    const admin = { callerId: 'a1', callerRoles: ['admin'], ownerId: 'u1', callerIdIsOwner: false };

    it('an admin may reopen an aggregation window — the trapdoor, end to end', () => {
        expect(refuseExportStatusChange({
            ...admin,
            currentStatus: 'in_transit',
            newStatus: 'open',
            window: AGG,
        })).toBeNull();
    });

    it('and could not before, which is what made it one-way', () => {
        // Same call with no window passed falls back to the shipment
        // vocabulary — the behaviour every caller had.
        expect(refuseExportStatusChange({
            ...admin,
            currentStatus: 'in_transit',
            newStatus: 'open',
        })).toBe('Invalid status value');
    });

    it('a shipment window still refuses "open"', () => {
        expect(refuseExportStatusChange({
            ...admin,
            currentStatus: 'pending',
            newStatus: 'open',
            window: SHIP,
        })).toBe('Invalid status value');
    });

    it('and the authorisation rules are untouched', () => {
        // A stranger is still refused, and a non-admin still cannot settle.
        expect(refuseExportStatusChange({
            callerId: 'someone-else', callerRoles: ['user'], ownerId: 'u1',
            currentStatus: 'open', newStatus: 'closed', window: AGG,
        })).toBe('Unauthorized to update this export');

        expect(refuseExportStatusChange({
            callerId: 'u1', callerRoles: ['user'], ownerId: 'u1',
            currentStatus: 'delivered', newStatus: 'completed', window: SHIP,
        })).toBe('Only an administrator can mark an export completed');
    });

    it('both status doors passing the document', () => {
        expect(code(STATUS_DOOR_A)).toContain('window: data,');
        expect(code(STATUS_DOOR_B)).toContain('window: exportData,');
    });
});

describe('what an aggregation window is raising', () => {
    it('derived from targetVolume x slotPrice', () => {
        expect(exportWindowFundingGoal({ targetVolume: 1000, slotPrice: 250 })).toBe(250_000);
    });

    it('an explicit goal winning over the derivation', () => {
        expect(exportWindowFundingGoal({ fundingGoal: 999, targetVolume: 1000, slotPrice: 250 })).toBe(999);
        expect(exportWindowFundingGoal({ goal: 500 })).toBe(500);
    });

    it('a shipment window raising nothing — null, not zero', () => {
        // 0 would read as "already full" to anything comparing against it.
        expect(exportWindowFundingGoal(SHIP)).toBeNull();
        expect(exportWindowFundingGoal({ orderId: 'ord_1' })).toBeNull();
    });

    it('and refusing to guess from a malformed aggregation window', () => {
        expect(exportWindowFundingGoal({ targetVolume: 0, slotPrice: 250 })).toBeNull();
        expect(exportWindowFundingGoal({ targetVolume: 1000, slotPrice: 0 })).toBeNull();
        expect(exportWindowFundingGoal({ targetVolume: 'lots', slotPrice: 250 })).toBeNull();
        expect(exportWindowFundingGoal(null)).toBeNull();
    });

    it('the number matching what the admin screen already displays', () => {
        // Vacuity guard: this is not a new figure.
        expect(code('src/app/actions/admin/_exports.ts'))
            .toContain('Number(data.targetVolume) * Number(data.slotPrice || 1)');
    });
});

describe('the creators record both fields', () => {
    it('the aggregation creator stamps its kind and its goal', () => {
        const src = code(AGGREGATION_CREATOR);
        expect(src).toContain('windowKind: "aggregation" as const,');
        expect(src).toContain('fundingGoal: targetVolume * slotPrice,');
    });

    it('the shipment creator stamps its kind and NO goal', () => {
        const src = code(SHIPMENT_CREATOR);
        expect(src).toContain('windowKind: "shipment" as const,');
        expect(src).not.toContain('fundingGoal');
    });

    it('the goal being what makes the ceiling work at all', () => {
        // Vacuity guard on why storing it matters: the ceiling is a stored
        // field read by a Postgres function.
        const ledger = code('src/lib/wallet-ledger.ts');
        expect(ledger).toContain('p_ceiling_field: ceilingField,');
        expect(code('src/app/actions/export/_ex_investments.ts'))
            .toContain('const ceilingField = exportWindow?.fundingGoal !== undefined ? "fundingGoal" : "goal";');
    });
});

describe('the backfill for rows that predate both fields', () => {
    it('agrees with the application on which entity a row is', () => {
        // The script duplicates the rule deliberately — importing application
        // code drags the module graph into a maintenance run — so the two are
        // pinned together here.
        const cases = [
            AGG, SHIP,
            { targetVolume: 1000, slotPrice: 250 },
            { slotPrice: 250 },
            { status: 'open' },
            { orderId: 'ord_1', quantity: '20t' },
            {},
        ];
        for (const c of cases) {
            expect(kindOf(c as Record<string, unknown>)).toBe(exportWindowKind(c));
        }
    });

    it('and on what the goal is', () => {
        for (const c of [
            { targetVolume: 1000, slotPrice: 250 },
            { targetVolume: 0, slotPrice: 250 },
            { targetVolume: 1000, slotPrice: 0 },
            { targetVolume: 'lots', slotPrice: 250 },
        ]) {
            expect(goalOf(c as Record<string, unknown>)).toBe(exportWindowFundingGoal(c));
        }
    });

    it('reporting by default and writing only with --apply', () => {
        const src = source('scripts/backfill-export-funding-goals.ts');
        expect(src).toContain("const APPLY = process.argv.includes('--apply');");
        expect(src).toContain('Nothing was written. Re-run with --apply to write.');
    });

    it('and never overwriting a goal somebody set by hand', () => {
        expect(source('scripts/backfill-export-funding-goals.ts'))
            .toContain('Never overwritten: an admin may have set this by hand.');
    });
});

describe('what is deliberately NOT changed', () => {
    it('the 20% ROI default stays, because it is what the payout pays', () => {
        // Changing the page to show "unset" would have it disagree with the
        // money. Both fulfilment paths compute `amount * (returnMultiplier ?? 1.20)`.
        const status = code('src/lib/export-window-status.ts');
        expect(status).toContain('export const DEFAULT_EXPORT_ROI_PERCENT = 20;');
        expect(source('src/lib/export-window-status.ts'))
            .toContain('`amount * (returnMultiplier ?? 1.20)`');
    });

    it('and the two entities still share one collection', () => {
        // Stated plainly: this labels and disambiguates them, it does not split
        // the collection. Splitting is a migration with no rollback.
        for (const rel of [SHIPMENT_CREATOR, AGGREGATION_CREATOR]) {
            expect(code(rel)).toContain('COLLECTIONS.EXPORT_WINDOWS');
        }
    });
});
