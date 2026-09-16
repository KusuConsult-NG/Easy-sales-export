/**
 * @jest-environment node
 */

/**
 * Dashboards counting status values nothing ever writes.
 *
 * global-aggregation.ts is five admin metric functions, all correctly guarded by
 * requireAdmin. There is nothing wrong with its access control, and everything
 * it reports is a count of rows matching a status string — so the only way it
 * can be wrong is for the string to be wrong. Three of them were.
 *
 * FOUR CONFIRMED, EACH VERIFIED BY GREP AND NOT BY THE SCANNER
 * -----------------------------------------------------------
 *
 * LAND_LISTINGS `pending` — counted as an approval backlog on the global
 * dashboard and in analytics.service.ts. `pending` IS written, which is why no
 * field-existence check finds this: it just means something else. farm-nation
 * sets it when a BUYER reserves a listing mid-purchase (land-listing-status.ts
 * spells this out). The review queue is `pending_verification`, which
 * farm-nation-admin.ts and admin-content.ts correctly use. Three screens, two
 * answers, and the wrong one was on the global dashboard.
 *
 * ESCROW_TRANSACTIONS `completed` — `completedEscrows` in the marketplace
 * metrics. An escrow is never completed: it is pending, funded, delivered,
 * released, refunded or disputed. The figure was structurally always 0 however
 * many had been paid out. `completed` survives review because it IS written a
 * few lines from the escrow release — as the status of the WALLET_TRANSACTIONS
 * and TRANSACTIONS rows that release creates.
 *
 * ESCROW_TRANSACTIONS `locked` — `activeEscrows` on the platform health panel.
 * The string appears exactly once in the whole codebase: in that query. An
 * escrow holding money is `funded`.
 *
 * PROCESSED_PAYMENTS `pending_fulfillment` — two Ls, queried by
 * reconcilePendingFulfillments, while the claim eighty lines below in the same
 * file writes `pending_fulfilment` with one. The recovery routine for stranded
 * payments could never find a stranded payment. Latent: it has no callers today,
 * which is exactly why it matters — it is what somebody wires to a cron the
 * first time money goes missing, and it would answer "none found".
 *
 * ONE THE SCANNER GOT WRONG, CAUGHT BY READING
 * --------------------------------------------
 * It also reported ESCROW_TRANSACTIONS `delivered`, queried by the 24-hour
 * auto-release cron. That one is CORRECT: order-management.ts sets it with
 * `escrowDoc.ref.update({ status: "delivered" })`, and the scanner cannot
 * attribute a write whose receiver is a document ref rather than a collection
 * chain. Acting on it would have broken auto-release and left money in escrow.
 *
 * That is the whole reason this file asserts on greps of the real source rather
 * than on the scanner's output: the scanner narrows where to look, and reading
 * decides.
 *
 * WHY THE CHECK IS NOT A BUILD GATE
 * ---------------------------------
 * Same reasoning as ownership-scan. It sees string literals only, so a status
 * held in a constant, arrived at through a helper, or written by a migration is
 * invisible to it; and a write through a doc-ref handle is invisible too, as
 * above. It went through three revisions before its output was worth reading —
 * per-payload matching, then file-wide, then including union-typed parameters,
 * which is where `status: "approved" | "rejected"` parameters stopped being
 * reported as never-written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { statusVocabularyDrift, scanWriteSites } from '@/lib/testing/collection-writer-scan';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Every occurrence of a bare string in src, excluding tests. */
function occurrences(needle: string): string[] {
    const { execSync } = require('child_process') as typeof import('child_process');
    const out = execSync(`grep -rn ${JSON.stringify(needle)} src || true`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
    });
    return out.split('\n').filter((l) => l.trim() && !l.includes('__tests__'));
}

describe('the approval backlog counts listings awaiting approval', () => {
    it('no longer counts reserved listings as pending approvals', () => {
        // THE test. `pending` on a land listing means a buyer has reserved it.
        const globalAgg = source('src/app/actions/global-aggregation.ts');
        const analytics = source('src/services/analytics.service.ts');

        for (const src of [globalAgg, analytics]) {
            expect(src).not.toMatch(/LAND_LISTINGS\)\s*\.where\("status", "==", "pending"\)/);
        }
    });

    it('uses the shared vocabulary rather than a fourth literal', () => {
        // Three screens already disagreed. A named constant is what stops a
        // fourth from inventing its own answer.
        const { AWAITING_REVIEW_STATUSES } = require('@/lib/land-listing-status');

        // `inspection_scheduled` was added, and this assertion is what caught it.
        // It used to pin ['pending_verification'] alone, which was the set the
        // dashboards counted while the admin queue an operator actually works
        // from counted pending_verification AND inspection_scheduled. Two numbers
        // from the same collection, differing by every outstanding inspection.
        expect([...AWAITING_REVIEW_STATUSES].sort())
            .toEqual(['inspection_scheduled', 'pending_verification']);
        expect(source('src/app/actions/global-aggregation.ts')).toContain('AWAITING_REVIEW_STATUSES');
        expect(source('src/services/analytics.service.ts')).toContain('AWAITING_REVIEW_STATUSES');
    });

    it('queries the whole set, never just its first element', () => {
        // The trap the widening exposed. Both call sites wrote
        // `AWAITING_REVIEW_STATUSES[0]` — correct while the set had one element,
        // and a silent undercount from the moment it had two. Using the shared
        // constant is not enough on its own; it has to be used as a set.
        for (const rel of [
            'src/app/actions/global-aggregation.ts',
            'src/services/analytics.service.ts',
        ]) {
            // Comment lines are stripped first. global-aggregation.ts explains the
            // trap in a comment that names `AWAITING_REVIEW_STATUSES[0]`
            // verbatim, and a substring check over the whole file flagged the
            // explanation as the defect. Recorded here so the stripping is not
            // mistaken for a loophole and removed.
            const code = source(rel)
                .split('\n')
                .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
                .join('\n');

            expect(code).not.toContain('AWAITING_REVIEW_STATUSES[0]');
            expect(code).toContain('"status", "in", [...AWAITING_REVIEW_STATUSES]');
        }
    });

    it('agrees with the screens that were already right', () => {
        // farm-nation-admin.ts and admin-content.ts were correct all along, and
        // are the reason the right answer was knowable. Both now read the same
        // constant as the dashboards, so "correct all along" no longer depends on
        // four files independently choosing the same literal.
        //
        // Asserted as the absence of the literal AND the presence of the
        // constant: either alone can be satisfied while the other drifts.
        for (const rel of [
            'src/app/actions/farm-nation-admin/_fna_verifications.ts',
            'src/app/actions/admin-content.ts',
        ]) {
            expect(source(rel)).not.toContain('where("status", "==", "pending_verification")');
            expect(source(rel)).toContain('AWAITING_REVIEW_STATUSES');
        }
    });
});

describe('escrow counts use statuses escrows actually hold', () => {
    it('counts released escrows, not "completed" ones', () => {
        // An escrow is never `completed`; that is the status of the wallet and
        // ledger rows a release writes.
        const src = source('src/app/actions/global-aggregation.ts');

        expect(src).toContain('where("status", "==", "released")');
        expect(src).not.toMatch(/ESCROW_TRANSACTIONS\)\s*\.where\("status", "==", "completed"\)/);
    });

    it('counts funded escrows as the active ones, not "locked"', () => {
        const src = source('src/services/analytics.service.ts');

        expect(src).not.toContain('where("status", "==", "locked")');
    });

    it('"locked" is gone from the code entirely', () => {
        // It only ever existed in that one query, so nothing else should hold
        // it either — and if a writer appears later, this is the reminder.
        //
        // Comment lines are excluded: the fix's own comment quotes "locked" to
        // explain what was wrong with it, and the first version of this
        // assertion failed on that prose. Third time in this audit that a check
        // for what the CODE does has matched what a comment SAYS.
        const codeHits = occurrences('"locked"').filter((line) => {
            const body = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
            return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
        });

        expect(codeHits).toEqual([]);
    });

    it('leaves the auto-release cron alone', () => {
        // The false positive. Escrows ARE set to "delivered", by
        // order-management.ts through a doc-ref handle the scanner cannot see.
        // Changing this would have stopped escrow auto-releasing.
        expect(source('src/app/api/cron/release-escrow/route.ts'))
            .toContain('where("status", "==", "delivered")');
        expect(source('src/app/actions/order-management.ts'))
            .toContain('status: "delivered"');
    });
});

describe('the stranded-payment recovery can find a stranded payment', () => {
    it('queries the spelling the claim writes', () => {
        // THE test. One L in the write, two in the query, eighty lines apart in
        // one file.
        const src = source('src/infrastructure/payments/service.ts');

        expect(src).toContain('where("status", "==", "pending_fulfilment")');
        expect(src).toContain('status: "pending_fulfilment"');
    });

    it('the two-L spelling appears nowhere in code', () => {
        // Comments and log lines still say "fulfillment" in prose, which is
        // harmless; a query or a write must not.
        const codeHits = occurrences('pending_fulfillment')
            .filter((line) => {
                const body = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*');
            })
            .filter((line) => /where\(|status:/.test(line));

        expect(codeHits).toEqual([]);
    });

    it('agrees with the reconciler that was already right', () => {
        expect(source('src/app/api/cron/reconcile-fulfilment/route.ts'))
            .toContain('"pending_fulfilment"');
    });
});

describe('the scanner that narrowed the search', () => {
    it('runs and returns a readable number of leads', () => {
        // A lead list, not a gate. It went through three revisions to get here:
        // per-payload, then file-wide, then including union-typed parameters.
        //
        //   #822 RAISED FROM 15 TO 18, and the three new leads are all the same
        //   known blind spot rather than a new defect.
        //
        //   The WAVE shipments screen gained five counted cards, so the action
        //   now QUERIES wave_shipments for "in_transit", "delivered" and
        //   "cancelled". The scanner reports that the only value ever WRITTEN
        //   to that collection is "pending", which reads like three dead
        //   queries.
        //
        //   IT IS NOT. updateShipmentStatusAction writes all four, and
        //   /admin/wave/shipments calls it — but its parameter is typed
        //   `ShipmentTracking["status"]`, an INDEXED ACCESS type. The revision
        //   that taught this scanner about union-typed parameters (see the test
        //   directly below) resolves an inline union and not an indexed access,
        //   so the values are invisible to it.
        //
        //   CHECKED RATHER THAN ASSUMED: the writer is
        //   src/app/actions/wave/_wv_shipments.ts:_updateShipmentStatusAction,
        //   and its caller is src/app/admin/wave/shipments/page.tsx:190.
        //
        //   Raised rather than the scanner extended: teaching it indexed access
        //   types is a real change to the instrument, and doing that while
        //   using its output to judge a change is how an instrument gets bent
        //   to fit the measurement.
        const drift = statusVocabularyDrift();

        expect(Array.isArray(drift)).toBe(true);
        expect(drift.length).toBeLessThan(18);
    });

    it('no longer reports a status set through a union-typed parameter', () => {
        // `moderateReviewAction(id, status: "approved" | "rejected")` writes
        // `{ status }`, so the literal exists only in the type. All three review
        // collections were reported as never writing "approved" before this.
        const drift = statusVocabularyDrift();
        const reviewDrift = drift.filter(
            (d) => d.collection.includes('REVIEWS') && d.queried === 'approved'
        );

        expect(reviewDrift).toEqual([]);
    });

    it('still finds a value written nowhere at all', () => {
        /*
         *   Vacuity guard: a scanner tuned until it reports nothing is not a
         *   scanner. A collection queried for a status no file writing it ever
         *   names must still surface.
         *
         *   #705 — THIS GUARD USED TO BE VACUOUS ITSELF, which is the whole
         *   reason it is rewritten rather than tidied. It read:
         *
         *       expect(drift.every((d) => typeof d.queried === 'string')).toBe(true);
         *       expect(statusVocabularyDrift.length).toBeGreaterThanOrEqual(0);
         *
         *   BOTH LINES HOLD WHEN THE SCANNER RETURNS NOTHING. `[].every(...)`
         *   is `true` — that is what `every` means on an empty array. And
         *   `statusVocabularyDrift` is a FUNCTION: `.length` is its declared
         *   parameter count, not the size of anything it returns. It is 0, it
         *   is always >= 0, and it would be for any function ever written here.
         *
         *   So the guard against "a scanner that reports nothing" was the one
         *   assertion in this file that could not detect a scanner reporting
         *   nothing.
         *
         *   TIED TO THE CORPUS INSTEAD. What must not silently become empty is
         *   the set of files and collections the scan runs over: a refactor
         *   that moves the source tree, or a glob that stops matching, takes
         *   these to zero and fails here. The drift COUNT is deliberately not
         *   asserted — it is allowed to reach zero, and a guard demanding that
         *   defects still exist is worse than no guard at all.
         */
        const sites = scanWriteSites();
        expect(sites.length).toBeGreaterThanOrEqual(250);
        expect(new Set(sites.map((s) => s.collection)).size).toBeGreaterThanOrEqual(60);

        //   The shape check, now made over a corpus proven non-empty above.
        expect(statusVocabularyDrift().every((d) => typeof d.queried === 'string')).toBe(true);
    });
});
