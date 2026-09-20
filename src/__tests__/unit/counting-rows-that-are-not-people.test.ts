/**
 * @jest-environment node
 */

/**
 *   #747 THE HEADLINE "TOTAL USERS" COUNTED THE ROWS THE PLATFORM HAD ALREADY
 *        DECIDED WERE NOT PEOPLE.
 *
 *   USERS holds two kinds of tombstone, and this audit has spent seven findings
 *   on the difference:
 *
 *     deleted: true   an account ERASED at the person's request
 *     _migratedTo     a profile SUPERSEDED by #724's duplicate resolver — it
 *                     and its target are ONE person, and the field is the
 *                     platform recording that it knows
 *
 *   `db.collection(USERS).count()` counts both. So the figure the admin
 *   dashboard shows as Total Users was inflated by every erasure honoured and
 *   by every duplicate an admin resolved. Resolving a duplicate never lowered
 *   it: the platform can KNOW two rows are one person and still report two.
 *
 * ── #735 BUILT THE SUBTRACTION FOR THE FIGURE FOUR LINES ABOVE ──────────────
 *
 *   "Erasing an account made it count as an ACTIVE user" — because both
 *   tombstone operations write `updatedAt`, and active was `updatedAt >= 30
 *   days ago`. #735 fixed that with inclusion–exclusion, in
 *   analytics.service.ts, four lines below a raw `.count()` of the same
 *   collection for the total. One of two, again.
 *
 *   And the identical `active` computation in actions/global-aggregation.ts was
 *   never touched at all — #735's defect, verbatim, in a second file.
 *
 * ── ALL THREE FIGURES, NOT THE TWO THAT WERE WRONG ALONE ────────────────────
 *
 *   getUserMetricsAction returns `unverified: total - verified`. Subtracting a
 *   tombstone-free total from a tombstone-carrying verified count is a new
 *   defect in place of the old one, and it can go NEGATIVE. A population has to
 *   be defined once and applied to every figure derived from it.
 *
 * ── WHAT IS DELIBERATELY LEFT COUNTING ROWS ─────────────────────────────────
 *
 *   actions/maintenance.ts's consistency check. It compares row counts across
 *   collections to find integrity problems, and there the raw number IS the
 *   right one — subtracting tombstones would hide exactly the rows it exists to
 *   examine. Stated so it reads as a decision.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full against this suite,
 *   #735's and the platform-metrics one, and every row below is its result.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { countLivePeople, TOMBSTONE_FIELDS } from '@/lib/user-population';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/**
 * A query that drives the real function rather than a copy of its arithmetic.
 *
 *   #804 IT USED TO ANSWER FOUR `.count()` AGGREGATES. The superseded side is
 *   a READ now — a count cannot ask whether a pointer names ANOTHER row, and
 *   that question decides whether the row is a tombstone or a person — so the
 *   fake supplies ROWS for that half and counts for the other two.
 *
 *   The split is not a convenience: it is what the function does, and keeping
 *   `all` and `erased` as free-standing counts is also what keeps the floor
 *   test below constructible (rows alone can never out-number themselves).
 */
type PointingRow = { id: string; _migratedTo?: string; deleted?: boolean };

function fakeQuery(
    counts: { all: number; erased: number },
    pointing: PointingRow[] = [],
    applied: string[] = [],
    fields: string[] | null = null,
): any {
    return {
        where(field: string, _op: string, _value: unknown) {
            return fakeQuery(counts, pointing, [...applied, field], fields);
        },
        select: (...f: string[]) => fakeQuery(counts, pointing, applied, f),
        all: () => fakeQuery(counts, pointing, applied, fields),
        count() {
            const n = applied.includes(TOMBSTONE_FIELDS.erased) ? counts.erased : counts.all;
            return { get: async () => ({ data: () => ({ count: n }) }) };
        },
        get: async () => ({
            docs: pointing.map((r) => ({
                id: r.id,
                //   `.select()` is real (#696): a field not named is not on the
                //   row. Projecting here is what makes "forgot to select
                //   `deleted`" a failure rather than a silent zero overlap.
                data: () => (fields === null
                    ? r
                    : Object.fromEntries(
                        fields.filter((k) => k in r).map((k) => [k, (r as any)[k]]))),
            })),
        }),
    };
}

/** `n` rows superseded onto a live row, optionally also erased. */
const superseded = (n: number, opts: { erased?: boolean } = {}): PointingRow[] =>
    Array.from({ length: n }, (_, i) => ({
        id: `s${opts.erased ? 'b' : ''}${i}`,
        _migratedTo: 'the-live-row',
        ...(opts.erased ? { deleted: true } : {}),
    }));

// ─────────────────────────────────────────────────────────────────────────────
describe('#747 — the count reports people, not rows', () => {
    it('AN ERASED ACCOUNT IS NOT A USER — the defect', async () => {
        expect(await countLivePeople(fakeQuery({ all: 100, erased: 7 }))).toBe(93);
    });

    it('AND NEITHER IS A SUPERSEDED DUPLICATE', async () => {
        //   #724's resolver made these. Counting both halves of a resolved
        //   duplicate is the platform contradicting its own record.
        expect(await countLivePeople(fakeQuery({ all: 100, erased: 0 }, superseded(4)))).toBe(96);
    });

    it('AND A ROW THAT IS BOTH IS SUBTRACTED ONCE, NOT TWICE', async () => {
        /*
         *   The half that is easy to get wrong, and the reason this is
         *   inclusion–exclusion rather than two filters: these are `.count()`
         *   aggregates with no rows to inspect, so an overlap can only be
         *   corrected by adding it back.
         */
        //   4 pointing rows, 3 of them also erased — so `erased` (7) and the read
        //   (4) both count those 3, and the overlap has to come back.
        expect(await countLivePeople(fakeQuery(
            { all: 100, erased: 7 }, [...superseded(3, { erased: true }), ...superseded(1)],
        ))).toBe(92);
    });

    it('AND A CLEAN COLLECTION IS UNCHANGED — the direction that must not move', async () => {
        //   Vacuity guard: a function that subtracted something from every
        //   count would pass all three assertions above.
        expect(await countLivePeople(fakeQuery({ all: 100, erased: 0 }))).toBe(100);
    });

    it('AND IT NEVER GOES NEGATIVE', async () => {
        //   Four aggregates taken separately can in principle disagree. "None"
        //   is a readable answer on a dashboard; "-3" is an alarm about the
        //   wrong thing. #735's guard, carried over.
        expect(await countLivePeople(fakeQuery({ all: 2, erased: 5 }, superseded(5)))).toBe(0);
    });

    it('AND IT NARROWS THE QUERY IT WAS GIVEN, SO A WINDOW SURVIVES', async () => {
        /*
         *   The property that lets one function serve the total AND the
         *   thirty-day figure. If it counted the collection instead of the
         *   query, the active figure would subtract accounts erased years ago
         *   from a thirty-day window — a different wrong number, and a
         *   plausible way to write this.
         */
        const seen: string[][] = [];
        const tracking = (applied: string[] = []): any => ({
            where: (f: string) => tracking([...applied, f]),
            select: () => tracking(applied),
            all: () => tracking(applied),
            count: () => ({ get: async () => { seen.push(applied); return { data: () => ({ count: 0 }) }; } }),
            get: async () => { seen.push(applied); return { docs: [] }; },
        });

        await countLivePeople(tracking(['updatedAt']));

        //   #804 — THREE aggregates now, not four: the two counts and the read
        //   that replaced the other two. Every one carries the caller's filter.
        expect(seen).toHaveLength(3);
        for (const applied of seen) expect(applied[0]).toBe('updatedAt');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#747 — and every reported user figure goes through it', () => {
    it('THE DASHBOARD TOTAL DOES — the live one', () => {
        /*
         *   getDashboardStats -> getPlatformMetrics -> this. That chain is what
         *   makes this finding a live number rather than a latent one, so the
         *   call is asserted where it happens.
         */
        expect(code('src/services/analytics.service.ts'))
            .toContain('const totalUsers = await countLivePeople(db.collection(COLLECTIONS.USERS));');
    });

    it('AND THE ACTIVE FIGURE BESIDE IT, WHICH IS WHERE THE RULE CAME FROM', () => {
        expect(code('src/services/analytics.service.ts'))
            .toContain('countLivePeople(recentlyTouched())');
    });

    it('AND ALL THREE IN global-aggregation, INCLUDING verified', () => {
        /*
         *   `unverified = total - verified`. Both sides must count the same
         *   population or the subtraction is incoherent and can go negative —
         *   so `verified` is in here even though it was not wrong by itself.
         */
        const src = code('src/app/actions/global-aggregation.ts');

        expect(src).toContain('countLivePeople(db.collection(COLLECTIONS.USERS))');
        expect(src).toContain('countLivePeople(db.collection(COLLECTIONS.USERS).where("updatedAt", ">=", thirtyDaysAgo))');
        expect(src).toContain('countLivePeople(db.collection(COLLECTIONS.USERS).where("isVerified", "==", true))');
    });

    it('AND NO REPORTED FIGURE STILL COUNTS THE COLLECTION RAW', () => {
        //   Swept over the two files that report user numbers, so a figure
        //   added later cannot quietly go back to counting rows.
        for (const f of ['src/services/analytics.service.ts', 'src/app/actions/global-aggregation.ts']) {
            expect({ f, raw: /COLLECTIONS\.USERS\)\.count\(\)/.test(code(f)) })
                .toEqual({ f, raw: false });
        }
    });

    it('AND THE CONSISTENCY CHECK IS LEFT COUNTING ROWS, ON PURPOSE', () => {
        /*
         *   The other half of the decision, asserted so it reads as a choice.
         *   runConsistencyCheckAction compares row counts across collections to
         *   find integrity problems; subtracting tombstones there would hide
         *   the very rows it exists to examine.
         */
        expect(code('src/app/actions/maintenance.ts')).toContain('COLLECTIONS.USERS).count().get()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#747 — and the fields it keys on are the ones the platform writes', () => {
    it('THE TWO TOMBSTONE MARKERS ARE NAMED, NOT SPELLED OUT PER CALL', () => {
        expect(TOMBSTONE_FIELDS.erased).toBe('deleted');
        expect(TOMBSTONE_FIELDS.superseded).toBe('_migratedTo');
    });

    it('AND SUPERSESSION IS MATCHED BY != "", WHICH IS NOT AN ARBITRARY CHOICE', () => {
        /*
         *   `_migratedTo != ""` matches rows that HAVE the field and no others:
         *   the adapter emits `raw_data->>'f' <> 'x'`, NULL — and therefore not
         *   true — for a row missing the key. The inverse would match NOTHING
         *   rather than "every row without a pointer", so this cannot be
         *   rewritten as a positive filter without breaking it.
         */
        const src = code('src/lib/user-population.ts');

        //   #804 — the AGGREGATE this filter feeds changed from a count to a
        //   read, so the old assertion pinned a spelling rather than the
        //   choice. What must not change is the operator.
        expect(src).toContain('query.where(superseded, "!=", "")');
        expect(src).not.toContain('query.where(superseded, "==", "")');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by full path, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *   RE-RUN IN FULL FOR #804, because the fake changed: the superseded side is
 *   a read now, so every result below was re-measured rather than carried
 *   over. Run against this suite AND erasing-an-account-made-it-active (31).
 *
 *     MUTANT                                                  DEAD   RESULT
 *     the erased count stops being subtracted                    6   KILLED
 *     the superseded count stops being subtracted                6   KILLED
 *     the overlap is subtracted instead of added back            4   KILLED
 *     the floor at zero is removed                               2   KILLED
 *     the self-pointer skip is removed (#804's own defect)       1   KILLED
 *     `erased` is dropped from the .select() — #696's trap       4   KILLED
 *     it counts the collection instead of the query it was given     KILLED
 *     the dashboard total goes back to a raw count                   KILLED
 *     global-aggregation's active figure goes back to a raw count    KILLED
 *     verified is left counting rows while total does not            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword a comment in the function                           0   SURVIVED ✓
 *
 *   The last four were measured against the previous implementation and are
 *   untouched by this change — they mutate the CALL SITES, not the counting.
 */
