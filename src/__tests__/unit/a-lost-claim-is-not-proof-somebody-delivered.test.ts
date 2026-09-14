/**
 * @jest-environment node
 */

/**
 *   #723 #695 ESTABLISHED A RULE ABOUT MONEY AND NOTHING PROTECTS IT.
 *
 *   The rule: a payment path that loses the claim on a reference and then tells
 *   the payer it worked must first establish that whoever WON the claim
 *   actually delivered. #259 made a lost claim a success, which was right — a
 *   charged buyer must not be told "Payment already processed" as an error.
 *   #531 then made the webhook a claimant that does NOT fulfil. Composed, those
 *   two correct fixes tell a paying buyer their order succeeded over an order
 *   nobody fulfilled.
 *
 *   #695 fixed the paths it found and introduced lib/claim-outcome for it.
 *
 *   THAT LEFT NO CHECK. `lostClaimWasFulfilled` appears in no test in this
 *   repository. claimed-payment-outcomes.test.ts sweeps every claim site for
 *   the two NEIGHBOURING properties — "a duplicate is not reported as a
 *   failure" (#259) and "every site can record a fulfilment that died" (#259
 *   half two) — and not for this one. So the twelfth claim site is the one at
 *   risk, exactly as every-api-route-has-a-door.test.ts argues for routes.
 *
 * ── THE SWEEP FOUND ONE, AND THE REST WERE ALREADY SOUND ────────────────────
 *
 *   THE ONE: submitRepaymentAction returned success on the strength of the lost
 *   claim alone. Its reasoning — "already applied, a success not an error" —
 *   holds only while nothing ELSE can hold that reference, and something can.
 *   `processed_payments.id` is ONE namespace shared by eleven Paystack
 *   processors, escrow funding and this; and this reference is not generated,
 *   it is a bank reference an ADMIN TYPES IN. A collision lost the claim and
 *   told the admin the repayment was recorded when it was not — the borrower
 *   still owed the money and the screen said otherwise. It checks the winning
 *   row's status now; see cooperative-loan-repayment.test.ts.
 *
 *   THE REST were correct already, in FIVE different ways, which is worth
 *   writing down because a checker recognising only the first would report four
 *   false defects — and mine did, twice, before it was right:
 *
 *     CHECKS-STATUS       lostClaimWasFulfilled(claim.status) — #695's own
 *                         mechanism. export orders, export investments,
 *                         academy registration, cooperative payment,
 *                         farm-nation.
 *
 *     VERIFIES-DELIVERY   asks whether the THING is delivered rather than what
 *                         the bookkeeping row says. marketplace
 *                         _payment_verify calls findFulfilledOrder; the
 *                         cooperative verify route re-reads the membership.
 *                         Stronger than reading a status.
 *
 *     REPAIRS             falls through and re-runs an idempotent fulfilment
 *                         instead of returning. #258's design: it costs one
 *                         read when the payer really is served and FIXES them
 *                         when they are not. academy course purchase, and the
 *                         enrolment sync.
 *
 *     REFUSES             returns an error and does not pretend. Escrow funding
 *                         does this deliberately: one reference funds one
 *                         escrow, and a second use is a real conflict. The
 *                         repayment fix above joins this shape for a collision.
 *
 *     REPAIRS-IN-BRANCH   performs the fulfilment write itself before reporting
 *                         success — the same mechanism as falling through, done
 *                         inside the branch. The academy enrolment sync.
 *
 *   A fifth shape is fine and needs nothing: a webhook PROCESSOR returns void
 *   on a lost claim. It tells nobody anything; the route decides.
 *
 * ── MY INSTRUMENT WAS WRONG TWICE BEFORE IT WAS RIGHT ───────────────────────
 *
 *   Recorded because either error, believed, would have produced a false
 *   finding about money.
 *
 *   1. IT TESTED FOR REFUSAL FIRST. Every correctly-guarded branch CONTAINS a
 *      refusal — that is the guard's failure arm. So `success: false` matched
 *      first and export-payment.ts, which I had just read and knew calls
 *      lostClaimWasFulfilled, was reported as merely refusing. A verdict that
 *      cannot tell "guarded" from "unguarded" is not a measurement. Positive
 *      evidence is tested first now.
 *
 *   2. IT SELECTED BRANCHES BY FILE. Any `if (!x.claimed)` in a file that
 *      called claimPaymentOnce anywhere was counted — so
 *      _loans_repayments.ts's `claimIdempotencyKey` gate, which is a different
 *      function with a DETERMINISTIC key, was flagged. That is the
 *      file-level-versus-use-level trap #704 and #707 each had a mutant
 *      survive on, and this file is the third time it has appeared in this
 *      audit. Each branch is now bound to the claim variable it guards.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/** Every file that claims a payment reference, derived rather than listed. */
function claimSiteFiles(): string[] {
    return execSync(
        "grep -rl 'claimPaymentOnce(' src --include=*.ts | grep -v __tests__ | grep -v wallet-ledger.ts",
        { cwd: ROOT },
    ).toString().trim().split('\n').filter(Boolean).sort();
}

/** The braced body starting at the first `{` at or after `from`. */
function bracedBody(src: string, from: number): { body: string; end: number } {
    const open = src.indexOf('{', from);
    if (open === -1) return { body: '', end: from };
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return { body: src.slice(open, i + 1), end: i + 1 };
        }
    }
    return { body: src.slice(open), end: src.length };
}

export type LostClaimVerdict =
    | 'checks-status'
    | 'verifies-delivery'
    | 'repairs'
    | 'refuses'
    | 'returns-void'
    | 'unverified-success';

interface Branch { file: string; verdict: LostClaimVerdict }

/**
 * Classify the lost-claim branch guarding each claimPaymentOnce call.
 *
 * BOUND TO THE CLAIM, NOT TO THE FILE. The branch has to test the variable the
 * claim was assigned to, and has to be the first such test after it — which is
 * what stops an unrelated idempotency gate elsewhere in the same file being
 * counted as this claim's guard.
 */
export function classifyLostClaimBranches(files: string[]): Branch[] {
    const found: Branch[] = [];

    for (const file of files) {
        const src = stripComments(readFileSync(join(ROOT, file), 'utf8'), { label: file });

        for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+claimPaymentOnce\s*\(/g)) {
            const varName = m[1];
            const after = src.slice(m.index ?? 0);
            const guard = new RegExp(`if\\s*\\(\\s*!\\s*${varName}\\.claimed\\s*\\)`).exec(after);
            if (!guard) continue;

            const { body } = bracedBody(after, (guard.index ?? 0) + guard[0].length);

            //   Either the shared helper, or a direct read of the status
            //   claim_payment_once returns. #723's repayment fix takes the
            //   second route: `lostClaimWasFulfilled` answers "did the winner
            //   fulfil SOMETHING", and that branch needs "did the winner fulfil
            //   THIS KIND OF THING" — a reference collision with a Paystack
            //   payment is `completed`, which the shared helper calls fulfilled.
            const checksStatus = body.includes('lostClaimWasFulfilled')
                || new RegExp(`${varName}\\.status`).test(body);
            const verifies = /findFulfilledOrder|syncAlreadyProcessed|\.get\(\)/.test(body);
            //   A branch that performs the fulfilment WRITE itself before
            //   reporting success is repairing, not trusting — the same
            //   mechanism as falling through, done inside the branch. The
            //   academy enrolment sync is this shape.
            const repairsInBranch = /\.set\(|\.update\(/.test(body);
            const reportsSuccess = /success:\s*true/.test(body);
            const refuses = /success:\s*false|throw\s+new|status:\s*[45]\d\d/.test(body);
            const returns = /\breturn\b/.test(body);

            //   POSITIVE EVIDENCE FIRST. See the note in this file's header:
            //   testing refusal first swallows every guarded branch, because a
            //   guard's whole purpose is to have a failure arm.
            let verdict: LostClaimVerdict;
            if (checksStatus) verdict = 'checks-status';
            else if (verifies) verdict = 'verifies-delivery';
            else if (!returns || repairsInBranch) verdict = 'repairs';
            else if (reportsSuccess && !refuses) verdict = 'unverified-success';
            else if (refuses) verdict = 'refuses';
            else verdict = 'returns-void';

            found.push({ file, verdict });
        }
    }

    return found;
}

const RECOGNISED: LostClaimVerdict[] = [
    'checks-status', 'verifies-delivery', 'repairs', 'refuses', 'returns-void',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#723 — no payment path calls a lost claim a success without establishing one', () => {
    const branches = classifyLostClaimBranches(claimSiteFiles());

    it('THE SWEEP IS READING THE APPLICATION', () => {
        /*
         *   Vacuity guard, first. A checker that found no files, or bound no
         *   branches, would report a clean platform while checking nothing —
         *   which is the shape #705 is entirely about.
         */
        expect(claimSiteFiles().length).toBeGreaterThanOrEqual(10);
        expect(branches.length).toBeGreaterThanOrEqual(12);
        //   And it must actually be seeing the guarded ones, or "0 unverified"
        //   is just "0 recognised".
        expect(branches.filter((b) => b.verdict === 'checks-status').length)
            .toBeGreaterThanOrEqual(4);
    });

    it('NOT ONE REPORTS SUCCESS ON A LOST CLAIM WITHOUT EVIDENCE', () => {
        //   THE rule #695 established. Named per file so a failure says where.
        const unverified = branches
            .filter((b) => b.verdict === 'unverified-success')
            .map((b) => b.file);

        expect(unverified).toEqual([]);
    });

    it('AND EVERY BRANCH IS ONE OF THE FIVE SHAPES THAT ARE SOUND', () => {
        //   A sixth shape is not automatically wrong — it is unreviewed, which
        //   on a money path is the thing to stop and look at.
        const unrecognised = branches.filter((b) => !RECOGNISED.includes(b.verdict));
        expect(unrecognised).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#723 — and the checker can actually fail', () => {
    /*
     *   #705's rule, applied to this file: a sweep that reports nothing
     *   protects nothing unless a planted defect is caught. The classifier is
     *   exported and run against source written here, so the calibration does
     *   not require breaking a real money path.
     */

    const withSource = (body: string): LostClaimVerdict => {
        const tmp = join(ROOT, 'src/lib/testing/__lost_claim_probe.ts');
        try {
            require('fs').writeFileSync(tmp, body);
            const [branch] = classifyLostClaimBranches(['src/lib/testing/__lost_claim_probe.ts']);
            return branch?.verdict ?? ('none' as LostClaimVerdict);
        } finally {
            try { require('fs').unlinkSync(tmp); } catch { /* nothing to clean */ }
        }
    };

    it('A BRANCH THAT JUST REPORTS SUCCESS IS CAUGHT', () => {
        expect(withSource(`
            const claim = await claimPaymentOnce({ reference });
            if (!claim.claimed) {
                return { success: true };
            }
        `)).toBe('unverified-success');
    });

    it('AND ONE THAT CHECKS THE STATUS IS NOT', () => {
        expect(withSource(`
            const claim = await claimPaymentOnce({ reference });
            if (!claim.claimed) {
                if (!lostClaimWasFulfilled(claim.status)) {
                    return { success: false, error: UNFULFILLED_CLAIM_MESSAGE };
                }
                return { success: true };
            }
        `)).toBe('checks-status');
    });

    it('AND A GUARD ON A DIFFERENT CLAIM IS NOT MISTAKEN FOR THIS ONE', () => {
        /*
         *   THE SECOND INSTRUMENT ERROR, pinned so it cannot come back. A file
         *   may hold an unrelated idempotency gate — _loans_repayments.ts holds
         *   claimIdempotencyKey with a deterministic key — and binding by file
         *   rather than by variable reported it as this claim's guard.
         */
        /*
         *   THE UNRELATED GATE SITS AFTER THE CLAIM, and the first version of
         *   this probe put it before — where searching forward from the claim
         *   never reaches it, so the mutant that binds by file instead of by
         *   variable SURVIVED. A probe that cannot distinguish the two
         *   implementations does not test the distinction it is named for.
         */
        expect(withSource(`
            const claim = await claimPaymentOnce({ reference });
            const gate = await claimIdempotencyKey({ key });
            if (!gate.claimed) {
                return { success: true };
            }
            if (!claim.claimed) {
                if (!lostClaimWasFulfilled(claim.status)) return { success: false };
                return { success: true };
            }
        `)).toBe('checks-status');
    });

    it('AND A REFUSAL INSIDE A GUARDED BRANCH DOES NOT HIDE THE GUARD', () => {
        //   The FIRST instrument error. Every guard has a failure arm, so a
        //   checker that matches `success: false` first classifies every
        //   correct branch as a bare refusal and finds nothing wrong anywhere.
        expect(withSource(`
            const claim = await claimPaymentOnce({ reference });
            if (!claim.claimed) {
                const settled = await findFulfilledOrder(reference);
                if (!settled.fulfilled) return { success: false };
                return { success: true };
            }
        `)).toBe('verifies-delivery');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   The subject here is the CHECKER, so the mutants are planted in the
 *   classifier and in a real money path, one at a time.
 *
 *     MUTANT                                                       RESULT
 *     THE DEFECT: the repayment's status check is removed           KILLED
 *     it uses the generic lostClaimWasFulfilled instead, which
 *       calls a colliding Paystack `completed` row fulfilled        KILLED
 *     it refuses even a genuine re-recording (#259's rule lost)     KILLED
 *     the classifier tests `refuses` before the positive evidence   KILLED
 *     the classifier binds branches by file, not by claim variable  KILLED
 *       — SURVIVED first, and the PROBE was at fault: it put the
 *         unrelated gate BEFORE the claim, where searching forward
 *         never reaches it either way. A probe that cannot separate
 *         the two implementations does not test the distinction it
 *         is named for. The gate sits after the claim now.
 *
 *     SURVIVED, AND RECORDED RATHER THAN CHASED
 *     the vacuity guard's FILE floor is removed                     SURVIVED
 *       — and it is redundant, not missing. The same test also
 *         floors the number of BRANCHES at 12 and the guarded ones
 *         at 4, and neither can hold if the file sweep breaks. The
 *         floor stays because it names what it is protecting, but
 *         claiming a test kills it would have been false.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                            SURVIVED ✓
 *
 * ── WHAT THIS FILE IS WORTH ─────────────────────────────────────────────────
 *
 *   Nothing was broken when it was written, and that is the point: #695 fixed
 *   five paths by hand and the sixth would have been written without it. The
 *   four sound shapes are now named, so the next person adding a claim site has
 *   something to match rather than a rule to rediscover.
 */
