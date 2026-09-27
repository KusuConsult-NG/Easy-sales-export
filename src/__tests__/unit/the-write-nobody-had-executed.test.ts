/**
 * @jest-environment node
 */

/**
 *   #967 THE OWNER IS ASKED TO RUN A WRITE AGAINST PRODUCTION, AND NOTHING HAD
 *        EVER EXECUTED THE PART THAT DECIDES WHAT IT WRITES.
 *
 *   `npm run backfill:exportgoals -- --apply` has sat on the owner's list for
 *   several sessions. maintenance-scripts-do-not-overstate already RECORDS this
 *   script as one of three nothing executes — so the shape was known and the
 *   consequence was not: the decision about which export-window rows get written
 *   was inlined in a module that builds its Supabase client at import time, and
 *   therefore unreachable by any test.
 *
 *   kindOf and goalOf were already extracted and are covered by
 *   export-window-kind-and-goal. The decision BETWEEN them was not — never
 *   overwrite a goal an admin set by hand, report an aggregation whose goal
 *   cannot be computed, correct a wrong windowKind either way — and that is the
 *   part whose mistakes land on real money: fundingGoal is what every "is this
 *   window full" comparison reads.
 *
 *   Third instance of #366's shape in this programme: #366 found hub-guard never
 *   run, #965 found requireSession never run, this found a production write's
 *   decision never run.
 *
 * ── WHAT THIS COVERS AND WHAT IT DOES NOT ───────────────────────────────────
 *
 *   COVERS: every branch of planRow, which is what decides the patch.
 *
 *   DOES NOT COVER: the paging loop and the re-read-then-update in `apply()`.
 *   Those need a Supabase double and are mechanical; the decision is where the
 *   judgement lives. Recorded as a limit rather than implied away — and worth
 *   saying that `apply()` re-reads each row before merging, so it is not writing
 *   from the stale read the plan was built on.
 */

import { describe, it, expect } from '@jest/globals';
import { planRow } from '../../../scripts/export-funding-goal-kind';

/** An aggregation window whose goal is computable: 200 x ₦5,000. */
const computable = { windowKind: 'aggregation', targetVolume: 200, slotPrice: 5000 };

describe('#967 — what the export-window backfill decides, executed', () => {
    it('AN AGGREGATION WITH NO GOAL GETS ONE, COMPUTED FROM VOLUME x SLOT PRICE', () => {
        const plan = planRow({ ...computable });

        expect(plan.outcome).toBe('patch');
        if (plan.outcome !== 'patch') return;
        expect(plan.patch).toEqual({ fundingGoal: 1_000_000 });
        expect(plan.goal).toBe(1_000_000);
    });

    it('AND A GOAL AN ADMIN ALREADY SET BY HAND IS NEVER OVERWRITTEN', () => {
        /*
         *   The assertion that protects real data. A window an operator capped by
         *   hand must come back as already-correct, not be recomputed — the script
         *   says so in as many words and nothing had checked it.
         */
        const plan = planRow({ ...computable, fundingGoal: 750_000 });

        expect(plan).toEqual({ outcome: 'already-correct' });
    });

    it('including a hand-set goal that DISAGREES with the computation', () => {
        //   The case where "never overwritten" earns its keep: the computed value
        //   is 1,000,000 and the stored one is 1. Recomputing would raise the bar
        //   on a window an operator deliberately lowered.
        const plan = planRow({ ...computable, fundingGoal: 1 });

        expect(plan).toEqual({ outcome: 'already-correct' });
    });

    it('but a zero or negative stored goal is NOT treated as hand-set', () => {
        //   0 is what a broken writer leaves behind, not a decision. Both fall
        //   through to the computation.
        expect(planRow({ ...computable, fundingGoal: 0 }).outcome).toBe('patch');
        expect(planRow({ ...computable, fundingGoal: -5 }).outcome).toBe('patch');
    });

    it('AN AGGREGATION WHOSE GOAL CANNOT BE COMPUTED IS REPORTED, NOT GUESSED', () => {
        /*
         *   The refusal. A window with no usable targetVolume x slotPrice gets no
         *   fundingGoal at all — a 0 would read as "already full" to everything
         *   comparing against it, which is the defect the script's own header
         *   names for shipment windows and which applies here too.
         */
        const plan = planRow({ windowKind: 'aggregation' });

        expect(plan).toEqual({
            outcome: 'skip',
            reason: 'aggregation window with no usable targetVolume x slotPrice',
        });
    });

    it('A SHIPMENT WINDOW GETS A KIND AND NEVER A GOAL', () => {
        /*
         *   A private export request has no investors and nothing to overfund.
         *
         *   AND THE FIXTURE MATTERS: my first draft used { targetVolume, slotPrice }
         *   and expected a shipment. kindOf reads a non-zero slotPrice OR
         *   targetVolume as AGGREGATION, so that row is an aggregation with a
         *   computable goal — the opposite of the case. A row is a shipment only
         *   when it carries neither figure and is not `open`.
         */
        const plan = planRow({});

        expect(plan.outcome).toBe('patch');
        if (plan.outcome !== 'patch') return;
        expect(plan.patch).toEqual({ windowKind: 'shipment' });
        expect(plan.patch).not.toHaveProperty('fundingGoal');
        expect(plan.goal).toBeNull();
    });

    it('and a shipment already labelled is left alone entirely', () => {
        expect(planRow({ windowKind: 'shipment' })).toEqual({ outcome: 'already-correct' });
    });

    it('A ROW CAN BE REPORTED UNUSABLE AND STILL HAVE ITS KIND CORRECTED — the case nobody would guess', () => {
        /*
         *   The branch that reads like a contradiction and is not one. An
         *   aggregation window mislabelled `shipment`, with no computable goal:
         *   the goal is what could not be worked out, the kind is a separate fact
         *   that could, and the script writes the one while reporting the other.
         *
         *   Pinned because tidying it — returning `skip` and stopping — would
         *   silently stop correcting the kind on exactly these rows, and nothing
         *   would have noticed.
         */
        /*
         *   AND AN EXPLICIT windowKind CAN NEVER BE THE MISLABEL. kindOf returns a
         *   valid `windowKind` unchanged, so the kind patch fires only where the
         *   field is absent or invalid — my first draft used
         *   { windowKind: 'shipment', fundingModel: 'aggregation' } and got
         *   already-correct, because `fundingModel` is not consulted anywhere.
         *
         *   `status: 'open'` is the real route to this branch: it makes the row an
         *   aggregation by kindOf's third rule while leaving the goal uncomputable,
         *   since goalOf needs BOTH targetVolume and slotPrice above zero.
         */
        const plan = planRow({ status: 'open' });

        expect(plan.outcome).toBe('patch');
        if (plan.outcome !== 'patch') return;
        expect(plan.patch).toEqual({ windowKind: 'aggregation' });
        expect(plan.skipReason).toBe('aggregation window with no usable targetVolume x slotPrice');
        expect(plan.goal).toBeNull();
    });

    it('AND A HAND-SET GOAL ON A MISLABELLED WINDOW KEEPS THE GOAL AND FIXES THE LABEL', () => {
        //   The other half of the same asymmetry: already-correct is returned only
        //   when there is nothing else to write.
        const plan = planRow({ status: 'open', fundingGoal: 750_000 });

        expect(plan.outcome).toBe('patch');
        if (plan.outcome !== 'patch') return;
        expect(plan.patch).toEqual({ windowKind: 'aggregation' });
        expect(plan.patch).not.toHaveProperty('fundingGoal');
    });

    it('and a row carrying only one of the two figures is reported, not half-computed', () => {
        //   goalOf needs BOTH above zero. One alone makes the row an aggregation by
        //   kindOf's second rule and still yields no goal — so it is written for its
        //   kind and reported for its goal.
        const plan = planRow({ targetVolume: 200 });

        expect(plan.outcome).toBe('patch');
        if (plan.outcome !== 'patch') return;
        expect(plan.patch).toEqual({ windowKind: 'aggregation' });
        expect(plan.skipReason).toBeDefined();
    });
});
