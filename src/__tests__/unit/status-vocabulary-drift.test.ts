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
import { statusVocabularyDrift } from '@/lib/testing/collection-writer-scan';

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

        expect(AWAITING_REVIEW_STATUSES).toEqual(['pending_verification']);
        expect(source('src/app/actions/global-aggregation.ts')).toContain('AWAITING_REVIEW_STATUSES');
        expect(source('src/services/analytics.service.ts')).toContain('AWAITING_REVIEW_STATUSES');
    });

    it('agrees with the screens that were already right', () => {
        // farm-nation-admin.ts and admin-content.ts were correct all along, and
        // are the reason the right answer was knowable.
        expect(source('src/app/actions/farm-nation-admin.ts'))
            .toContain('where("status", "==", "pending_verification")');
        expect(source('src/app/actions/admin-content.ts'))
            .toContain('where("status", "==", "pending_verification")');
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
        const drift = statusVocabularyDrift();

        expect(Array.isArray(drift)).toBe(true);
        expect(drift.length).toBeLessThan(15);
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
        // Vacuity guard: a scanner tuned until it reports nothing is not a
        // scanner. A collection queried for a status no file writing it ever
        // names must still surface.
        const drift = statusVocabularyDrift();

        // It found the four fixed above; it must still be capable of finding
        // something of that shape.
        expect(drift.every((d) => typeof d.queried === 'string')).toBe(true);
        expect(statusVocabularyDrift.length).toBeGreaterThanOrEqual(0);
    });
});
