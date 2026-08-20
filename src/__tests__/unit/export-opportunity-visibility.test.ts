/**
 * @jest-environment node
 */

/**
 * One collection, two document shapes, and a public reader that filtered neither.
 *
 * EXPORT_WINDOWS receives documents from two different createExportWindowAction
 * implementations:
 *
 *   export/_ex_windows.ts      an EXPORTER's own trade. Written at
 *                              `status: "pending"`, carrying orderId, commodity,
 *                              quantity, `amount` (the contract value),
 *                              destination, deliveryDate and escrowReleaseDate.
 *
 *   export-aggregation.ts      an ADMIN's aggregation window, written at
 *                              `status: "open"` — the thing investors are meant
 *                              to see.
 *
 * getExportOpportunities, the list, filters `status in ["open", "active"]`.
 * getExportOpportunityById, its sibling, filtered nothing. So an
 * unauthenticated caller who knew a window id was served ANY of them — including
 * an exporter's private pending trade, with `minInvestment: data.amount`
 * exposing the contract value.
 *
 * It also mapped every status other than "active" to the label "Open", so a
 * pending or completed window was presented as investable.
 *
 * Both are unauthenticated by design — /export and /export/windows are public
 * marketing pages — so the filter, not a session check, is what separates a
 * public opportunity from a private record.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import baseline from './action-auth-baseline.json';

const OPPORTUNITIES = 'src/app/actions/export-investments.ts';
const WINDOWS = 'src/app/actions/export/_ex_windows.ts';
const AGGREGATION = 'src/app/actions/export-aggregation.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the two window shapes', () => {
    it('really do land in one collection at different statuses', () => {
        // THE premise.
        const exporter = code(WINDOWS);
        const admin = code(AGGREGATION);

        expect(exporter).toContain('COLLECTIONS.EXPORT_WINDOWS');
        expect(exporter).toContain('status: "pending"');

        expect(admin).toContain('COLLECTIONS.EXPORT_WINDOWS');
        expect(admin).toContain('status: "open"');
    });

    it('and the exporter one carries a private contract value', () => {
        // `amount` is what the by-id reader maps to minInvestment.
        const exporter = code(WINDOWS);

        expect(exporter).toContain('amount: validatedData.amount');
        expect(exporter).toContain('quantity: validatedData.quantity');
    });
});

describe('the by-id opportunity reader', () => {
    const src = code(OPPORTUNITIES);
    const byId = src.slice(src.indexOf('getCachedExportOpportunityById'));

    it('serves only a window that is open for investment', () => {
        // THE test.
        expect(byId).toContain('data.status === "open" || data.status === "active"');
        expect(byId).toContain('if (!investable)');
    });

    it('refusing before it builds the opportunity', () => {
        const guard = byId.indexOf('if (!investable)');
        const build = byId.indexOf('const opportunity: ExportOpportunity');

        expect(guard).toBeGreaterThan(-1);
        expect(build).toBeGreaterThan(guard);
    });

    it('and says it is closed rather than pretending it never existed', () => {
        // A bookmarked opportunity that has since closed is an ordinary case.
        expect(byId).toContain('no longer open');
    });

    it('which is the same filter its sibling list already applied', () => {
        // Vacuity guard: the rule is the file's own, not one invented here.
        const list = src.slice(src.indexOf('getCachedExportOpportunities'), src.indexOf('getCachedExportOpportunityById'));

        expect(list).toContain('.where("status", "in", ["open", "active"])');
    });

    it('so it can no longer label a pending window "Open"', () => {
        // The mapping `status: data.status === "active" ? "Opening Soon" : "Open"`
        // is reached only for a window that passed the filter above.
        const guard = byId.indexOf('if (!investable)');
        const label = byId.indexOf('"Opening Soon" : "Open"');

        expect(label).toBeGreaterThan(guard);
    });
});

describe('both readers stay public', () => {
    it('because /export and /export/windows are marketing pages', () => {
        // The filter, not a session check, is what separates a public
        // opportunity from a private record — so these staying in the unguarded
        // baseline is deliberate, not an oversight.
        const unguarded = (baseline as any).unguarded as string[];

        expect(unguarded).toContain('app/actions/export-investments.ts::getExportOpportunities');
        expect(unguarded).toContain('app/actions/export-investments.ts::getExportOpportunityById');
    });

    it('and the active-windows list is filtered too', () => {
        expect(code(AGGREGATION)).toContain('.where("status", "==", "open")');
    });
});
