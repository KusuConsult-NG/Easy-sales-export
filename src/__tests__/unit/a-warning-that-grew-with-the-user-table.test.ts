/**
 * @jest-environment node
 */

/**
 *   #658 A DIAGNOSTIC THAT COULD NOT BE ACTED ON, ONCE PER MEMBER, FOREVER.
 *
 *   From the same captured server log that produced #657. Among the
 *   DEDICATED_TABLE_MAP warnings was this one:
 *
 *     [WARN] [supabase-db] Collection
 *     'user_activity_logs/c6c84683-4d86-4bd6-bb80-deedf80236ab/days' is not in
 *     DEDICATED_TABLE_MAP. Falling back to document_collections table.
 *
 *   A USER ID, in the collection name. Two subcollection paths in this codebase
 *   carry one:
 *
 *     user_progress/<uid>/courses        4 call sites
 *     user_activity_logs/<uid>/days      2 call sites
 *
 *   `getTableName` remembers what it has already warned about in a module-level
 *   Set, keyed on the collection name — which is the whole point of the Set, so
 *   the warning fires once rather than on every query. For these two it is a
 *   DIFFERENT STRING FOR EVERY MEMBER. So:
 *
 *     · the Set grows by one entry per member, in a process that is not
 *       restarted between requests, and nothing ever removes an entry;
 *     · the warning is emitted once per member rather than once;
 *     · in production each one also dynamically imports @sentry/nextjs to add a
 *       breadcrumb.
 *
 *   MEASURED BEFORE IT WAS BELIEVED: fifty distinct ids through getTableName
 *   produced FIFTY warnings and fifty permanent entries. Not inferred from the
 *   code — run, and counted.
 *
 * ── AND THE ADVICE WAS WRONG, WHICH IS THE WORSE HALF ───────────────────────
 *
 *   "is not in DEDICATED_TABLE_MAP" reads as a configuration gap: someone
 *   forgot to map this collection. A subcollection CANNOT be mapped. The
 *   adapter's own collectionGroup() documents the design — "Subcollections here
 *   are flattened into the collection name, so db.collection('user_progress/
 *   <uid>/courses') becomes a document_collections row with that string as
 *   collection_name" — and #202 fixed a client-side copy that tried to resolve
 *   a subcollection to its parent's table, establishing that falling through to
 *   document_collections is the CORRECT answer here, not a fallback anyone
 *   should act on.
 *
 *   So the channel that exists to say "a collection is missing a mapping"
 *   carried an unbounded stream of entries that were never missing anything.
 *   This audit has just spent a finding (#657) on a real error sitting unread in
 *   that same log, and a warning nobody can act on is how a log gets that way.
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────
 *
 *   The Set is keyed on the SHAPE of the path, with document ids masked, so the
 *   key space is bounded by the number of code paths rather than by the number
 *   of members. And the two cases are told apart:
 *
 *     a top-level name with no mapping   WARN  — actionable, someone may want a
 *                                               dedicated table. Unchanged.
 *     a subcollection path               DEBUG — by design, and now said once
 *                                               per shape instead of once per
 *                                               member.
 *
 *   Resolution is UNTOUCHED. Both still return document_collections, and #202's
 *   whole-path matching is exactly as it was — this is a change to what gets
 *   said about it and how often.
 *
 *   The masked shape is also what gets printed, so a member's id stops being
 *   written into the application log as a side effect of them opening a lesson.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, jest } from '@jest/globals';

const warned: string[] = [];
const debugged: string[] = [];

jest.mock('@/lib/logger', () => ({
    logger: {
        info: () => {},
        error: () => {},
        warn: (m: string) => { warned.push(m); },
        debug: (m: string) => { debugged.push(m); },
    },
}));

const tableName = async () => (await import('@/lib/supabase-db')).getTableName;

/**
 * A fresh tag per test.
 *
 * The Set that is the subject of this file is module-level and deliberately
 * never cleared, and `getTableName` is requireActual in jest.setup — so state
 * carries between tests in this file. Each one uses its own tag rather than
 * resetting modules, which would also reset the thing being measured.
 */
let tag = 0;
const fresh = () => `t${++tag}`;

// ─────────────────────────────────────────────────────────────────────────────
describe('#658 — a per-member path warns once, not once per member', () => {
    it('FIFTY MEMBERS PRODUCE ONE LINE', async () => {
        /*
         *   THE defect, measured. Before this change the same loop produced
         *   fifty warnings and left fifty entries behind in a Set that is only
         *   emptied by restarting the process.
         */
        const getTableName = await tableName();
        const t = fresh();

        for (let i = 0; i < 50; i++) getTableName(`user_progress/${t}-member-${i}/courses`);

        const mine = [...warned, ...debugged].filter(m => m.includes(`${t}-member-`));
        expect(mine).toHaveLength(0);

        const shaped = [...warned, ...debugged].filter(m => m.includes(`user_progress/*/courses`));
        expect(shaped).toHaveLength(1);
    });

    it('AND THE OTHER PER-MEMBER PATH TOO', async () => {
        //   user_activity_logs/<uid>/days — the one the captured log actually
        //   showed, written by logLessonActivityAction on every lesson.
        const getTableName = await tableName();
        const t = fresh();

        for (let i = 0; i < 20; i++) getTableName(`user_activity_logs/${t}-m${i}/days`);

        expect([...warned, ...debugged].filter(m => m.includes(`${t}-m`))).toHaveLength(0);
        expect([...warned, ...debugged].filter(m => m.includes('user_activity_logs/*/days')))
            .toHaveLength(1);
    });

    it('AND A MEMBER ID IS NOT WRITTEN INTO THE LOG AT ALL', async () => {
        /*
         *   A consequence worth asserting on its own. The id was in the message
         *   because the message printed the collection name, and the collection
         *   name is the path. Masking the key masks what is printed.
         */
        const getTableName = await tableName();
        const t = fresh();
        const id = `${t}-5c4b9d2e-secret-member-id`;

        getTableName(`user_progress/${id}/courses`);

        expect([...warned, ...debugged].some(m => m.includes(id))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#658 — and the signal it was drowning is still there', () => {
    it('A TOP-LEVEL COLLECTION WITH NO MAPPING STILL WARNS', async () => {
        /*
         *   THE positive control, and the reason this is not just "warn less".
         *   An unmapped top-level collection IS actionable — somebody may want a
         *   dedicated table for it — and that is the message this channel exists
         *   to carry. Silencing it to fix the noise would trade one defect for a
         *   worse one.
         */
        const getTableName = await tableName();
        const name = `${fresh()}_a_collection_nobody_mapped`;

        expect(getTableName(name)).toBe('document_collections');

        expect(warned.filter(m => m.includes(name))).toHaveLength(1);
        expect(debugged.filter(m => m.includes(name))).toHaveLength(0);
    });

    it('AND IT STILL SAYS IT ONLY ONCE', async () => {
        //   The behaviour that was already right, kept. The Set is doing its
        //   job for the case it was written for.
        const getTableName = await tableName();
        const name = `${fresh()}_asked_for_five_times`;

        for (let i = 0; i < 5; i++) getTableName(name);

        expect(warned.filter(m => m.includes(name))).toHaveLength(1);
    });

    it('AND A SUBCOLLECTION IS NOT REPORTED AS A MISSING MAPPING', async () => {
        /*
         *   The half that says WHY the two are separated rather than just
         *   deduplicated differently. A subcollection cannot be mapped — #202
         *   and collectionGroup() both establish that document_collections is
         *   the correct home — so calling it a missing mapping is advice nobody
         *   can take.
         */
        const getTableName = await tableName();
        const t = fresh();

        getTableName(`${t}_parent/doc-1/child`);

        expect(warned.filter(m => m.includes(`${t}_parent`))).toHaveLength(0);
        const said = debugged.filter(m => m.includes(`${t}_parent`));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain('subcollection');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#658 — and nothing about where the data lives changed', () => {
    it('EVERY MAPPED COLLECTION STILL RESOLVES TO ITS OWN TABLE', async () => {
        const getTableName = await tableName();
        const { DEDICATED_TABLE_MAP } = await import('@/lib/supabase-table-map');

        for (const [name, table] of Object.entries(DEDICATED_TABLE_MAP)) {
            expect(`${name} -> ${getTableName(name)}`).toBe(`${name} -> ${table}`);
        }
    });

    it('AND A SUBCOLLECTION STILL RESOLVES TO document_collections, WHOLE-PATH', async () => {
        /*
         *   #202: a client-side copy did `collection.split('/')[0]`, so
         *   `users/u1/notes` resolved to the `users` TABLE and a subcollection
         *   read would have queried user rows. This finding masks ids for the
         *   purpose of a log key and must not go near resolution.
         */
        const getTableName = await tableName();

        expect(getTableName('users/u1/notes')).toBe('document_collections');
        expect(getTableName('user_progress/u1/courses')).toBe('document_collections');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the Set goes back to keying on the raw path         KILLED
 *     the message goes back to printing the raw path                  KILLED
 *     the subcollection case is silenced entirely                     KILLED
 *     the subcollection case is warned rather than debugged           KILLED
 *     an unmapped top-level collection stops warning                  KILLED
 *     the mask eats the collection segments instead of the ids        KILLED
 *     a subcollection resolves to its parent's table (#202 again)     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The warning is from a real run: 362 Playwright tests against a production
 *   build on the local stack with the server's output captured. The count was
 *   then reproduced directly — fifty ids through getTableName, fifty warnings —
 *   before any of this was written.
 */
