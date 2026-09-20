/**
 * @jest-environment node
 */

/**
 *   #804 THE DO-NOT-CONTACT SET CONTAINED PEOPLE THE PLATFORM STILL SIGNS IN.
 *
 *   `contactableVerdict` has always had the rule — it compares the pointer to
 *   the row's id:
 *
 *       if (typeof migratedTo === "string" && migratedTo.trim() && migratedTo !== id)
 *
 *   The two BULK loaders beside it did not, because they ask the question with
 *   a query and a query cannot compare a field to the row's own id:
 *
 *       .where("_migratedTo", "!=", "").select("_migratedTo").all().get()
 *
 *   That matches a row whose `_migratedTo` names ITSELF, which
 *   `resolveActiveUser` treats as live (`if (!next || next === id)`) and hands
 *   to whoever signs in. So a current member landed in
 *   `loadNonContactableUserIds` and `loadNonContactablePhones`, and was dropped
 *   from every in-app and SMS broadcast.
 *
 *   THAT IS THIS MODULE'S OWN PURPOSE RUNNING BACKWARDS. #697 and #733 built
 *   it to stop notices reaching people who had asked to be gone or had been
 *   merged away. It also stopped them reaching people who had done neither,
 *   silently, with no bounce and no log — the member just stops hearing from
 *   the platform.
 *
 *   The phone loader needed one extra thing: `_migratedTo` had to be added to
 *   its `.select()` list. #696 made `.select()` real, so a field not named is
 *   not on the row — the check would have read undefined on every row and
 *   dropped every superseded number from the set, failing in the other
 *   direction.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import {
    loadNonContactableUserIds,
    loadNonContactablePhones,
    contactableVerdict,
} from '@/lib/contactable-account';

type Row = Record<string, any> & { id: string };

/**
 * A users collection narrow enough for these two loaders and faithful where it
 * matters: `!=` does not match a row missing the key (the adapter emits
 * `raw_data->>'f' <> 'x'`, NULL for an absent key), and `.select()` really
 * projects.
 */
function fakeDb(rows: Row[]) {
    const build = (filters: ((r: Row) => boolean)[], fields: string[] | null): any => ({
        where(field: string, op: string, value: unknown) {
            return build([...filters, (r: Row) => {
                const v = r[field];
                if (op === '==') return v === value;
                if (op === '!=') return v !== undefined && v !== value;
                return true;
            }], fields);
        },
        select: (...f: string[]) => build(filters, f),
        all: () => build(filters, fields),
        get: async () => ({
            docs: rows.filter((r) => filters.every((f) => f(r))).map((r) => ({
                id: r.id,
                data: () => (fields === null
                    ? r
                    : Object.fromEntries(fields.filter((k) => k in r).map((k) => [k, r[k]]))),
            })),
        }),
    });
    return { collection: () => build([], null) };
}

const ids = (rows: Row[]) => loadNonContactableUserIds(fakeDb(rows) as any, 'users');
const phones = (rows: Row[]) => loadNonContactablePhones(fakeDb(rows) as any, 'users');

// ─────────────────────────────────────────────────────────────────────────────
describe('#804 — a row pointing at itself stays contactable', () => {
    it('IT IS NOT IN THE EXCLUDED-ID SET', async () => {
        const set = await ids([
            { id: 'live' },
            { id: 'self', _migratedTo: 'self' },
            { id: 'gone', _migratedTo: 'live' },
        ]);

        expect([...set]).toEqual(['gone']);
    });

    it('AND ITS NUMBER IS NOT IN THE EXCLUDED-PHONE SET', async () => {
        const set = await phones([
            { id: 'self', _migratedTo: 'self', phone: '08011111111' },
            { id: 'gone', _migratedTo: 'self', phone: '08022222222' },
        ]);

        expect(set.has('+2348011111111')).toBe(false);
        expect(set.has('+2348022222222')).toBe(true);
    });

    it('and the single-row reader always agreed — this is the two catching up', () => {
        // contactableVerdict is the rule the loaders were out of step WITH, so
        // it is asserted here rather than assumed.
        expect(contactableVerdict({ _migratedTo: 'self' }, 'self').contactable).toBe(true);
        expect(contactableVerdict({ _migratedTo: 'other' }, 'self').contactable).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#804 — and everything the set is FOR still lands in it', () => {
    /**
     * The direction that must not move. A loader that excluded nobody would
     * pass every assertion above.
     */
    it('A GENUINELY SUPERSEDED ROW IS STILL EXCLUDED', async () => {
        expect([...await ids([{ id: 'gone', _migratedTo: 'live' }])]).toEqual(['gone']);
    });

    it('AN ERASED ROW IS STILL EXCLUDED, POINTER OR NO POINTER', async () => {
        const set = await ids([
            { id: 'erased', deleted: true },
            { id: 'erased-self', deleted: true, _migratedTo: 'erased-self' },
        ]);

        // The pointer says nothing about erasure; `deleted` does.
        expect([...set].sort()).toEqual(['erased', 'erased-self']);
    });

    it('and a superseded NUMBER is still excluded across every field it is stored in', async () => {
        const set = await phones([
            { id: 'a', _migratedTo: 'live', phone: '08033333333' },
            { id: 'b', _migratedTo: 'live', phoneNumber: '08044444444' },
            { id: 'c', _migratedTo: 'live', kyc: { phoneNumber: '08055555555' } },
        ]);

        expect([...set].sort()).toEqual(
            ['+2348033333333', '+2348044444444', '+2348055555555'],
        );
    });

    it('THE POINTER IS SELECTED, so the check has a field to read', async () => {
        /*
         *   #696 made `.select()` real. If `_migratedTo` is not in the phone
         *   loader's FIELDS, every row reads undefined, every superseded number
         *   is treated as a self-pointer, and the set comes back EMPTY — the
         *   same defect facing the other way. The fake projects, so this
         *   assertion only passes if the field is asked for.
         */
        const set = await phones([{ id: 'gone', _migratedTo: 'live', phone: '08066666666' }]);
        expect([...set]).toEqual(['+2348066666666']);
    });

    it('POSITIVE CONTROL: the fake really does project, and really does skip an absent key', async () => {
        // Otherwise both directions above could be measuring a fake that
        // returns whole rows and matches everything.
        const db: any = fakeDb([{ id: 'x', _migratedTo: 'y', phone: '080' }]);
        const projected = await db.collection().where('_migratedTo', '!=', '')
            .select('_migratedTo').all().get();
        expect(projected.docs[0].data()).toEqual({ _migratedTo: 'y' });

        const noKey: any = fakeDb([{ id: 'x' }]);
        const matched = await noKey.collection().where('_migratedTo', '!=', '').get();
        expect(matched.docs).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#804 — it still fails OPEN, which is the older rule here', () => {
    /**
     * #697's note: "a read error must not empty an admin's audience". The
     * self-pointer skip sits inside the same loop those try/catches wrap, so
     * it is worth proving it did not turn a throw into a rejection.
     */
    const throwingDb = {
        collection: () => ({
            where: () => ({
                select: () => ({ all: () => ({ get: async () => { throw new Error('down'); } }) }),
            }),
        }),
    };

    it('an unreadable users table yields an empty set rather than a rejection', async () => {
        await expect(loadNonContactableUserIds(throwingDb as any, 'users')).resolves.toEqual(new Set());
        await expect(loadNonContactablePhones(throwingDb as any, 'users')).resolves.toEqual(new Set());
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Each mutant applied to src/lib/contactable-account.ts alone, then this
 *   suite re-run with thirteen-audiences-that-asked-nothing and
 *   a-notice-sent-to-the-profile-they-stopped-using (27 tests).
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   ids loader: drop the self-pointer skip      1   "IT IS NOT IN THE
 *   — the defect restored verbatim                  EXCLUDED-ID SET"
 *
 *   phones loader: drop the self-pointer skip   1   "AND ITS NUMBER IS NOT IN
 *                                                   THE EXCLUDED-PHONE SET"
 *
 *   phones loader: drop "_migratedTo" from      3   "AND ITS NUMBER IS NOT IN
 *   FIELDS — the #696 trap, failing the             THE EXCLUDED-PHONE SET"
 *   OTHER way: the set comes back empty
 *
 *   ids loader: skip EVERY row rather than      2   "IT IS NOT IN THE
 *   only self-pointers (excludes nobody)            EXCLUDED-ID SET"
 *
 *   The last is the control that matters. "Nobody is wrongly excluded" is
 *   trivially true of a loader that excludes nobody, and that mutant passes
 *   every assertion in the first describe. It dies in the second, which is why
 *   that block exists.
 *
 *   The same rule in countLivePeople is mutation-tested where it lives, in
 *   erasing-an-account-made-it-active: dropping the skip, flipping the overlap
 *   sign, and forgetting `erased` in the `.select()` kill 1, 3 and 3 tests.
 */
