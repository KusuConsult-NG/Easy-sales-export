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
import { countLivePeople } from '@/lib/user-population';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { lastActiveAt, isRecentlyActive, RECENT_ACTIVITY_DAYS } from '@/lib/recent-activity';

const ANALYTICS = 'src/services/analytics.service.ts';
const code = () => stripComments(readFileSync(ANALYTICS, 'utf-8'), { label: ANALYTICS });
//   #747 — the subtraction moved here when a second figure needed it.
const POPULATION = join(process.cwd(), 'src/lib/user-population.ts');
const population = () => stripComments(readFileSync(POPULATION, 'utf-8'), { label: POPULATION });

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
    /*
     *   #747 MOVED THE RULE, NOT THE GUARANTEE.
     *
     *   These assertions pinned the literal text of the inline implementation
     *   in analytics.service.ts. A second figure in the same file — the raw
     *   `totalUsers` count four lines above — needed the identical
     *   subtraction, so it was extracted to lib/user-population.ts and this
     *   went red on a change that left the rule exactly as it was.
     *
     *   That is the "pins the spelling of an implementation rather than the
     *   property it protects" shape #741 filed against #600 and #351. Restated
     *   against where the rule lives, plus the service reading it.
     */
    /**
     *   #804 THESE TWO PINNED THE SPELLING OF THE QUERIES, AND THE SPELLING WAS
     *        THE THING THAT HAD TO CHANGE.
     *
     *   The comment above already names the shape — "pins the spelling of an
     *   implementation rather than the property it protects" — and these were
     *   the last two in this file still doing it. `countLivePeople` cannot ask
     *   a `.count()` whether a pointer names another row, so the superseded
     *   side became a read and `query.where(superseded, "!=", "").count()`
     *   stopped existing. Both went red on a change that made the figure MORE
     *   correct.
     *
     *   So they EXECUTE it now, against a fake query that reproduces the
     *   adapter's `!=` semantics the module header documents: `f != ""` matches
     *   rows that HAVE the field and no others, because `raw_data->>'f' <> 'x'`
     *   is NULL, and therefore not true, for a row missing the key.
     *
     *   This also closes the hole the second test's own note admits: the
     *   overlap sign was checked by grepping for `- (bothSnap…)` because "the
     *   arithmetic exercised above is a COPY of the rule". There is no copy
     *   now — flipping the sign changes a number this test reads.
     */
    type Row = { id: string; deleted?: boolean; _migratedTo?: string };

    const fakeQuery = (
        rows: Row[], filters: ((r: Row) => boolean)[] = [], fields: string[] | null = null,
    ): any => {
        const matching = () => rows.filter((r) => filters.every((f) => f(r)));
        //   `.select()` IS REAL — #696. A field not named is not on the row, so
        //   a fake that returns the whole row would hide exactly the mistake
        //   the code comment warns about (selecting the pointer and forgetting
        //   `deleted`, whose absence makes the overlap term silently zero).
        const project = (r: Row) => (fields === null
            ? r
            : Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, (r as any)[f]])));
        return {
            where(field: string, op: string, value: unknown) {
                const f = (r: Row) => {
                    const v = (r as Record<string, any>)[field];
                    if (op === '==') return v === value;
                    //   The documented adapter behaviour, not a convenience: a
                    //   row MISSING the key does not match `!=`.
                    if (op === '!=') return v !== undefined && v !== value;
                    return true;
                };
                return fakeQuery(rows, [...filters, f], fields);
            },
            select: (...f: string[]) => fakeQuery(rows, filters, f),
            all: () => fakeQuery(rows, filters, fields),
            count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
            get: async () => ({
                docs: matching().map((r) => ({ id: r.id, data: () => project(r) })),
            }),
        };
    };

    const live = (rows: Row[]) => countLivePeople(fakeQuery(rows));

    it('IT SUBTRACTS BOTH TOMBSTONE STATES', async () => {
        const rows: Row[] = [
            { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
            { id: 'e1', deleted: true },
            { id: 'e2', deleted: true },
            { id: 's1', _migratedTo: 'p1' },
            { id: 's2', _migratedTo: 'p1' },
            { id: 's3', _migratedTo: 'p2' },
            { id: 'both', deleted: true, _migratedTo: 'p1' },
        ];
        //   10 rows − (3 erased + 4 superseded − 1 counted twice) = 4 people.
        await expect(live(rows)).resolves.toBe(4);
    });

    it('AND TAKES THE OVERLAP, SO NOTHING IS SUBTRACTED TWICE', async () => {
        const withOverlap: Row[] = [
            { id: 'p1' }, { id: 'p2' },
            { id: 'both', deleted: true, _migratedTo: 'p1' },
        ];
        //   The row is one tombstone, not two. Adding the overlap instead of
        //   subtracting it would answer 1; ignoring it would answer 0.
        await expect(live(withOverlap)).resolves.toBe(2);
    });

    it('A ROW WHOSE POINTER NAMES ITSELF IS A PERSON, NOT A TOMBSTONE', async () => {
        /*
         *   #804 THE UNDERCOUNT. `_migratedTo != ""` is true of a self-pointing
         *   row, and resolveActiveUser hands that row to the person who signs
         *   in — so every one of them was subtracted from "Total Users".
         *
         *   Resolving a duplicate was supposed to make the figure fall by one.
         *   This made it fall by more than the duplicates.
         */
        const rows: Row[] = [
            { id: 'p1' },
            { id: 'self', _migratedTo: 'self' },
            { id: 'gone', _migratedTo: 'p1' },
        ];
        await expect(live(rows)).resolves.toBe(2);
    });

    it('and a self-pointing row that is ALSO erased is still a tombstone', async () => {
        // The pointer says nothing; `deleted` does. Both terms are independent.
        await expect(live([
            { id: 'p1' },
            { id: 'self', deleted: true, _migratedTo: 'self' },
        ])).resolves.toBe(1);
    });

    it('AND THE OVERLAP TERM READS A FIELD THAT WAS ACTUALLY SELECTED', async () => {
        //   Dropping `erased` from the `.select()` leaves `deleted` undefined
        //   on every row read, so the overlap silently becomes zero and a
        //   both-tombstoned row is subtracted twice. The fake projects, so this
        //   answers 2 only if the field is really asked for.
        await expect(live([
            { id: 'p1' }, { id: 'p2' },
            { id: 'both', deleted: true, _migratedTo: 'p1' },
        ])).resolves.toBe(2);
    });

    it('AND THE FIELD NAMES ARE STILL THE TWO TOMBSTONES', () => {
        // The vocabulary IS a property — a third tombstone field added without
        // being subtracted is the whole family of defects this file records.
        const src = population();
        expect(src).toContain('erased: "deleted"');
        expect(src).toContain('superseded: "_migratedTo"');
    });

    it('POSITIVE CONTROL: the fake really does reproduce the adapter\'s `!=`', async () => {
        //   Otherwise "the superseded rows were subtracted" could mean the fake
        //   matched everything, or nothing, and every count above is an
        //   accident. A row with no `_migratedTo` key must not match.
        const q = fakeQuery([{ id: 'a' }, { id: 'b', _migratedTo: 'a' }]);
        const matched = await q.where('_migratedTo', '!=', '').get();

        expect(matched.docs.map((d: any) => d.id)).toEqual(['b']);
    });

    it('AND EVERY SUBTRAHEND IS SCOPED TO THE SAME WINDOW, BY CONSTRUCTION', () => {
        /*
         *   Counting ALL deleted rows rather than the recently-touched ones
         *   would subtract accounts erased years ago from a thirty-day figure —
         *   a different wrong number, and a plausible way to write this.
         *
         *   #747 made that unwriteable rather than merely checked: countLivePeople
         *   takes the QUERY and narrows that same query for each subtrahend, so
         *   a mis-scoped term cannot be expressed. What is left to assert is
         *   that the service hands it the windowed query.
         */
        expect(population()).toContain('export async function countLivePeople(query: CountableQuery)');

        const src = code();
        expect(src).toContain('const recentlyTouched = () =>');
        expect(src).toContain('.where("updatedAt", ">=", activeSince)');
        expect(src).toContain('countLivePeople(recentlyTouched())');
    });

    it('AND THE FLOOR IS APPLIED WHERE THE NUMBER IS PRODUCED', () => {
        expect(population()).toContain('return Math.max(0, all - tombstoned);');
    });

    it('AND THE TOTAL BESIDE IT READS THE SAME RULE — #747', () => {
        //   The figure that was a raw .count() when #735 fixed its neighbour.
        expect(code()).toContain('countLivePeople(db.collection(COLLECTIONS.USERS))');
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
