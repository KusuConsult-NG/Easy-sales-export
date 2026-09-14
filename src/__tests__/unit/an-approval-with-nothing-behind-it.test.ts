/**
 * @jest-environment node
 */

/**
 *   #725 THE SECOND FINDING THE FORENSIC REPORT COULD ONLY DESCRIBE.
 *
 *   The Farm Nation check reports two things that look alike and are not: an
 *   approval whose application DISAGREES with it, and an approval with no
 *   application findable under any key at all. Neither can be settled
 *   unattended, and the reason was written into the backfill cron months ago:
 *
 *       "The two available moves are to fabricate an application so the checker
 *        stops reporting it, or to revoke 45 people's approvals. The first makes
 *        the record lie; the second takes something away from members who may
 *        well be entitled to it."
 *
 *   THERE IS A THIRD MOVE, and it is the whole of this finding: an admin looks
 *   at the member and VOUCHES. Recording who confirmed it, when and why is a
 *   true statement about something that happened, and it is not a fabricated
 *   application.
 *
 * ── WHAT MUST NOT BE POSSIBLE ───────────────────────────────────────────────
 *
 *   Writing a row into FARM_NATION_APPLICATIONS. That is the one move that
 *   makes the report green by making the data lie, it is the obvious shortcut,
 *   and it is asserted against directly — because a later edit adding it would
 *   look like a helpful improvement.
 *
 *   The other two guards are about the decision being explainable afterwards:
 *   a reason long enough to be a sentence, and a decision that can actually
 *   settle the case in front of it. "Confirm" on a DRIFT case would leave two
 *   records still disagreeing while the admin believed they had handled it.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    decisionsFor,
    checkDecision,
    approvalPatch,
    isSettled,
} from '@/lib/farm-nation-approval-decision';

const REASON = 'Checked the paper file and the payment reference; this member is genuine.';

// ─────────────────────────────────────────────────────────────────────────────
describe('#725 — a decision that cannot settle the case is not offered', () => {
    it('AN APPROVAL WITH NO APPLICATION IS CONFIRMED OR REVOKED', () => {
        expect(decisionsFor('no-application')).toEqual(['confirm', 'revoke']);
    });

    it('AND DRIFT IS RECONCILED OR REVOKED — NEVER "CONFIRMED"', () => {
        /*
         *   THE distinction that makes the tool honest. "Confirm" on a drift
         *   case would record that an admin vouched while the two records went
         *   on disagreeing — the member still approved on one screen and
         *   pending on another, which is the complaint the scan exists to
         *   surface.
         */
        expect(decisionsFor('drift')).toEqual(['reconcile', 'revoke']);
        expect(decisionsFor('drift')).not.toContain('confirm');
    });

    it('AND THE SERVER REFUSES ONE THAT IS NOT ON THE LIST', () => {
        //   The screen offers what decisionsFor returns; the server re-derives
        //   it. A request can be edited, and this is the only place that
        //   matters.
        expect(checkDecision({ issue: 'drift', decision: 'confirm', reason: REASON }))
            .toMatchObject({ ok: false });
        expect(checkDecision({ issue: 'no-application', decision: 'reconcile', reason: REASON }))
            .toMatchObject({ ok: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#725 — and the reason is the record, so it has to be one', () => {
    it('A ONE-WORD NOTE IS REFUSED', () => {
        /*
         *   On a "no application" case the admin's sentence IS the evidence the
         *   approval was ever examined — there is no form, no submission and no
         *   payment trail to point at afterwards. "ok" is not evidence.
         */
        expect(checkDecision({ issue: 'no-application', decision: 'confirm', reason: 'ok' }))
            .toMatchObject({ ok: false });
    });

    it('AND A RECONCILE MUST SAY WHICH RECORD IS RIGHT', () => {
        //   Without it the tool would have to guess which of two disagreeing
        //   records wins, which is the decision it exists not to take.
        expect(checkDecision({ issue: 'drift', decision: 'reconcile', reason: REASON }))
            .toMatchObject({ ok: false });
        expect(checkDecision({
            issue: 'drift', decision: 'reconcile', reason: REASON, authoritative: 'nonsense',
        })).toMatchObject({ ok: false });
    });

    it('BUT A GENUINE DECISION IS ALLOWED', () => {
        //   Vacuity guard: every assertion above is satisfied by a checker that
        //   refuses everything.
        expect(checkDecision({ issue: 'no-application', decision: 'confirm', reason: REASON }))
            .toEqual({ ok: true });
        expect(checkDecision({
            issue: 'drift', decision: 'reconcile', reason: REASON, authoritative: 'application',
        })).toEqual({ ok: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#725 — what each decision writes, and what it never writes', () => {
    const patch = (decision: any, extra: Record<string, unknown> = {}) => approvalPatch({
        decision, reason: REASON, adminId: 'admin-1', previousStatus: 'approved', ...extra,
    });

    it('CONFIRM RECORDS THE BASIS AND DOES NOT REWRITE THE STATUS', () => {
        /*
         *   The finding was never that the status was wrong — it is already
         *   "approved". What was missing is what it rests on, and that is
         *   precisely what this adds.
         */
        const p = patch('confirm');
        expect(p['serviceRegistrations.farmNation.approvalBasis'])
            .toBe('admin_confirmed_without_application');
        expect(p).not.toHaveProperty('serviceRegistrations.farmNation.status');
    });

    it('REVOKE MOVES THE STATUS AND KEEPS THE ONE IT HELD BEFORE', () => {
        /*
         *   `revoked`, not a delete and not back to `pending`. Pending would put
         *   the member into a queue they never applied to; a delete would lose
         *   the fact that they were once approved, which is what somebody
         *   investigating this will need. Keeping the previous status is what
         *   makes the decision reversible.
         */
        const p = patch('revoke');
        expect(p['serviceRegistrations.farmNation.status']).toBe('revoked');
        expect(p['serviceRegistrations.farmNation.statusBeforeReview']).toBe('approved');
    });

    it('AND EVERY DECISION RECORDS WHO AND WHY, NOT JUST WHAT', () => {
        for (const d of ['confirm', 'revoke', 'reconcile']) {
            const p = patch(d);
            expect(p['serviceRegistrations.farmNation.reviewDecision']).toBe(d);
            expect(p['serviceRegistrations.farmNation.reviewDecisionBy']).toBe('admin-1');
            expect(p['serviceRegistrations.farmNation.reviewDecisionReason']).toBe(REASON);
            //   The previous status on EVERY branch, not only on revoke — it is
            //   what lets somebody later see what was changed rather than only
            //   what it was changed to.
            expect(p['serviceRegistrations.farmNation.statusBeforeReview']).toBe('approved');
        }
    });

    it('AND A RECONCILE ONLY MOVES THE STATUS WHEN THE APPLICATION IS AUTHORITATIVE', () => {
        expect(patch('reconcile', { reconcileTo: 'pending' })['serviceRegistrations.farmNation.status'])
            .toBe('pending');
        //   When the USER record is the right one its status does not move —
        //   the application is brought to match it instead.
        expect(patch('reconcile', { reconcileTo: null }))
            .not.toHaveProperty('serviceRegistrations.farmNation.status');
    });

    it('AND A REVIEWED CASE READS AS SETTLED, AN UNTOUCHED ONE DOES NOT', () => {
        expect(isSettled({ status: 'approved' })).toBe(false);
        expect(isSettled({ status: 'approved', reviewDecision: 'confirm' })).toBe(true);
        expect(isSettled({ status: 'approved', reviewDecision: '   ' })).toBe(false);
        expect(isSettled(null)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#725 — and the action never fabricates the missing application', () => {
    const ACTION = stripComments(
        readFileSync(join(process.cwd(), 'src/app/actions/admin/_farm_nation_approvals.ts'), 'utf8'),
        { label: 'farm-nation-approvals action' },
    );

    it('NOTHING CREATES A ROW IN FARM_NATION_APPLICATIONS', () => {
        /*
         *   THE assertion this whole finding turns on. Writing the missing
         *   application is the obvious shortcut, it would clear the report
         *   instantly, and it would make the record lie about a form nobody
         *   ever submitted.
         *
         *   Scoped to the applications collection: the action legitimately
         *   UPDATES an existing application on a reconcile, which is a
         *   different act — that row is already there, which is what makes the
         *   case drift rather than absence.
         */
        const appWrites = ACTION.split('\n')
            .filter((l) => l.includes('FARM_NATION_APPLICATIONS'))
            .filter((l) => /\.set\(|\.add\(|\.create\(/.test(l));

        expect(appWrites).toEqual([]);
    });

    it('AND THE MEMBER IS LOOKED UP THE WAY THE SCAN LOOKS THEM UP', () => {
        /*
         *   #671: the scan once asked `where("userId","==",id)` and nothing
         *   else, and reported 45 of 50 production farmers as approved with no
         *   application when the applications were there all along. A tool that
         *   looked them up its own way would disagree with the report it exists
         *   to work through.
         */
        expect(ACTION).toContain('findFarmNationApplications');
        expect(ACTION).not.toMatch(/where\("userId", "==", userId\)/);
    });

    it('AND THE CASE IS REBUILT SERVER-SIDE BEFORE ANY DECISION IS APPLIED', () => {
        const rebuildAt = ACTION.indexOf('const current = await buildCase(');
        const checkAt = ACTION.indexOf('checkDecision(');
        const writeAt = ACTION.indexOf('approvalPatch(');

        expect(rebuildAt).toBeGreaterThan(-1);
        expect(checkAt).toBeGreaterThan(rebuildAt);
        expect(writeAt).toBeGreaterThan(checkAt);
    });

    it('AND THE AUDIT ROW IS WRITTEN BEFORE THE EFFECT', () => {
        //   THE CALL, not the identifier — an import line is always before
        //   every write, and #724 had a mutant survive on exactly that.
        const auditAt = ACTION.indexOf('await createAdminAuditLog({');
        const writeAt = ACTION.indexOf('approvalPatch(');

        expect(auditAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(auditAt);
    });

    it('AND IT CLEARS THE CACHE ACCESS IS READ FROM', () => {
        /*
         *   #692's rule, and its ratchet caught this file before it was pushed.
         *   A revoke that leaves the cached profile saying "approved" means the
         *   member keeps the module open until the entry expires — and the
         *   admin who just revoked them watches it take effect and believes it
         *   did.
         */
        expect(ACTION).toContain('invalidateUserCache(userId)');
    });

    it('AND NOTHING IS DELETED', () => {
        expect(ACTION).not.toMatch(/\.delete\(\)/);
        expect(ACTION).not.toMatch(/FieldValue\.delete\(\)/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy.
 *
 *     MUTANT                                                        RESULT
 *     "confirm" is offered for a drift case                          KILLED
 *       — the one that makes the tool dishonest rather than
 *         unsafe: an admin records that they vouched while the two
 *         records go on disagreeing.
 *     checkDecision stops re-deriving the allowed list               KILLED
 *     the reason floor is dropped to any non-empty string            KILLED
 *     a reconcile no longer needs an authoritative side              KILLED
 *     confirm rewrites the status instead of recording the basis     KILLED
 *     revoke drops the previous status, losing the undo              KILLED
 *     revoke deletes the registration instead of marking it          KILLED
 *     the decision patch stops recording who and why                 KILLED
 *     isSettled treats whitespace as a decision                      KILLED
 *     the action creates the missing application row                 KILLED
 *     the cache invalidation is removed                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
