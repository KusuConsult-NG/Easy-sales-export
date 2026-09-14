/**
 * @jest-environment node
 */

/**
 *   #735 ERASING AN ACCOUNT MADE IT COUNT AS AN ACTIVE USER, FOR THIRTY DAYS.
 *
 *   The admin dashboard's "Active Users" is `updatedAt >= 30 days ago`, and BOTH
 *   of this platform's tombstone operations write `updatedAt`:
 *
 *     lib/user-soft-delete.ts       `updatedAt: FieldValue.serverTimestamp()`
 *                                   in the same patch that scrubs the row
 *     admin/_duplicate_profiles.ts  the same, written beside `_migratedTo`
 *
 *   So honouring a deletion request moved the number UP, and kept it up for a
 *   month. Resolving a duplicate did the same — and #724, which resolves them,
 *   is deliberately built to keep every field, so the row is still there to be
 *   counted.
 *
 *   The metric ran backwards from what it reports: the clearest signal that
 *   somebody has LEFT the platform was read as evidence they were using it.
 *
 * ── WHY THIS IS THE COUNT AND NOT THE SEND ──────────────────────────────────
 *
 *   `isRecentlyActive` reads the same field and has the same blind spot, and it
 *   is the rule behind the `active_last_30_days` broadcast audience. That door
 *   is already shut: #733 put a contactability check in the SMS funnel and #734
 *   in all seven email paths, so a tombstoned row cannot be SENT to whatever the
 *   activity rule says about it.
 *
 *   What was left is the number an operator reads, which no funnel guards.
 *
 * ── SUBTRACTED, NOT FILTERED ────────────────────────────────────────────────
 *
 *   These are `.count()` aggregates: there are no rows to inspect, so
 *   contactability cannot be asked per row. Inclusion–exclusion gives the exact
 *   answer with three more aggregates — and a row that is both deleted AND
 *   superseded would otherwise be subtracted twice, so it is added back.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run before
 *   the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { lastActiveAt, isRecentlyActive, RECENT_ACTIVITY_DAYS } from '@/lib/recent-activity';

const ANALYTICS = 'src/services/analytics.service.ts';
const code = () => stripComments(readFileSync(ANALYTICS, 'utf-8'), { label: ANALYTICS });

/** The arithmetic the service performs, stated once and exercised. */
const activeUsers = (touched: number, deleted: number, superseded: number, both: number) =>
    Math.max(0, touched - (deleted + superseded - both));

// ─────────────────────────────────────────────────────────────────────────────
describe('#735 — the premise: a tombstone write looks like activity', () => {
    it('BOTH TOMBSTONE PATHS WRITE updatedAt', () => {
        /*
         *   Neither is wrong to. A scrub and a supersession are real changes to
         *   the row and `updatedAt` is when it last changed. What was wrong is
         *   reading that field as evidence of a PERSON being active.
         */
        const scrub = stripComments(readFileSync('src/lib/user-soft-delete.ts', 'utf-8'));
        const resolve = stripComments(readFileSync('src/app/actions/admin/_duplicate_profiles.ts', 'utf-8'));

        expect(scrub).toContain('updatedAt: FieldValue.serverTimestamp()');
        expect(resolve).toContain('updatedAt: FieldValue.serverTimestamp()');
        expect(resolve).toContain('_migratedTo');
    });

    it('AND THE ACTIVITY RULE READS THAT FIELD', () => {
        //   So a row scrubbed today is "active" by this rule. Asserted rather
        //   than described, because it is the whole mechanism.
        const scrubbedToday = { updatedAt: new Date() };

        expect(lastActiveAt(scrubbedToday)).not.toBeNull();
        expect(isRecentlyActive(scrubbedToday)).toBe(true);
    });

    it('AND THE WINDOW IS THE SHARED ONE, NOT A HAND-WRITTEN 30', () => {
        //   Vacuity guard on the arithmetic below: if the window were something
        //   else, the query and this test would be describing different things.
        expect(RECENT_ACTIVITY_DAYS).toBe(30);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#735 — what the count now reports', () => {
    it('A TOMBSTONED ROW NO LONGER COUNTS AS ACTIVE — the defect', () => {
        //   100 rows touched in the window; 10 of them because they were erased.
        expect(activeUsers(100, 10, 0, 0)).toBe(90);
    });

    it('AND NEITHER DOES A SUPERSEDED ONE', () => {
        expect(activeUsers(100, 0, 4, 0)).toBe(96);
    });

    it('AND A ROW THAT IS BOTH IS SUBTRACTED ONCE, NOT TWICE', () => {
        /*
         *   THE reason for the fourth aggregate. An account erased AND
         *   superseded appears in both subtrahends; without adding the overlap
         *   back, the dashboard would under-report real activity — which is the
         *   same class of wrong number in the other direction.
         */
        expect(activeUsers(100, 10, 4, 3)).toBe(89);
        //   Sanity: without the correction it would have been 86.
        expect(100 - (10 + 4)).toBe(86);
    });

    it('AND A LIVE MEMBER STILL COUNTS — the direction that must not move', () => {
        //   A change that quietly emptied this number would "fix" the finding
        //   and destroy the metric.
        expect(activeUsers(100, 0, 0, 0)).toBe(100);
        expect(isRecentlyActive({ updatedAt: new Date() })).toBe(true);
    });

    it('AND IT NEVER GOES NEGATIVE', () => {
        //   Aggregates are taken separately and could, in principle, disagree.
        //   "None" is a readable answer on a dashboard; "-3" is an alarm about
        //   the wrong thing.
        expect(activeUsers(2, 5, 5, 0)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#735 — and the service asks exactly that', () => {
    it('IT SUBTRACTS BOTH TOMBSTONE STATES', () => {
        const src = code();

        expect(src).toContain('.where("deleted", "==", true).count().get()');
        expect(src).toContain('.where("_migratedTo", "!=", "").count().get()');
    });

    it('AND TAKES THE OVERLAP, SO NOTHING IS SUBTRACTED TWICE', () => {
        /*
         *   THE SIGN, NOT JUST THE QUERY — and my first version asserted only
         *   that the fourth aggregate existed. A mutant flipping the overlap
         *   from `-` to `+` SURVIVED: the arithmetic exercised above is a COPY
         *   of the rule living in this file, so mutating the service changed
         *   nothing it could see. Two copies of one fact, in the test written
         *   to catch two copies of one fact.
         *
         *   The service cannot be executed here without standing up the whole
         *   aggregate layer, so the binding is to the expression itself.
         */
        const src = code();

        expect(src).toContain('.where("deleted", "==", true).where("_migratedTo", "!=", "")');
        expect(src).toContain('- (recentBothSnap.data().count ?? 0);');
        expect(src).not.toContain('+ (recentBothSnap.data().count ?? 0);');

        //   And the two terms it corrects really are added, so the minus above
        //   is correcting an over-subtraction rather than sitting in isolation.
        expect(src).toContain('+ (recentSupersededSnap.data().count ?? 0)');
    });

    it('AND EVERY SUBTRAHEND IS SCOPED TO THE SAME WINDOW', () => {
        /*
         *   Counting ALL deleted rows rather than the recently-touched ones
         *   would subtract accounts erased years ago from a thirty-day figure —
         *   a different wrong number, and a plausible way to write this.
         */
        const src = code();
        expect(src).toContain('const recentlyTouched = () =>');
        expect(src).toContain('.where("updatedAt", ">=", activeSince)');

        //   Each subtrahend is built from that helper rather than from the
        //   collection directly.
        for (const q of [
            'recentlyTouched().where("deleted", "==", true).count().get()',
            'recentlyTouched().where("_migratedTo", "!=", "").count().get()',
        ]) {
            expect(src).toContain(q);
        }
    });

    it('AND THE FLOOR IS APPLIED WHERE THE NUMBER IS RETURNED', () => {
        expect(code()).toContain('activeUsers: Math.max(0, touched - tombstoned)');
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
 *     the deleted subtrahend is dropped                              KILLED
 *     the superseded subtrahend is dropped                           KILLED
 *     the overlap is subtracted instead of added back      SURVIVED → KILLED
 *     a subtrahend counts ALL rows, not the recent ones              KILLED
 *     the floor at zero is removed                                   KILLED
 *     the count returns the raw touched figure again                 KILLED
 *     isRecentlyActive stops reading updatedAt                       KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE ONE THAT SURVIVED. Flipping the overlap's sign changed no assertion,
 *   because the arithmetic exercised in the middle block is a COPY of the rule
 *   the service implements — so mutating the service left it untouched. That is
 *   two copies of one fact inside the test written to catch two copies of one
 *   fact, and it is recorded rather than quietly corrected. The sign is now
 *   asserted against the source, in both directions.
 */
