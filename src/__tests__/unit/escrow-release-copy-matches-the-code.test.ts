/**
 * @jest-environment node
 */

/**
 *   #390 SIX SCREENS DESCRIBED THE ESCROW RELEASE, AND NO TWO OF THEM SAID THE
 *        SAME WRONG THING.
 *
 *        The measurement, the six statements and what each got wrong are in
 *        lib/escrow-release-copy.ts. The short version: confirming receipt
 *        moves the escrow to "delivered", and the cron pays the seller a fixed
 *        window later with nobody pressing anything. Two screens said an admin
 *        had to release it, one said the release was immediate, one told the
 *        seller they were waiting for a confirmation that had already happened,
 *        one asserted the money had arrived without reading the field that says
 *        so, and an unreachable notification helper said the buyer's
 *        confirmation is what pays out.
 *
 *   WHAT THIS FILE PINS, AND WHY EACH ASSERTION EXISTS
 *   --------------------------------------------------
 *   1. THE WINDOW IS ONE NUMBER. The cron's threshold and every sentence a
 *      buyer or seller reads come from ESCROW_DELIVERED_AUTO_RELEASE_HOURS. A
 *      literal `24 * 60 * 60 * 1000` back in the route is how the text and the
 *      timer drift apart again, so the route is scanned for one.
 *
 *   2. THE OLD SENTENCES ARE GONE from the screens that carried them. Written
 *      as a per-file scan of code with comments stripped: this file and the
 *      screens' own repair notes both quote the old text, and a raw grep would
 *      rediscover the write-up. That is the tombstone trap, which has fired
 *      twice in this audit (#383, #384).
 *
 *   3. THE SELLER'S PANEL BRANCHES on whether the escrow was released, rather
 *      than asserting either way. Both false branches were separately wrong.
 *
 *   WHAT IT DELIBERATELY DOES NOT PIN
 *   ---------------------------------
 *   The exact wording. Copy is meant to be editable; what must not change
 *   silently is that it names the window and the dispute deadline, so those
 *   are asserted as facts the sentence must contain, not as strings.
 *
 *   TWO SENTENCES WERE MEASURED AND LEFT ALONE — "funds are locked and will
 *   only release once you confirm receipt", and the list header's version of
 *   it. With the seven-day loop unreachable (requestEscrowReleaseAction has no
 *   caller, so releaseRequestedAt is never written), confirming really is the
 *   buyer-side trigger and both are true. There is an assertion below that the
 *   seven-day path is still unreachable, because the day somebody wires it up,
 *   those two sentences become false and nothing else would notice.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     put the window back as a literal in the cron          KILLED
 *     restore the admin-release sentence on a screen        KILLED
 *     drop the dispute deadline from the success message    KILLED
 *     seller list stops branching on escrowReleased         KILLED
 *     seller list asserts the money arrived, unconditionally KILLED
 *     seller detail drops the confirmed-by-buyer branch     KILLED
 *     reword the success message, keeping both its facts    SURVIVED, intended
 *
 *   THE FIRST RUN OF THAT HARNESS FAILED TWO WAYS, AND BOTH WERE THIS FILE'S
 *   FAULT RATHER THAN THE MUTANTS':
 *
 *     - the control DIED, because the buyer assertion required the word
 *       "released" and the reword said "paid". A test that pins vocabulary
 *       fails on correct copy, which is the false positive that reads like a
 *       finding.
 *     - the branch mutant SURVIVED, because the assertion was `toContain
 *       ('order.escrowReleased')` and the className ternary sitting beside the
 *       text satisfied it while the text itself had gone back to lying.
 *
 *   Both assertions were rewritten and both are recorded here rather than
 *   quietly corrected: a harness that is adjusted until it agrees with itself
 *   proves nothing.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ESCROW_DELIVERED_AUTO_RELEASE_HOURS,
    ESCROW_DELIVERED_AUTO_RELEASE_MS,
    CONFIRM_RECEIPT_PROMPT,
    CONFIRM_RECEIPT_SUCCESS,
    SELLER_AWAITING_AUTO_RELEASE,
    SELLER_COMPLETED_NOT_RELEASED,
} from '@/lib/escrow-release-copy';

const SRC = join(process.cwd(), 'src');

const code = (rel: string) =>
    stripComments(readFileSync(join(SRC, rel), 'utf-8'), { label: rel });

const BUYER_DETAIL = 'app/marketplace/buyer/orders/[id]/page.tsx';
const BUYER_LIST = 'app/marketplace/buyer/orders/page.tsx';
const SELLER_DETAIL = 'app/marketplace/seller/orders/[id]/page.tsx';
const SELLER_LIST = 'app/marketplace/seller/orders/page.tsx';
const CRON = 'app/api/cron/release-escrow/route.ts';
const NOTIFICATIONS = 'lib/marketplace-notifications.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#390 — the window is one number, shared with the timer', () => {
    it('THE CRON READS THE SAME CONSTANT THE COPY IS BUILT FROM', () => {
        const cron = code(CRON);
        expect(cron).toContain('ESCROW_DELIVERED_AUTO_RELEASE_MS');
        // And no threshold in this route is a bare number. Anchored on
        // `Date.now() - <digit>` rather than on the arithmetic itself: the
        // seven-day loop legitimately converts ESCROW_AUTO_RELEASE_DAYS to
        // milliseconds with the same `24 * 60 * 60 * 1000`, and a scan that
        // could not tell those apart would fail on correct code — which is the
        // worst kind of failure, because it reads like a finding.
        expect(/Date\.now\(\)\s*-\s*\d/.test(cron)).toBe(false);
    });

    it('and the two forms of the constant agree', () => {
        expect(ESCROW_DELIVERED_AUTO_RELEASE_MS).toBe(
            ESCROW_DELIVERED_AUTO_RELEASE_HOURS * 60 * 60 * 1000,
        );
        expect(ESCROW_DELIVERED_AUTO_RELEASE_HOURS).toBeGreaterThan(0);
    });

    it('and every sentence that promises a deadline states that number', () => {
        const window = String(ESCROW_DELIVERED_AUTO_RELEASE_HOURS);
        for (const sentence of [
            CONFIRM_RECEIPT_PROMPT,
            CONFIRM_RECEIPT_SUCCESS,
            SELLER_AWAITING_AUTO_RELEASE,
        ]) {
            expect(sentence).toContain(window);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#390 — what the copy must tell each party', () => {
    it('THE BUYER IS TOLD THE RELEASE IS AUTOMATIC AND THAT A DISPUTE IS THE WAY OUT', () => {
        // The two facts, not the wording. A buyer who believes a person still
        // has to act believes they have longer than they do.
        for (const sentence of [CONFIRM_RECEIPT_PROMPT, CONFIRM_RECEIPT_SUCCESS]) {
            expect(sentence).toMatch(/dispute/i);
            // "released" OR "paid": the FACT is that the money moves on its
            // own, and pinning one verb makes this a copy test. The mutation
            // run caught that — a reword that kept both facts was killed by
            // the first version of this line, which is a false positive
            // wearing a passing suite's clothes.
            expect(sentence).toMatch(/released?|paid/i);
        }
    });

    it('and the seller is told the buyer HAS confirmed, not that it is awaited', () => {
        expect(SELLER_AWAITING_AUTO_RELEASE).toMatch(/has confirmed/i);
        expect(SELLER_AWAITING_AUTO_RELEASE).not.toMatch(/awaiting buyer/i);
    });

    it('and an unreleased completed order does not claim the money arrived', () => {
        expect(SELLER_COMPLETED_NOT_RELEASED).toMatch(/not (yet )?reach|has not/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#390 — no screen states the rule by hand any more', () => {
    it('THE FOUR SCREENS READ THE SHARED COPY', () => {
        expect(code(BUYER_DETAIL)).toContain('CONFIRM_RECEIPT_SUCCESS');
        expect(code(BUYER_DETAIL)).toContain('CONFIRM_RECEIPT_PROMPT');
        expect(code(BUYER_LIST)).toContain('CONFIRM_RECEIPT_SUCCESS');
        expect(code(BUYER_LIST)).toContain('CONFIRM_RECEIPT_PROMPT');
        expect(code(SELLER_DETAIL)).toContain('SELLER_AWAITING_AUTO_RELEASE');
        expect(code(SELLER_LIST)).toContain('SELLER_COMPLETED_NOT_RELEASED');
    });

    it('and none of the six old sentences survives in any of them', () => {
        // Scanned with comments stripped: this file and the screens' own repair
        // notes quote the old text, and a raw scan would find its own tombstone.
        const WRONG = [
            /pending admin release/i,
            /ready for admin release/i,
            /this will release funds to the seller/i,
            /awaiting buyer confirmation/i,
        ];
        for (const rel of [BUYER_DETAIL, BUYER_LIST, SELLER_DETAIL, SELLER_LIST, NOTIFICATIONS]) {
            const src = code(rel);
            for (const wrong of WRONG) {
                expect({ file: rel, matched: wrong.source, hit: wrong.test(src) })
                    .toEqual({ file: rel, matched: wrong.source, hit: false });
            }
        }
    });

    it('and the seller panels BRANCH on escrowReleased rather than asserting', () => {
        // Both of the old false branches were separately wrong: the detail page
        // said the buyer had not confirmed when they had, and the list said the
        // money had arrived without looking.
        //
        // Asserted as a TERNARY REACHING THE UNRELEASED COPY, not as the
        // presence of the field name. The mutation run killed the first
        // version of this: dropping the branch entirely and asserting the
        // money had arrived left `order.escrowReleased` in the className
        // beside it, so a `toContain` on the field passed over a screen that
        // had gone back to lying. Structure, not vocabulary.
        // The list: the arrival claim sits on the TRUE side of an
        // escrowReleased ternary whose false side is the shared constant.
        // A looser form of this passed a mutant that dropped the branch
        // entirely — the className ternary beside it satisfied every
        // "escrowReleased appears near a ?" pattern I tried.
        expect(
            /escrowReleased\s*\n?\s*\?\s*["'`][^"'`]*released[^"'`]*["'`]\s*\n?\s*:\s*`[^`]*\$\{SELLER_COMPLETED_NOT_RELEASED\}/
                .test(code(SELLER_LIST)),
        ).toBe(true);

        // The detail page: the "buyer has confirmed" line is reached only on
        // status "delivered". Told to a seller on any other status it is the
        // same false claim in the other direction.
        expect(
            /order\.status === "delivered"\s*\n?\s*\?\s*SELLER_AWAITING_AUTO_RELEASE/
                .test(code(SELLER_DETAIL)),
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#390 — the assumption the surviving copy rests on', () => {
    it('THE SEVEN-DAY RELEASE PATH IS STILL UNREACHABLE', () => {
        /**
         * Two sentences were measured as TRUE and left alone: escrow releases
         * to the seller only once the buyer confirms receipt. That holds
         * because the cron's other loop — release a "funded" escrow seven days
         * after `releaseRequestedAt` — can never fire: the only writer of that
         * field is requestEscrowReleaseAction, and nothing calls it.
         *
         * If somebody wires that action to a button, a seller can be paid
         * without the buyer confirming anything, and those two sentences become
         * false. Nothing else in the suite would notice, so this does.
         */
        const lifecycle = code('app/actions/marketplace/_escrow_lifecycle.ts');
        expect(lifecycle).toContain('releaseRequestedAt');

        const callers: string[] = [];
        const walk = (dir: string) => {
            for (const entry of require('fs').readdirSync(dir)) {
                const full = join(dir, entry);
                if (require('fs').statSync(full).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(full);
                } else if (/\.tsx?$/.test(entry)) {
                    const rel = full.slice(SRC.length + 1);
                    if (rel.startsWith('app/actions/marketplace/_escrow_lifecycle')) continue;
                    if (/requestEscrowReleaseAction/.test(stripComments(readFileSync(full, 'utf-8'), { label: rel }))) {
                        callers.push(rel);
                    }
                }
            }
        };
        walk(SRC);

        expect(callers).toEqual([]);
    });
});
