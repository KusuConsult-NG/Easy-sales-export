/**
 * @jest-environment node
 */

/**
 *   #813 THE WORKLIST ASKED A QUESTION NOBODY LEFT COULD ANSWER.
 *
 *   `/admin/forensics/duplicates` shows three groups where two records share an
 *   address and neither points at the other, and asks the operator to "choose
 *   the one that is the person". The owner's answer was that they cannot: they
 *   did not onboard these members, and the staff who did have left.
 *
 *   That is not a gap in the operator. It is a question the screen should never
 *   have needed a human memory for — the platform knows which record placed the
 *   orders, holds the membership, sat the course and earned the certificate,
 *   and was simply not showing it.
 *
 * ── THE ONE THING THIS MUST NEVER DO ────────────────────────────────────────
 *
 *   REPORT A FAILED READ AS ZERO. "Nothing is filed under this record" is
 *   precisely the sentence that would send an operator to discard the record
 *   that holds everything, and a count query that threw, reported as 0, says it
 *   with complete confidence.
 *
 *   So a failure is `null`, the screen renders "could not read", `incomplete`
 *   is set, and the total is described as a floor. #313's rule, applied to the
 *   one number that decides an identity.
 *
 * ── AND THE SOURCES ARE NOT INVENTED HERE ───────────────────────────────────
 *
 *   Every (collection, field) pair is taken from a live `filterByOwner` call in
 *   the application. A footprint querying a field nothing writes would report
 *   zero for every record — the same lie, arrived at by a different route — so
 *   the pairs are pinned against the real reads below.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'node:child_process';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    footprintsFor,
    clearlyRicher,
    FOOTPRINT_SOURCES,
    type Footprint,
} from '@/lib/profile-footprint';

jest.mock('@/lib/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

/**
 * A database whose count answers are scripted per (collection, id).
 *
 * `THROW` makes that one source fail for that one id, which is the case the
 * whole design is about.
 */
const THROW = Symbol('throw');

function fakeDb(answers: Record<string, Record<string, number | typeof THROW>>) {
    return {
        collection(name: string) {
            const build = (id: string | null): any => ({
                where: (_f: string, _op: string, value: unknown) => build(String(value)),
                count: () => ({
                    get: async () => {
                        const v = answers[name]?.[id ?? ''];
                        if (v === THROW) throw new Error('statement timeout');
                        return { data: () => ({ count: v ?? 0 }) };
                    },
                }),
            });
            return build(null);
        },
    } as any;
}

const ORDERS = FOOTPRINT_SOURCES[0];
const PRODUCTS = FOOTPRINT_SOURCES[1];

// ─────────────────────────────────────────────────────────────────────────────
describe('#813 — a failed read is never a zero', () => {
    it('A SOURCE THAT THREW IS null, NOT 0', async () => {
        const db = fakeDb({ [ORDERS.collection]: { 'a': THROW } });

        const { a } = await footprintsFor(db, ['a']);

        expect(a.counts[ORDERS.label]).toBeNull();
        expect(a.counts[ORDERS.label]).not.toBe(0);
    });

    it('AND THE FOOTPRINT SAYS IT IS INCOMPLETE', async () => {
        const db = fakeDb({ [ORDERS.collection]: { 'a': THROW } });

        const { a } = await footprintsFor(db, ['a']);

        expect(a.incomplete).toBe(true);
    });

    it('AND THE TOTAL IS A FLOOR — the failed source contributes nothing', async () => {
        const db = fakeDb({
            [ORDERS.collection]: { 'a': THROW },
            [PRODUCTS.collection]: { 'a': 4 },
        });

        const { a } = await footprintsFor(db, ['a']);

        expect(a.total).toBe(4);
        expect(a.incomplete).toBe(true);
    });

    it('POSITIVE CONTROL: A GENUINELY EMPTY RECORD IS 0 AND COMPLETE', async () => {
        //   Without this, every assertion above could be measuring a footprint
        //   that reports null for everything and can never say "nothing here".
        const { a } = await footprintsFor(fakeDb({}), ['a']);

        expect(a.total).toBe(0);
        expect(a.incomplete).toBe(false);
        expect(Object.values(a.counts).every((n) => n === 0)).toBe(true);
    });

    it('and a non-numeric count is treated as unreadable, not as zero', async () => {
        //   The adapter returns `{ count?: number }`. An absent count is a read
        //   that did not answer, and `undefined ?? 0` would have made it zero.
        const db = {
            collection: () => ({
                where: () => ({ count: () => ({ get: async () => ({ data: () => ({}) }) }) }),
            }),
        } as any;

        const { a } = await footprintsFor(db, ['a']);

        expect(a.counts[ORDERS.label]).toBeNull();
        expect(a.incomplete).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#813 — it counts each record separately', () => {
    it('TWO RECORDS SHARING AN ADDRESS GET THEIR OWN FIGURES', async () => {
        const db = fakeDb({
            [ORDERS.collection]: { 'live': 14, 'old': 0 },
            [PRODUCTS.collection]: { 'live': 3, 'old': 0 },
        });

        const both = await footprintsFor(db, ['live', 'old']);

        expect(both.live.total).toBe(17);
        expect(both.old.total).toBe(0);
    });

    it('AND THE RICHER ONE IS NAMED', async () => {
        const db = fakeDb({ [ORDERS.collection]: { 'live': 14, 'old': 0 } });
        const both = await footprintsFor(db, ['live', 'old']);

        expect(clearlyRicher(both)).toBe('live');
    });

    it('a duplicate id is asked about once', async () => {
        let asked = 0;
        const db = {
            collection: () => ({
                where: () => ({
                    count: () => ({
                        get: async () => { asked += 1; return { data: () => ({ count: 1 }) }; },
                    }),
                }),
            }),
        } as any;

        await footprintsFor(db, ['a', 'a', '', 'a']);

        expect(asked).toBe(FOOTPRINT_SOURCES.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#813 — and it refuses to name a winner it cannot see', () => {
    const complete = (total: number): Footprint =>
        ({ counts: { x: total }, total, incomplete: false });

    it('A TIE NAMES NOBODY', () => {
        expect(clearlyRicher({ a: complete(5), b: complete(5) })).toBeNull();
    });

    it('TWO EMPTY RECORDS NAME NOBODY — "both hold nothing" is not a winner', () => {
        expect(clearlyRicher({ a: complete(0), b: complete(0) })).toBeNull();
    });

    it('AND AN INCOMPLETE READ NAMES NOBODY, even when one looks bigger', () => {
        //   THE ONE THAT MATTERS. A floor cannot be compared against a total:
        //   preferring the record that merely READ successfully is exactly the
        //   mistake this module exists to prevent.
        const floor: Footprint = { counts: { x: null }, total: 2, incomplete: true };

        expect(clearlyRicher({ a: complete(9), b: floor })).toBeNull();
        expect(clearlyRicher({ a: floor, b: complete(1) })).toBeNull();
    });

    it('POSITIVE CONTROL: A CLEAR DIFFERENCE IS NAMED', () => {
        expect(clearlyRicher({ a: complete(9), b: complete(1) })).toBe('a');
    });

    it('and one record alone is not a comparison', () => {
        expect(clearlyRicher({ a: complete(9) })).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#813 — every source is a field the application actually reads', () => {
    /**
     * The other way to report zero for everything: query a field nothing
     * writes. Each pair has to appear in a live `filterByOwner` call.
     */
    it('EACH (COLLECTION, FIELD) PAIR APPEARS IN A LIVE OWNERSHIP READ', () => {
        const live = execSync(
            `grep -rhoE 'filterByOwner\\w*\\([^,]+,\\s*"[a-zA-Z.]+"' src/app src/lib --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        );

        for (const source of FOOTPRINT_SOURCES) {
            //   The grep sees `COLLECTIONS.MARKETPLACE_ORDERS`, the constant's
            //   NAME; FOOTPRINT_SOURCES holds its VALUE, "marketplaceOrders".
            //   The first version of this test compared the two directly and
            //   failed on correct code — so the name is resolved here.
            const name = Object.entries(COLLECTIONS)
                .find(([, v]) => v === source.collection)?.[0];
            const found = name !== undefined && live.split('\n').some((line) =>
                line.includes(`COLLECTIONS.${name}`) && line.includes(`"${source.field}"`));
            expect({ source: source.collection, field: source.field, found })
                .toEqual({ source: source.collection, field: source.field, found: true });
        }
    });

    it('POSITIVE CONTROL: the search really does find ownership reads', () => {
        const live = execSync(
            `grep -rhoE 'filterByOwner\\w*\\([^,]+,\\s*"[a-zA-Z.]+"' src/app src/lib --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        );
        expect(live.split('\n').filter(Boolean).length).toBeGreaterThan(5);
    });

    it('and the sources span the modules, not just one', () => {
        // A footprint that only knew about marketplace would call a cooperative
        // member's record empty.
        expect(FOOTPRINT_SOURCES.length).toBeGreaterThanOrEqual(8);
        expect(new Set(FOOTPRINT_SOURCES.map((s) => s.collection)).size)
            .toBe(FOOTPRINT_SOURCES.length);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/profile-footprint.ts alone, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   a failed count returns 0 instead of null    3   "A SOURCE THAT THREW IS
 *   — the defect this module exists to avoid        null, NOT 0"
 *
 *   a non-numeric count becomes 0               1   "and a non-numeric count is
 *                                                   treated as unreadable"
 *
 *   `incomplete` is never set                   3   "AND THE FOOTPRINT SAYS IT
 *                                                   IS INCOMPLETE"
 *
 *   the total adds nulls as 0 and reports       3   "AND THE FOOTPRINT SAYS IT
 *   itself complete                                 IS INCOMPLETE"
 *
 *   clearlyRicher compares incomplete           1   "AND AN INCOMPLETE READ
 *   footprints anyway                               NAMES NOBODY"
 *
 *   clearlyRicher names a tie                   1   "A TIE NAMES NOBODY"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the module header                    0   SURVIVED ✓
 *
 *   ONE TEST OF MINE WAS WRONG AND IS FIXED RATHER THAN WORKED AROUND. The
 *   source ratchet compared a collection's VALUE ("marketplaceOrders") against
 *   the CONSTANT NAME the grep sees (`COLLECTIONS.MARKETPLACE_ORDERS`) and
 *   failed on correct code. The name is resolved from COLLECTIONS now.
 */
