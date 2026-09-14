/**
 * @jest-environment node
 */

/**
 *   #724 THE FORENSIC REPORT NAMED A DECISION NOBODY HAD A WAY TO MAKE.
 *
 *   The duplicate-profile scan has reported the same finding for weeks and says
 *   why it does nothing about it:
 *
 *       "Nothing here merges or deletes them: which of somebody's records is
 *        the person is not a decision code should make unattended."
 *
 *   That is right. It also left the owner with a number and no next step, and
 *   asking them "so nothing can be done?" is a fair question to have had no
 *   answer for.
 *
 *   The DECISION stays theirs. Everything around it is not a decision and is
 *   done for them: gathering the evidence, ranking the candidates, refusing an
 *   application that cannot be undone, and recording who chose and why.
 *
 * ── WHAT IS UNDER TEST HERE ─────────────────────────────────────────────────
 *
 *   The two rules, separated from the I/O on purpose — a classifier that can
 *   only be exercised against a database is one nobody re-tests after changing
 *   it, which is the same reasoning backfillDecision is split out under.
 *
 *     classifyGroup      is this a decision, or a migration that already
 *                        settled itself?
 *     checkResolution    may this particular answer be applied?
 *
 *   MOST OF THE THIRTY-THREE ARE NOT DECISIONS, and getting that wrong is the
 *   likeliest way to make this tool useless. The scan's own text says "TWO IS
 *   NORMAL for anyone migrated from the old system — the original is kept and
 *   tombstoned, never deleted". Presenting those would ask the owner to
 *   re-confirm the migration's work thirty times and bury the few real ones.
 *
 * ── AND NOTHING IS DESTROYED ────────────────────────────────────────────────
 *
 *   The resolution writes `_migratedTo` on the records NOT chosen. Every reader
 *   already honours it — the login ranks such a row last (#490), and
 *   resolveActiveUser walks it on every money path (#449) — so there is nothing
 *   to teach and nothing to repoint. No document is removed, no field cleared,
 *   no data moved between rows, which is what makes clearing one field a
 *   complete undo.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    classifyGroup,
    rankCandidates,
    describeGroup,
    checkResolution,
} from '@/lib/duplicate-profile-resolution';

const row = (id: string, data: Record<string, unknown> = {}) => ({ id, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('#724 — a settled migration is not a decision', () => {
    it('A TOMBSTONED PAIR IS "resolved" AND IS NOT PUT IN FRONT OF ANYBODY', () => {
        /*
         *   THE case that decides whether this tool is usable. The scan reports
         *   33 addresses; if every migrated pair arrived as a question, the
         *   owner would work through thirty confirmations of something the
         *   migration already did correctly to reach the few that matter.
         */
        const { state } = classifyGroup([
            row('legacy', { _migratedTo: 'live' }),
            row('live', { roles: ['general_user'] }),
        ]);

        expect(state).toBe('resolved');
    });

    it('AND TWO RIVAL RECORDS WITH NO POINTER IS THE REAL QUESTION', () => {
        const { state, explanation } = classifyGroup([
            row('a', { roles: ['general_user'] }),
            row('b', { roles: ['general_user'] }),
        ]);

        expect(state).toBe('needs-a-decision');
        //   And it says what will happen to the ones not chosen, because an
        //   operator who thinks this deletes a record will not press it.
        expect(explanation).toMatch(/superseded/i);
        expect(explanation).toMatch(/keep everything/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#724 — and the states that are neither', () => {
    it('A CHAIN LEAVING THIS ADDRESS IS NOT SETTLED BY PICKING ONE OF THESE', () => {
        //   A row pointing at an id that is not in the group means the person's
        //   live record is somewhere else entirely. "Pick one of these two" is
        //   the wrong question and would build a chain through a tombstone.
        const { state, explanation } = classifyGroup([
            row('a', { _migratedTo: 'somewhere-else' }),
            row('b', {}),
        ]);

        expect(state).toBe('inconsistent');
        expect(explanation).toContain('somewhere-else');
    });

    it('AND A CYCLE IS REPORTED AS ONE RATHER THAN AS A MISSING ROW', () => {
        //   #449 measured a cycle hanging a login forever. Reporting "no live
        //   record" here would send an operator looking for a row that is not
        //   missing.
        const { state, explanation } = classifyGroup([
            row('a', { _migratedTo: 'b' }),
            row('b', { _migratedTo: 'a' }),
        ]);

        expect(state).toBe('inconsistent');
        expect(explanation).toMatch(/cycle/i);
    });

    it('AND SUPERSEDED ROWS POINTING AT DIFFERENT PLACES IS NOT "resolved"', () => {
        const { state } = classifyGroup([
            row('a', { _migratedTo: 'live' }),
            row('b', { _migratedTo: 'a' }),
            row('live', {}),
        ]);

        expect(state).toBe('inconsistent');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#724 — the suggestion is the platform\'s own, not a second opinion', () => {
    it('THE RECORD CARRYING THE REGISTRATIONS IS SUGGESTED', () => {
        /*
         *   Ranked by the same order lib/profile-choice uses to decide which
         *   record a person who just logged in gets. A tool that recommended
         *   one record while the login handed them another would be worse than
         *   no tool — the operator would settle the group and the platform
         *   would keep disagreeing with them.
         */
        const ranked = rankCandidates([
            row('bare', { roles: ['general_user'] }),
            row('rich', {
                roles: ['general_user'],
                serviceRegistrations: { wave: { status: 'approved' }, academy: { status: 'active' } },
            }),
        ]);

        expect(ranked[0]).toBe('rich');
    });

    it('AND THE ORDER IS TOTAL, SO THE SUGGESTION DOES NOT MOVE BETWEEN READS', () => {
        //   Two rows tying on every rule must still sort deterministically, or
        //   the "suggested" badge lands on a different record each time the
        //   screen is opened and the tool looks unreliable.
        const twice = [
            rankCandidates([row('b', {}), row('a', {})]),
            rankCandidates([row('a', {}), row('b', {})]),
        ];

        expect(twice[0]).toEqual(twice[1]);
    });

    it('AND THE GROUP IT DESCRIBES MARKS EXACTLY ONE RECOMMENDATION', () => {
        const group = describeGroup('a@b.test', 'a**@b.test', [
            row('x', {}), row('y', {}), row('z', {}),
        ]);

        expect(group.candidates.filter((c) => c.recommended)).toHaveLength(1);
        expect(group.candidates[0].recommended).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#724 — and it refuses an answer that one cleared field could not undo', () => {
    const group = describeGroup('a@b.test', 'a**@b.test', [
        row('keep', {}),
        row('other', {}),
        row('tombstone', { _migratedTo: 'keep' }),
    ]);

    it('A RECORD THAT IS NOT IN THE GROUP CANNOT BE KEPT', () => {
        //   The ids arrive in a request and a request can be edited. Every rule
        //   here is re-derived from the group the SERVER just read.
        expect(checkResolution({ group, keepId: 'stranger', supersedeIds: ['other'] }))
            .toMatchObject({ ok: false });
    });

    it('NOR CAN A RECORD SUPERSEDE ITSELF', () => {
        expect(checkResolution({ group, keepId: 'keep', supersedeIds: ['keep'] }))
            .toMatchObject({ ok: false });
    });

    it('AND A KEEPER THAT IS ITSELF SUPERSEDED IS REFUSED, NAMING WHERE IT POINTS', () => {
        /*
         *   THE rule that matters most. Pointing rows at a tombstone builds a
         *   chain THROUGH it, and resolveActiveUser walks straight past the
         *   record the operator chose — so the decision would appear to apply
         *   and quietly not hold.
         */
        const verdict = checkResolution({ group, keepId: 'tombstone', supersedeIds: ['other'] });

        expect(verdict.ok).toBe(false);
        expect((verdict as any).reason).toContain('keep');
    });

    it('AND AN EMPTY SELECTION IS REFUSED RATHER THAN SILENTLY DOING NOTHING', () => {
        expect(checkResolution({ group, keepId: 'keep', supersedeIds: [] }))
            .toMatchObject({ ok: false });
    });

    it('BUT A GENUINE ANSWER IS ALLOWED', () => {
        //   Vacuity guard: every assertion above is satisfied by a checker that
        //   refuses everything.
        expect(checkResolution({ group, keepId: 'keep', supersedeIds: ['other'] }))
            .toEqual({ ok: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#724 — and the action never destroys anything', () => {
    const ACTION = stripComments(
        readFileSync(join(process.cwd(), 'src/app/actions/admin/_duplicate_profiles.ts'), 'utf8'),
        { label: 'duplicate-profiles action' },
    );

    it('IT WRITES THE SUPERSESSION MARKER AND NOTHING DESTRUCTIVE', () => {
        /*
         *   The standing instruction on this whole audit, verbatim: "you can't
         *   delete or destroy anything ... rather fix the errors and ensure all
         *   data are safe." A merge-and-delete tool is the obvious thing to
         *   build here and is the one thing that must not be built.
         */
        expect(ACTION).toContain('_migratedTo: keepId');
        expect(ACTION).not.toMatch(/\.delete\(\)/);
        expect(ACTION).not.toMatch(/FieldValue\.delete\(\)/);
        //   A merge, never a replace: a bare set would flatten the superseded
        //   record, which is a destruction wearing a write's clothes.
        expect(ACTION).toContain('{ merge: true }');
    });

    it('AND IT RE-READS THE GROUP RATHER THAN TRUSTING THE REQUEST', () => {
        //   The rows can change between the screen rendering and the button
        //   being pressed — a login migrates a profile, another admin settles
        //   the same group. Deciding from what the caller sent would make every
        //   rule in checkResolution decorative.
        const applyAt = ACTION.indexOf('_migratedTo: keepId');
        const reloadAt = ACTION.indexOf('await loadGroups()', ACTION.indexOf('_resolveDuplicateProfileGroupAction'));
        const checkAt = ACTION.indexOf('checkResolution(');

        expect(reloadAt).toBeGreaterThan(-1);
        expect(checkAt).toBeGreaterThan(reloadAt);
        expect(applyAt).toBeGreaterThan(checkAt);
    });

    it('AND THE AUDIT ROW IS WRITTEN BEFORE THE EFFECT, CARRYING THE REASON', () => {
        //   #530's rule for the erasure reader: createAdminAuditLog never
        //   throws, so writing it first cannot fail the operation — and it
        //   cannot be skipped by an early return either.
        /*
         *   THE CALL, NOT THE IDENTIFIER — and the first version of this
         *   assertion searched for the identifier, so it matched the IMPORT
         *   LINE at the top of the file. An import is always before every
         *   write, so the ordering held vacuously and a mutant that moved the
         *   audit row AFTER the effect survived.
         *
         *   That is the file-level-versus-use-level trap #704 and #707 each had
         *   a mutant survive on, and the fourth time it has appeared in this
         *   audit — here in a test I wrote about being careful.
         */
        const auditAt = ACTION.indexOf('await createAdminAuditLog({');
        const applyAt = ACTION.indexOf('_migratedTo: keepId');

        expect(auditAt).toBeGreaterThan(-1);
        expect(applyAt).toBeGreaterThan(auditAt);
        //   And the operator's own sentence reaches the row, not just the log.
        expect(ACTION).toMatch(/metadata:\s*\{[^}]*reason/);
    });

    it('AND BOTH DOORS ARE GATED, THE READ AS TIGHTLY AS THE WRITE', () => {
        //   The list is every address on the platform holding more than one
        //   profile — a map of the member base's weak points, and not a lesser
        //   read than the write beside it.
        expect((ACTION.match(/requireAdmin\("users:update"\)/g) ?? []).length).toBe(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy.
 *
 *     MUTANT                                                        RESULT
 *     a settled migration is classified "needs-a-decision"           KILLED
 *       — the one that makes the tool unusable rather than unsafe:
 *         thirty confirmations of the migration's own work, with
 *         the few real decisions buried under them.
 *     a pointer leaving the group is treated as resolvable here      KILLED
 *     a cycle is reported as a missing live record                   KILLED
 *     the ranking drops the registration weight                      KILLED
 *     the ranking's final id tie-break is removed                    KILLED
 *     a keeper that is itself superseded is allowed                  KILLED
 *     checkResolution accepts an id from outside the group           KILLED
 *     the write drops { merge: true }                                KILLED
 *     the group is NOT re-read before applying                       KILLED
 *     the audit row is written after the effect                      KILLED
 *       — SURVIVED first, and the ASSERTION was at fault: it searched
 *         for `createAdminAuditLog` and matched the IMPORT LINE, which
 *         is always before every write, so the ordering held vacuously.
 *         The file-level-versus-use-level trap for the fourth time in
 *         this audit, here inside a test written about being careful.
 *         It anchors on the CALL now.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
