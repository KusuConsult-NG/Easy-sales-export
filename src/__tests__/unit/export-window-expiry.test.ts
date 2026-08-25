/**
 * @jest-environment node
 */

/**
 *   #275 AN EXPIRED EXPORT WINDOW STAYED OPEN FOR EVER, AND TWO OF THE THREE
 *        INVESTMENT PATHS TOOK MONEY FOR IT.
 *
 *        There are three doors onto investing in an export window:
 *
 *          export-aggregation.ts   purchaseSlot
 *                                  status === "open"
 *                                  AND new Date() > endDate  -> "has expired"
 *          export/_ex_investments  investInExportAction
 *                                  status only
 *          export-payment.ts       initialiseExportPayment
 *                                  status only
 *
 *        One of the three checks the deadline. The other two check that the
 *        window says "open" — and NOTHING EVER MAKES IT SAY ANYTHING ELSE.
 *
 *        A scan for a writer of "closed" on export_windows finds none: the
 *        string appears in export-aggregation's own type union, in
 *        EXPORT_WINDOW_ALL_STATUSES and in EXPORT_AGGREGATION_STATUSES, and in
 *        no assignment anywhere. There is no scheduled job, no admin action and
 *        no code path that closes a window when its endDate passes.
 *
 *        So an investment window whose period ended months ago is still
 *        `status: "open"`. getExportOpportunities lists it as a live
 *        opportunity — with its own closeDate, in the past, rendered on the
 *        card — a member clicks through, and two of the three paths charge
 *        them.
 *
 *        THE SHAPE: three implementations of one operation, one hardened. The
 *        same sentence export-window-status.ts already opens with about
 *        updateExportStatusAction — "defined twice, over the same collection
 *        and the same four statuses, and both are wired to live UI... The first
 *        was hardened in an earlier pass. The second has none of it." Here it
 *        is a third time, on the door where money enters.
 *
 * THE FIX IS ADDITIVE, DELIBERATELY
 * ---------------------------------
 * The shared predicate accepts the UNION of what the three paths accept today
 * — "open" or "active" — rather than narrowing to what the hardened one takes.
 * No window that can currently be invested in stops being investable; two paths
 * simply gain the deadline check the third already had.
 *
 * An absent or unparseable endDate is treated as NOT expired, which is exactly
 * what export-aggregation.ts already did (`new Date() > new Date(undefined)` is
 * false). Copying the hardened path's behaviour rather than inventing a
 * stricter one keeps this a fix rather than a change.
 *
 * AND ONE THING RECORDED RATHER THAN CHANGED
 * ------------------------------------------
 * "active" is a window status NO WRITER PRODUCES. export-aggregation.ts creates
 * an investable window as "open" and its own type is
 * `"open" | "closed" | "in_transit" | "completed"`; EXPORT_WINDOW_ALL_STATUSES
 * does not contain "active" either. Five read sites treat it as investable and
 * getExportOpportunities renders "Opening Soon" for it — a card state that can
 * never appear.
 *
 * Left accepted on purpose. Removing it would narrow a money path on the
 * strength of a static scan, and a single hand-edited production row would
 * start being refused. #28's class ("a value nobody writes"), reported rather
 * than acted on.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { exportWindowAcceptsInvestment } from '@/lib/export-window-status';

const PAST = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

const PATHS = [
    'src/app/actions/export-aggregation.ts',
    'src/app/actions/export/_ex_investments.ts',
    'src/app/actions/export-payment.ts',
];

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#275 — a window past its deadline takes no more money', () => {
    it('REFUSES AN OPEN WINDOW WHOSE endDate HAS PASSED', () => {
        // The defect. status stays "open" for ever because nothing writes
        // "closed", so the deadline is the only thing that can refuse it.
        const verdict = exportWindowAcceptsInvestment({ status: 'open', endDate: PAST });

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.reason).toBe('expired');
    });

    it('and still accepts one inside its window', () => {
        // Vacuity guard: a predicate that refused everything would close the
        // whole export product.
        expect(exportWindowAcceptsInvestment({ status: 'open', endDate: FUTURE }).ok).toBe(true);
    });

    it('refuses a window that is not open at all', () => {
        for (const status of ['closed', 'completed', 'in_transit', 'pending', 'cancelled', undefined]) {
            expect({ status, ok: exportWindowAcceptsInvestment({ status, endDate: FUTURE }).ok })
                .toEqual({ status, ok: false });
        }
    });

    it('ACCEPTS "active" TOO, WHICH IS THE UNION AND NOT A NARROWING', () => {
        // No writer produces it, and removing it would narrow a money path on
        // the strength of a static scan. Two of the three paths accept it
        // today, so the shared rule does.
        expect(exportWindowAcceptsInvestment({ status: 'active', endDate: FUTURE }).ok).toBe(true);
    });

    it('treats an absent or unreadable endDate as no deadline, exactly as before', () => {
        // Copying the hardened path rather than inventing a stricter rule:
        // `new Date() > new Date(undefined)` is false, so export-aggregation.ts
        // already let these through. #272's reasoning, not #245's — a deadline
        // nobody set is not a control that failed.
        for (const endDate of [undefined, null, '', 'not a date']) {
            expect({ endDate, ok: exportWindowAcceptsInvestment({ status: 'open', endDate }).ok })
                .toEqual({ endDate, ok: true });
        }
    });

    it('reads a Firestore Timestamp endDate as well as an ISO string', () => {
        // export_windows rows carry both shapes — getExportOpportunities has to
        // branch on `.toDate?.()` to render closeDate, so the predicate must
        // too or it would see a deadline it cannot compare.
        const asTimestamp = { toDate: () => new Date(PAST) };
        expect(exportWindowAcceptsInvestment({ status: 'open', endDate: asTimestamp }).ok).toBe(false);

        const future = { toDate: () => new Date(FUTURE) };
        expect(exportWindowAcceptsInvestment({ status: 'open', endDate: future }).ok).toBe(true);
    });

    it('carries a message safe to show the member', () => {
        const v = exportWindowAcceptsInvestment({ status: 'open', endDate: PAST });
        expect(v.ok === false && v.message).toMatch(/expired|closed/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#275 — all three doors use it', () => {
    it('finds every path, so the checks below are not vacuous', () => {
        for (const f of PATHS) expect(codeOnly(f).length).toBeGreaterThan(500);
    });

    it('EACH INVESTMENT PATH CALLS THE SHARED PREDICATE', () => {
        const missing = PATHS.filter((f) => !codeOnly(f).includes('exportWindowAcceptsInvestment('));

        // Was: only export-aggregation.ts checked the deadline, by hand.
        expect(missing).toEqual([]);
    });

    it('and none of them keeps a hand-written status check of its own', () => {
        // Three copies is how this happened. The point of the shared rule is
        // that there is no fourth answer — #253, #270 and #271 all came from
        // leaving the old comparison beside the new call.
        const offenders = PATHS
            .flatMap((f) => codeOnly(f).split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => /status\s*!==\s*["'](open|active)["']/.test(line))
            .map((o) => o.at);

        expect(offenders).toEqual([]);
    });

    it('and no path is left comparing endDate by hand either', () => {
        const offenders = PATHS
            .flatMap((f) => codeOnly(f).split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => /new Date\(\)\s*>\s*new Date\(/.test(line))
            .map((o) => o.at);

        // Was: export-aggregation.ts:193.
        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#275 — the state that can never be reached, recorded', () => {
    it('NOTHING WRITES "closed" TO AN EXPORT WINDOW', () => {
        /**
         * Pinned so the finding is not lost. A window is created "open" and no
         * code path ever moves it off that, so the deadline check added above
         * is the ONLY thing standing between an ended window and a member's
         * money.
         *
         * Closing them properly — a scheduled sweep, or an admin action — is a
         * product decision about what an expired window should look like in the
         * catalogue, so it is the owner's rather than this audit's. When
         * somebody writes that closer, this test fails and they delete it.
         */
        const files = ['src/app/actions/export-aggregation.ts', 'src/app/actions/export/_ex_windows.ts',
            'src/app/actions/export-payment.ts', 'src/app/actions/admin/_exports.ts'];

        const writers = files
            .flatMap((f) => codeOnly(f).split('\n').map((line) => ({ f, line })))
            .filter(({ line }) => /status:\s*["']closed["']/.test(line))
            .map((o) => o.f);

        expect(writers).toEqual([]);
    });
});
