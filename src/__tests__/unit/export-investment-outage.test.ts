/**
 * @jest-environment node
 */

/**
 * Export investment could not take a single payment. Twice over.
 *
 * 1. THE FUNDING GATE REFUSED EVERY INVESTMENT
 *
 *    initializeInvestmentPaymentAction read
 *
 *        const currentFunding = windowData.currentFunding || 0;
 *        const fundingGoal = windowData.fundingGoal || 0;
 *        if (currentFunding + investmentAmount > fundingGoal) { refuse }
 *
 *    Nothing anywhere writes `fundingGoal` onto an export window. Neither of
 *    the two createExportWindowAction implementations does — the exporter one
 *    writes orderId/commodity/quantity/amount/destination/status/userId, the
 *    admin aggregation one writes title/targetVolume/currentVolume/slotPrice/
 *    startDate/endDate/destination/status — the seeder is deprecated, and the
 *    field appears nowhere else outside reads, comments and tests.
 *
 *    So fundingGoal was always 0. The minimum investment is ₦50,000, and
 *    0 + 50000 > 0. Every investment on every window was refused, with
 *    "Investment exceeds available slots. Maximum available: ₦0".
 *
 * 2. THE PAGE THREW BEFORE IT EVEN CALLED THE ACTION
 *
 *    /export/windows/[id] built its metadata with
 *
 *        parseFloat(windowData.projectedROI.replace("%", ""))
 *
 *    getExportOpportunityById maps `projectedROI: data.roi`, and nothing writes
 *    an roi onto a window — the only `roi:` writes in the codebase are onto
 *    EXPORT_SLOTS, after an investment already exists. So .replace ran on
 *    undefined, threw a TypeError, and the surrounding catch reported "An error
 *    occurred while processing your investment". This one fired FIRST.
 *
 * 3. AND THE AUTHORIZATION URL WAS THROWN AWAY
 *
 *    The same action returned `data: null`, discarding the URL it had just
 *    asked Paystack for. Its one caller, /export/windows/[id], reads
 *    `result.data?.authorizationUrl` and shows "Failed to initialize
 *    investment: No authorization URL" when it is absent.
 *
 *    Either fault alone made investing impossible.
 *
 * WHAT AN ABSENT CEILING MEANS
 * ----------------------------
 * Uncapped — and that is not an invention here. incrementWithinCeiling
 * (migration 015) treats a missing ceiling field as unbounded, the comment at
 * the fulfilment end of export-payment.ts says so explicitly, and the sibling
 * path in export/_ex_investments.ts already guards its own check with
 * `fundingGoal > 0 &&`. This gate was the one place that did not.
 *
 * Because no window carries a goal, no window is capped. Which window shape
 * should record one, and from what, is left for the owner.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { exportWindowRoiPercent, DEFAULT_EXPORT_ROI_PERCENT } from '@/lib/export-window-status';

const PAYMENT = 'src/app/actions/export-payment.ts';
const WINDOWS = 'src/app/actions/export/_ex_windows.ts';
const AGGREGATION = 'src/app/actions/export-aggregation.ts';
const LOOSE = 'src/app/actions/export/_ex_investments.ts';
const WEBHOOK = 'src/infrastructure/payments/service.ts';
const WINDOW_PAGE = 'src/app/export/windows/[id]/page.tsx';

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

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.indexOf('\nexport async function ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('nothing writes a funding goal', () => {
    it('the aggregation creator records one now; the shipment creator still does not', () => {
        // This used to assert NEITHER did, which was the premise for the whole
        // outage. The aggregation window records targetVolume x slotPrice —
        // admin/_exports.ts already computed exactly that number for display
        // and threw it away — so incrementWithinCeiling has a ceiling field to
        // read and new windows are capped.
        //
        // The shipment creator deliberately still records none: a private
        // export request has no investors and nothing to overfund. A goal of 0
        // there would read as "already full".
        const exporter = fn(WINDOWS, 'createExportWindowAction');
        const aggregation = fn(AGGREGATION, 'createExportWindowAction');

        expect(aggregation).toContain('fundingGoal: targetVolume * slotPrice,');
        expect(exporter).not.toContain('fundingGoal');
        expect(exporter).not.toMatch(/\bgoal:/);
    });

    it('and rows written before that carry none, so it is derived for them', () => {
        // incrementWithinCeiling reads a STORED field through a Postgres
        // function, so deriving in JavaScript caps nothing — existing rows need
        // the backfill script. What the derivation fixes is every READER that
        // wanted to show or check a goal.
        const { exportWindowFundingGoal } = require('@/lib/export-window-status');

        expect(exportWindowFundingGoal({ targetVolume: 1000, slotPrice: 250 })).toBe(250000);
        expect(exportWindowFundingGoal({ fundingGoal: 999 })).toBe(999);
        // A shipment window is raising nothing, and null is not 0.
        expect(exportWindowFundingGoal({ orderId: 'ord_1', commodity: 'cocoa' })).toBeNull();
    });

    it('and both really do write that collection, so both shapes land there', () => {
        const exporter = fn(WINDOWS, 'createExportWindowAction');
        const aggregation = fn(AGGREGATION, 'createExportWindowAction');

        expect(exporter).toContain('COLLECTIONS.EXPORT_WINDOWS');
        expect(aggregation).toContain('COLLECTIONS.EXPORT_WINDOWS');
    });

    it('and the seeder that might have is deprecated', () => {
        expect(code('src/app/actions/export-investments.ts'))
            .toContain('Seeding is deprecated');
    });
});

describe('the funding gate', () => {
    it('only enforces a goal that is actually recorded', () => {
        // THE test.
        const body = fn(PAYMENT, 'initializeInvestmentPaymentAction');

        expect(body).toContain('fundingGoal > 0 && currentFunding + investmentAmount > fundingGoal');
        expect(body).not.toContain('const fundingGoal = windowData.fundingGoal || 0;');
    });

    it('reading `goal` as a fallback, as both fulfilment paths do', () => {
        const body = fn(PAYMENT, 'initializeInvestmentPaymentAction');

        expect(body).toContain('windowData.fundingGoal ?? windowData.goal ?? 0');
        // Vacuity guard: the fallback is the platform's own convention.
        expect(code(PAYMENT)).toContain('windowData?.fundingGoal ?? windowData?.goal ?? 0');
        expect(code(LOOSE)).toContain('exportWindow.fundingGoal ?? exportWindow.goal ?? 0');
    });

    it('which is what the sibling path already did', () => {
        // Vacuity guard: uncapped-when-absent is the established semantics, not
        // a rule invented to make the gate pass.
        expect(code(LOOSE)).toContain('fundingGoal > 0 && currentFunded + amount > fundingGoal');
    });

    it('and still refuses when a goal IS set and would be exceeded', () => {
        // The gate must not have been removed, only made conditional.
        const body = fn(PAYMENT, 'initializeInvestmentPaymentAction');

        expect(body).toContain('Investment exceeds available slots');
    });
});

describe('the ROI the page reads', () => {
    it('is never written onto a window', () => {
        // THE premise. The only roi: writes are onto EXPORT_SLOTS.
        const windows = code(WINDOWS);
        const aggregation = code(AGGREGATION);

        expect(fn(WINDOWS, 'createExportWindowAction')).not.toMatch(/\broi:/);
        expect(fn(AGGREGATION, 'createExportWindowAction')).not.toMatch(/\broi:/);
        expect(windows + aggregation).not.toContain('roiPercentage:');
    });

    it('so the page no longer calls .replace on undefined', () => {
        const page = source(WINDOW_PAGE);

        expect(page).not.toContain('windowData.projectedROI.replace("%", "")');
        expect(page).toContain('exportWindowRoiPercent(windowData.projectedROI)');
    });

    it('falling back to the return the platform actually pays', () => {
        // Not an invented number: both fulfilment paths compute the expected
        // return as amount * (returnMultiplier ?? 1.20).
        expect(DEFAULT_EXPORT_ROI_PERCENT).toBe(20);
        expect(code(WEBHOOK)).toContain('expectedReturnMultiplier ?? 1.20');
        expect(code(LOOSE)).toContain('expectedReturnMultiplier ?? 1.20');
    });

    it('and reads a real one when the window has it', () => {
        expect(exportWindowRoiPercent('18%')).toBe(18);
        expect(exportWindowRoiPercent(' 22 % ')).toBe(22);
        expect(exportWindowRoiPercent(18)).toBe(18);
    });

    it('while refusing values that would poison the arithmetic', () => {
        // expectedReturn is amount * (1 + roi/100); NaN or a negative there
        // silently produces a nonsense return figure.
        for (const bad of [undefined, null, '', 'N/A', '15-20%', -5, 0]) {
            expect(exportWindowRoiPercent(bad)).toBe(DEFAULT_EXPORT_ROI_PERCENT);
        }
    });
});

describe('the authorization URL', () => {
    it('is returned rather than discarded', () => {
        // THE test for the second fault.
        const body = fn(PAYMENT, 'initializeInvestmentPaymentAction');

        expect(body).toContain('data: { authorizationUrl, reference }');
    });

    it('and it is the one the action just obtained', () => {
        const body = fn(PAYMENT, 'initializeInvestmentPaymentAction');

        expect(body).toContain('const { authorizationUrl, reference } = await initializePaystackPayment(');

        const obtained = body.indexOf('await initializePaystackPayment(');
        const returned = body.indexOf('data: { authorizationUrl, reference }');
        expect(returned).toBeGreaterThan(obtained);
    });

    it('which is exactly what the page reads', () => {
        // Vacuity guard: without this caller the field name would be arbitrary.
        const page = source(WINDOW_PAGE);

        expect(page).toContain('result.data?.authorizationUrl');
        expect(page).toContain('No authorization URL');
    });

    it('and the page really does invest through this action', () => {
        const page = source(WINDOW_PAGE);

        expect(page).toContain('initializeInvestmentPaymentAction(');
    });
});
