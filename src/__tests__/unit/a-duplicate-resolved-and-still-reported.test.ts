/**
 * @jest-environment node
 */

/**
 *   #736 AN ADMIN RESOLVED A DUPLICATE AND THE REPORT SAID IT WAS STILL THERE.
 *
 *   The forensic scan counted every address holding more than one profile. Its
 *   own sentence already knew that was wrong:
 *
 *       "TWO IS NORMAL for anyone migrated from the old system — the original
 *        is kept and tombstoned, never deleted."
 *
 *   It explained the situation in prose and then reported it as a problem
 *   anyway. So an admin who used /admin/forensics/duplicates to settle a
 *   duplicate re-ran the scan and saw the same warning with the same number.
 *
 *   THE WORK LEFT NO TRACE ON THE ONE REPORT THAT MEASURES IT, which is the
 *   owner's complaint in its purest form: it was fixed and it still says it is
 *   broken. Worse than a missing feature — a tool whose effect is invisible is
 *   a tool nobody trusts twice.
 *
 * ── THE RULE ALREADY EXISTED, IN THE TOOL ───────────────────────────────────
 *
 *   `classifyGroup` answers exactly this question, and #724 built the admin
 *   screen on it. `resolved` means one live record with every other pointing at
 *   it, and its own explanation ends "nothing to do".
 *
 *   The scan had a second, cruder definition — "more than one row" — so the two
 *   readers of the same fact disagreed about the same pair. That is this
 *   audit's most frequent defect, and here it landed on the report that tells
 *   the owner whether the platform is sound.
 *
 * ── AND THE SETTLED COUNT IS STATED RATHER THAN HIDDEN ──────────────────────
 *
 *   Silently dropping resolved groups would swap one wrong number for another:
 *   an operator would have no way to tell "nothing was ever wrong" from "nine
 *   were settled last week". The line now says both.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run before
 *   the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { classifyGroup } from '@/lib/duplicate-profile-resolution';

const FORENSICS = 'src/app/actions/forensics.ts';
const code = () => stripComments(readFileSync(FORENSICS, 'utf-8'), { label: FORENSICS });

/** The body of the duplicate check alone, so nothing else can satisfy a claim. */
const checkBody = () => {
    const src = code();
    const at = src.indexOf('Duplicate Profiles (One Address, Several Accounts)');
    expect(at).toBeGreaterThan(-1);
    const start = src.lastIndexOf('try {', at);
    return src.slice(start, src.indexOf('} catch', at));
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#736 — what a settled duplicate looks like', () => {
    it('ONE LIVE RECORD WITH THE REST POINTING AT IT IS RESOLVED', () => {
        const verdict = classifyGroup([
            { id: 'live', data: {} },
            { id: 'old', data: { _migratedTo: 'live' } },
        ]);

        expect(verdict.state).toBe('resolved');
        //   The tool's own words, and the reason the scan should not list it.
        expect(verdict.explanation).toContain('nothing to do');
    });

    it('AND AN UNRESOLVED PAIR STILL NEEDS A DECISION', () => {
        //   The direction that must not move: this change must not silence a
        //   real duplicate.
        expect(classifyGroup([
            { id: 'a', data: {} },
            { id: 'b', data: {} },
        ]).state).toBe('needs-a-decision');
    });

    it('AND POINTERS THAT DISAGREE ARE NOT RESOLVED EITHER', () => {
        expect(classifyGroup([
            { id: 'a', data: {} },
            { id: 'b', data: { _migratedTo: 'somewhere-else' } },
        ]).state).toBe('inconsistent');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#736 — the scan asks that rule rather than counting rows', () => {
    it('IT CALLS classifyGroup — the defect, stated as its absence', () => {
        expect(checkBody()).toContain('classifyGroup(');
    });

    it('AND SKIPS A RESOLVED GROUP INSTEAD OF LISTING IT', () => {
        const body = checkBody();

        expect(body).toContain("verdict.state === \"resolved\"");
        expect(body).toContain('settledGroups++');
        //   Skipped, not merely counted — the continue is what keeps it off the
        //   warning list.
        const at = body.indexOf('settledGroups++');
        expect(body.slice(at, at + 60)).toContain('continue');
    });

    it('AND STILL LISTS A GROUP THAT NEEDS A DECISION', () => {
        //   Vacuity guard on the skip: a check that dropped every group would
        //   report a permanent clean bill of health.
        expect(checkBody()).toContain('duplicateEmails.push(');
    });

    it('AND THE MARKER IS CARRIED THROUGH THE SCAN', () => {
        /*
         *   classifyGroup cannot answer without `_migratedTo`. The scan kept
         *   only ids, so the data has to reach the classification — and only
         *   that one field, because carrying six thousand whole rows to read it
         *   would be a different defect.
         */
        const body = checkBody();

        expect(body).toContain('rowsById.set(d.id, { _migratedTo: raw._migratedTo })');
        expect(body).toContain('rowsById.get(id) ?? {}');
    });

    it('AND THE SETTLED COUNT IS REPORTED, NOT HIDDEN', () => {
        /*
         *   Dropping resolved groups silently would swap one wrong number for
         *   another: an operator could not tell "nothing was ever wrong" from
         *   "nine were settled last week".
         */
        /*
         *   BOTH BRANCHES, and a mutant proved why. The phrase appears twice —
         *   once for "no duplicates at all" and once for "some need a decision"
         *   — so a `toContain` over the body passed while one of them had been
         *   emptied. The same file-level-for-use-level trap this audit keeps
         *   filing, in miniature.
         */
        const body = checkBody();

        expect(body.split('settledGroups > 0').length - 1).toBe(2);
        expect(body).toContain('apart from ${settledGroups} already settled');
        expect(body).toContain('and ${settledGroups} more are already settled');
    });

    it('AND THE OLD SENTENCE THAT EXPLAINED THE DEFECT IS GONE', () => {
        //   "TWO IS NORMAL … " described why the number was wrong instead of
        //   making it right. Keeping it beside the fix would leave the report
        //   arguing with itself.
        expect(checkBody()).not.toContain('TWO IS NORMAL');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run before
 *   this table was written.
 *
 *     MUTANT                                                        RESULT
 *     the scan counts rows again instead of classifying              KILLED
 *     a resolved group is counted but still listed                   KILLED
 *     every group is skipped, so nothing is ever reported            KILLED
 *     the marker is not carried, so nothing classifies as resolved   KILLED
 *     the settled count is dropped from the sentence       SURVIVED → KILLED
 *     classifyGroup calls a pair with no pointers "resolved"         KILLED
 *     classifyGroup calls disagreeing pointers "resolved"            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE ONE THAT SURVIVED. The settled count appears in BOTH branches of the
 *   sentence — "no duplicates at all" and "some need a decision" — and emptying
 *   one left the other satisfying a `toContain` over the whole body. Both are
 *   bound now, and the occurrence count is pinned so a third branch cannot
 *   quietly go unstated.
 */
