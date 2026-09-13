/**
 * @jest-environment node
 */

/**
 *   #696 THE FAKE HAD TO LEARN `.select()` AT THE SAME MOMENT THE ADAPTER DID.
 *
 *   fake-db's query builder carried this:
 *
 *       // .select() narrows columns. The store returns whole documents, so
 *       // this is a pass-through — and that is a divergence worth knowing
 *       // about: a caller reading a field it did not select works here and
 *       // gets undefined in production.
 *       select: () => q,
 *
 *   The comment describes the hazard exactly, and it was NOT TRUE when it was
 *   written: the ADAPTER's `.select()` was inert too, so both returned whole
 *   documents and the fake matched production precisely by doing nothing.
 *
 *   Narrowing the adapter is what would have made that comment true — and the
 *   one class of defect the change can introduce (a caller reading a field it
 *   did not select) would then have been the one class no unit test on this
 *   platform could see. That is not hypothetical: EIGHT call sites were reading
 *   unselected fields when the adapter was fixed, and every one had to be found
 *   by reading, because nothing in the suite could fail. Two of them mattered —
 *   `sms-broadcast` reading `paymentStatus` to decide who is in a broadcast, and
 *   six sites in `broadcast-logic` reading the join date that becomes each
 *   recipient's `lastActive`, which falls back to `new Date()` when absent.
 *
 *   So the fake narrows too, by the adapter's rule: keep the named fields,
 *   always keep `id`, and OMIT a field the document does not carry rather than
 *   setting it to null.
 *
 *   THE ADAPTER'S HALF IS PROVEN AGAINST REAL POSTGRES in
 *   src/__tests__/pg/select-narrows-the-read.test.ts, where every narrowed read
 *   is compared against the wide read of the same row. The two halves cannot be
 *   asserted in one file: that suite uses the REAL adapter, and installing the
 *   fake replaces that module wholesale — fake-db-matches-postgres.test.ts has
 *   to `jest.mock` it for its own registry for exactly this reason.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const COLL = COLLECTIONS.ESCROW_TRANSACTIONS;

const DOC = {
    name: 'Ada',
    rank: 3,
    kyc: { bvn: '12345678901', tier: 2 },
    tags: ['alpha', 'beta'],
    unwanted: 'this must not travel',
};

let store: FakeDbHandle;
const adapter = async () => (await import('@/lib/supabase-db')).supabaseDb;

beforeEach(() => {
    store = installFakeDb();
    store.seed(COLL, 'row-1', { id: 'row-1', ...DOC });
});

describe('#696 — the fake narrows a .select() read, as the adapter now does', () => {
    it('KEEPS THE SELECTED FIELDS', async () => {
        const db = await adapter();
        const d = (await db.collection(COLL).select('name', 'kyc', 'tags').get()).docs[0].data();

        expect(d.name).toBe('Ada');
        expect(d.kyc).toEqual({ bvn: '12345678901', tier: 2 });
        expect(d.tags).toEqual(['alpha', 'beta']);
    });

    it('AND DROPS THE ONES NOBODY ASKED FOR', async () => {
        //   THE point. Without this the file is satisfied by the pass-through
        //   it replaces, which returned everything and therefore passed every
        //   assertion about what it kept.
        const db = await adapter();
        const d = (await db.collection(COLL).select('name').get()).docs[0].data();

        expect(d.name).toBe('Ada');
        expect(d.unwanted).toBeUndefined();
        expect(d.kyc).toBeUndefined();
        expect(d.rank).toBeUndefined();
    });

    it('AND ALWAYS KEEPS THE ID, WHICH CALLERS KEY THEIR MAPS ON', async () => {
        const db = await adapter();
        const snap = (await db.collection(COLL).select('name').get()).docs[0];

        expect(snap.id).toBe('row-1');
        expect(snap.data().id).toBe('row-1');
    });

    it('AND OMITS A REQUESTED FIELD THE DOCUMENT DOES NOT HAVE, RATHER THAN NULLING IT', async () => {
        //   Matches the adapter: `->` cannot distinguish absent from a stored
        //   null, and a wide read omits an absent key, so omitting is the answer
        //   that keeps `=== undefined` and `in` meaning what they meant.
        const db = await adapter();
        const d = (await db.collection(COLL).select('name', 'missingEntirely').get()).docs[0].data();

        expect(d.missingEntirely).toBeUndefined();
        expect('missingEntirely' in d).toBe(false);
    });

    it('AND A READ WITHOUT .select() STILL RETURNS THE WHOLE DOCUMENT', async () => {
        //   THE control. Every assertion above is about fields disappearing, and
        //   a fake that returned nothing at all would satisfy all of them.
        const db = await adapter();
        const d = (await db.collection(COLL).get()).docs[0].data();

        expect(d.name).toBe('Ada');
        expect(d.unwanted).toBe('this must not travel');
        expect(d.kyc).toEqual({ bvn: '12345678901', tier: 2 });
        expect(d.rank).toBe(3);
    });

    it('AND THE FILTER STILL RUNS ON A FIELD THAT WAS NOT SELECTED', async () => {
        //   The adapter can filter on unselected columns — verified against the
        //   real PostgREST before any of this was built. A fake that could not
        //   would send callers looking for a bug that is not there.
        store.seed(COLL, 'row-2', { id: 'row-2', name: 'Bem', rank: 9, unwanted: 'x' });

        const db = await adapter();
        const snap = await db.collection(COLL).where('rank', '==', 9).select('name').get();

        expect(snap.docs.map((d: any) => d.data().name)).toEqual(['Bem']);
        expect(snap.docs[0].data().rank).toBeUndefined();
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     the fake goes back to a pass-through                            KILLED
 *     the fake nulls an absent field instead of omitting it           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the adapter's header (run against the pg suite)       SURVIVED ✓
 *
 *   The adapter's own mutants are tabled in the pg suite named above.
 */
