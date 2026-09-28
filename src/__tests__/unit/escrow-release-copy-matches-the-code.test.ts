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
 *   TWO SENTENCES WERE MEASURED AND LEFT ALONE BY #390, AND #968 CAME FOR THEM
 *   — "funds are locked and will only release once you confirm receipt", and the
 *   list header's version of it. Both were true while the only automatic release
 *   ran from a status the buyer put the row in: confirming really was the
 *   buyer-side trigger. #390 said so and left them, and recorded that the day
 *   somebody wired up the seven-day loop they would become false.
 *
 *   That day was #968, and it did not arrive by somebody wiring up the old
 *   action — it arrived by the loop being re-pointed at DISPATCH, which the
 *   seller does. Inaction no longer holds the money. Both sentences are now
 *   ESCROW_HELD_UNTIL_RELEASE, which names both deadlines, and the assertion
 *   below is re-pointed with them: the property that matters is no longer "the
 *   seven-day path is unreachable" but "no release path runs from a field the
 *   copy does not describe".
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
    ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS,
    DISPATCH_NOTICE_FOR_BUYER,
    DISPATCH_NOTICE_FOR_SELLER,
    ESCROW_HELD_UNTIL_RELEASE,
} from '@/lib/escrow-release-copy';

const SRC = join(process.cwd(), 'src');

const code = (rel: string) =>
    stripComments(readFileSync(join(SRC, rel), 'utf-8'), { label: rel });

const BUYER_DETAIL = 'app/marketplace/buyer/orders/[id]/BuyerOrderDetailClient.tsx';
const BUYER_LIST = 'app/marketplace/buyer/orders/BuyerOrdersClient.tsx';
const SELLER_DETAIL = 'app/marketplace/seller/orders/[id]/SellerOrderDetailClient.tsx';
const SELLER_LIST = 'app/marketplace/seller/orders/SellerOrdersClient.tsx';
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
describe('#968 — no release path runs from a field the copy does not describe', () => {
    /*
     *   THIS CONTROL REPLACES "THE SEVEN-DAY RELEASE PATH IS STILL UNREACHABLE".
     *
     *   That test guarded a real thing: the copy on the buyer's screens assumed
     *   only a buyer could start a payout, and the seven-day loop would have
     *   falsified it. It asserted the loop stayed dead by walking the tree for
     *   callers of requestEscrowReleaseAction.
     *
     *   #968 retired the assumption instead of the loop. Dispatch now starts a
     *   payout, the copy says so, and "is the old action still uncalled" no
     *   longer protects anything — it would sit green while a THIRD trigger was
     *   added from some other field, which is the same defect one field along.
     *
     *   So the property is stated directly: every field the cron runs a release
     *   deadline from must be one the shared copy module describes to the person
     *   whose money it is. `shippedAt` is described (DISPATCH_NOTICE_FOR_BUYER,
     *   ESCROW_HELD_UNTIL_RELEASE); `releaseRequestedAt` is not, and must
     *   therefore not gate a release.
     */
    it('THE CRON RUNS NO RELEASE DEADLINE FROM releaseRequestedAt', () => {
        //   The retired seven-day trigger. requestEscrowReleaseAction still
        //   exists and still writes this field — it was NOT deleted, because
        //   deleting it was not asked for — so what has to stay true is that the
        //   cron does not pay anybody because of it.
        const cron = code(CRON);
        expect(cron).not.toContain('releaseRequestedAt');
    });

    it('and the deadline it DOES run from is the one the buyer is told about', () => {
        const cron = code(CRON);
        expect(cron).toContain('shippedAt');

        //   Both sentences a buyer can reach must name the dispatch window, or
        //   the clock is running somewhere they were never shown.
        for (const sentence of [DISPATCH_NOTICE_FOR_BUYER, ESCROW_HELD_UNTIL_RELEASE]) {
            expect(sentence).toContain(String(ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS));
        }
    });

    it('and the dispatch notification carries it, because that is all a silent buyer gets', () => {
        /*
         *   A buyer who never opens the app again is still paid out of. The
         *   24-hour window sits behind a button they press, so a dialog is a
         *   fair place to state it; this one starts whatever they do, and the
         *   shipped notification is the only thing that reaches them first.
         */
        const notifications = code('lib/marketplace-notifications.ts');
        expect(notifications).toContain('DISPATCH_NOTICE_FOR_BUYER');
    });

    it('and the window is a shared constant, not a number typed into the route', () => {
        //   #390's rule, applied to the second window: the bare
        //   `ESCROW_AUTO_RELEASE_DAYS = 7` that used to live in the route is what
        //   let its notification copy drift from every screen.
        const cron = code(CRON);
        expect(cron).toContain('ESCROW_UNCONFIRMED_AUTO_RELEASE_MS');
        expect(cron).not.toMatch(/const\s+ESCROW_AUTO_RELEASE_DAYS\s*=/);
    });
});
