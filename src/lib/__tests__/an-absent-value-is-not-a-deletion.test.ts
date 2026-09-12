/**
 *   #686 A FIELD THE CALLER HAD NO VALUE FOR WAS DELETED FROM THE RECORD.
 *
 *   buildWritePatch ended its loop with
 *
 *       const resolved = processNestedFieldValues(rawValue, ...);
 *       if (resolved === undefined) { deletes.push(key); }
 *
 *   and `processNestedFieldValues(undefined, …)` returns undefined. So any
 *   payload field whose value was a plain `undefined` was sent to the database
 *   as a DELETION — on `update()` and on `set(…, { merge: true })` alike, and
 *   on both the RPC path and the JavaScript fallback.
 *
 *   THAT IS NOT WHAT FIRESTORE DOES, and this adapter is a Firestore shim. The
 *   Admin SDK either throws on an undefined value or — with
 *   ignoreUndefinedProperties, which is the configuration every caller in this
 *   repository reads as though it were in force — leaves the field ALONE.
 *   Deleting has always required FieldValue.delete().
 *
 * ── WHAT IT COST, MEASURED ON A REAL CALLER ─────────────────────────────────
 *
 *   The legacy import builds its user document with three optional maps:
 *
 *       nextOfKin:    (name || phone)      ? { … } : undefined
 *       bankDetails:  accountNumber        ? { … } : undefined
 *       documents:    (validId || photo …) ? { … } : undefined
 *
 *   and writes it with `batch.set(ref, userDoc, { merge: true })`. An admin
 *   re-importing an existing member — the ordinary case, and the one #84, #681,
 *   #682, #683, #684 and #685 are all about — types what they have in front of
 *   them. Whatever they do not retype was deleted:
 *
 *       the bank account payouts are sent to,
 *       the next of kin a cooperative loan is guaranteed against,
 *       and the record pointing at their uploaded ID.
 *
 *   THE LAST ONE IS THE WORST, and it is the one the standing instruction for
 *   this codebase speaks to directly. The Cloudinary asset survives — #675
 *   guards that — but the only thing that knew its URL was the field that had
 *   just been removed. An asset nobody can find again is not much better off
 *   than a destroyed one, and it is harder to notice, because the storage bill
 *   says everything is still there.
 *
 * ── THE TEST DOUBLE REPRODUCED IT FAITHFULLY, AND NOBODY LOOKED ────────────
 *
 *   I expected to find the opposite, and wrote it down before measuring:
 *   lib/testing/fake-db.ts clones documents with
 *   `JSON.parse(JSON.stringify(v))`, which drops undefined-valued keys, so the
 *   fake looked as though it must have been quietly doing the right thing while
 *   the adapter deleted the field — the "instrument more forgiving than the
 *   database" trap this audit has already been caught by once.
 *
 *   IT IS NOT WHAT HAPPENS. The fake's applyPatch reaches
 *   `setPath(target, key, clone(undefined))` before any of that, which puts the
 *   key in place holding undefined, and the JSON clone then drops it on the way
 *   out. The field is gone. The fake matched the adapter exactly, which is the
 *   one property it promises.
 *
 *   So this was catchable from a behavioural test all along. What was missing
 *   was the test — nobody had written one that re-imported a member carrying
 *   details the second import did not mention. That is worth more than a note
 *   about the instrument: the gap was in the questions being asked, not in the
 *   thing answering them.
 *
 *   The fake now carries the corrected behaviour too, in step with the adapter,
 *   and the last assertion in this file is what holds the two together.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

export {}; // module scope: other adapter tests declare the same names

const mockRpc = jest.fn();

const EXISTING = {
    id: "user-1",
    email: "ada@example.com",
    keep: 1,
    doomed: "x",
    profile: { name: "Ada", city: "Jos" },
};

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        rpc: (...args: any[]) => mockRpc(...args),
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
                data: {
                    id: "user-1",
                    email: "ada@example.com",
                    raw_data: {
                        id: "user-1",
                        email: "ada@example.com",
                        keep: 1,
                        doomed: "x",
                        profile: { name: "Ada", city: "Jos" },
                    },
                },
                error: null,
            }),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
            update: jest.fn().mockReturnThis(),
            upsert: jest.fn().mockResolvedValue({ error: null }),
            delete: jest.fn().mockReturnThis(),
            match: jest.fn().mockResolvedValue({ error: null }),
            not: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
}));

jest.mock("@/lib/cache-invalidation", () => ({
    invalidateUserCache: jest.fn(),
    invalidateAdminGlobalStats: jest.fn(),
    invalidateServiceCache: jest.fn(),
}));

const { SupabaseDocumentReference } =
    jest.requireActual<typeof import("@/lib/supabase-db")>("@/lib/supabase-db");
const { FieldValue } =
    jest.requireActual<typeof import("@/lib/firestore-compat")>("@/lib/firestore-compat");

beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.warn as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
});

function patchCall() {
    return mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#686 — an undefined field is left alone, not deleted', () => {
    it('THE DEFECT: update() no longer deletes a field the caller had no value for', async () => {
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.update({ keep: 2, doomed: undefined });

        const call = patchCall()!;
        expect(call[1].p_deletes).toEqual([]);
        //   And it is not written as null either — null is a VALUE, and a
        //   reader that does `if (doc.bankDetails)` cannot tell it from absent
        //   while a reader that does `'bankDetails' in doc` very much can.
        expect(call[1].p_patch).toEqual({ keep: 2 });
        expect(call[1].p_patch).not.toHaveProperty('doomed');
        expect(call[1].p_paths).not.toHaveProperty('doomed');
    });

    it('AND set(merge) does not either — which is the path the legacy import uses', async () => {
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.set({ keep: 2, doomed: undefined }, { merge: true });

        const call = patchCall()!;
        expect(call[1].p_deletes).toEqual([]);
        expect(call[1].p_patch).toEqual({ keep: 2 });
    });

    it('AND AN UNDEFINED LEAF INSIDE A MERGED MAP IS SKIPPED, NOT SENT AS A PATH', async () => {
        /*
         *   `documents: { validId: {…}, passportPhoto: undefined }` — the
         *   legacy import's exact shape one level down. The RPC body drops an
         *   undefined value when it is serialised, so this was survivable on
         *   the RPC path and NOT on the JavaScript fallback, which writes the
         *   key. Two paths disagreeing is its own defect; they agree now.
         */
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.set({ profile: { city: 'Abuja', name: undefined } }, { merge: true });

        const call = patchCall()!;
        expect(Object.keys(call[1].p_paths)).toEqual(['profile.city']);
        expect(call[1].p_deletes).toEqual([]);
    });

    it('BUT FieldValue.delete() STILL DELETES — the explicit way is the only way', async () => {
        /*
         *   THE control. "Never delete anything" would satisfy all three
         *   assertions above and break the removal that migration 017 exists
         *   for. The distinction this finding draws is between an ABSENT value
         *   and a REQUESTED removal, not between deleting and not.
         */
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.update({ keep: 3, doomed: FieldValue.delete() });

        const call = patchCall()!;
        expect(call[1].p_deletes).toEqual(['doomed']);
        expect(call[1].p_patch).toEqual({ keep: 3 });
    });

    it('AND SO DOES A NESTED FieldValue.delete() BY PATH', async () => {
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.update({ 'profile.city': FieldValue.delete() });

        expect(patchCall()![1].p_deletes).toEqual(['profile.city']);
    });

    it('AND A NULL IS STILL WRITTEN — a caller who means "empty" is obeyed', async () => {
        /*
         *   The other control. Collapsing null into undefined would make
         *   `ninVerificationMethod: data.nin ? "self_declared" : null` — three
         *   lines from the undefined fields in the same payload — stop
         *   clearing a stale verification method.
         */
        const ref = new SupabaseDocumentReference('users', 'user-1');
        await ref.update({ doomed: null });

        const call = patchCall()!;
        expect(call[1].p_patch).toEqual({ doomed: null });
        expect(call[1].p_deletes).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#686 — and the fake database moves with the adapter", () => {
    /*
     *   THE INSTRUMENT, PINNED. lib/testing/fake-db.ts stores documents through
     *   `JSON.parse(JSON.stringify(v))`, and JSON.stringify drops
     *   undefined-valued keys — so the fake has always done the RIGHT thing
     *   here, by accident, while the adapter deleted the field.
     *
     *   THAT IS WHY NO BEHAVIOURAL TEST COULD HAVE FOUND THIS, and it is worth
     *   being plain about: a suite driving the legacy import through the fake
     *   would have shown bank details surviving a re-import both before and
     *   after the fix. The defect was only ever visible in what the adapter
     *   SENDS, which is what the assertions above read.
     *
     *   Asserted here so the accident becomes a commitment. If somebody
     *   "improves" the fake's clone to preserve undefined keys and then deletes
     *   on them, this fails rather than silently re-opening the gap between the
     *   instrument and the database.
     */
    it('LEAVES AN UNDEFINED FIELD ALONE ON A MERGING WRITE', async () => {
        const { installFakeDb } =
            jest.requireActual<typeof import('@/lib/testing/fake-db')>('@/lib/testing/fake-db');
        const store = installFakeDb();
        try {
            store.seed('users', 'u1', { keep: 1, bankDetails: { accountNumber: '0123456789' } });

            //   The MOCKED module, deliberately: installFakeDb replaces the
            //   adapter in the registry, and requireActual walks straight past
            //   the fake to the real one — which is how the first version of
            //   this test wrote nowhere and asserted against the seed.
            const { getAdminDb } = require('@/lib/supabase-db');
            await getAdminDb().collection('users').doc('u1')
                .set({ keep: 2, bankDetails: undefined }, { merge: true });

            const after = store.get('users', 'u1')!;
            expect(after.keep).toBe(2);
            expect(after.bankDetails).toEqual({ accountNumber: '0123456789' });
        } finally {
            store.clear();
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *   Run against this suite AND the legacy-onboarding behaviour suite together,
 *   because the finding is an adapter change whose cost is only legible at a
 *   caller.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a plain undefined is a deletion again (adapter)     KILLED
 *     THE DEFECT: a plain undefined is a deletion again (fake)        KILLED
 *     the undefined is skipped but written as null instead            KILLED
 *     FieldValue.delete() is swallowed along with undefined           KILLED
 *     null is collapsed into undefined, so a deliberate clear
 *       stops working                                                 KILLED
 *     an undefined LEAF is sent as a dotted path again                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the #686 note in buildWritePatch                         SURVIVED ✓
 *
 *   THE SECOND MUTANT IS THE ONE WORTH READING. Reverting the FAKE alone, with
 *   the adapter left fixed, kills the behavioural tests — which is the proof
 *   that the fake reproduced this defect rather than hiding it, and that a
 *   behavioural test written at any point in the last year would have found it.
 *
 * ── AND THE FIRST VERSION OF THE BEHAVIOURAL TESTS WAS WRONG ────────────────
 *
 *   They submitted the optional fields as empty strings. The schema marks them
 *   `.optional()` and rejects `""` against `/^\d{10}$/` and `z.string().url()`,
 *   so the action refused the write and three tests failed for a reason that
 *   had nothing to do with this finding. ImportLegacyModal OMITS the key —
 *   `...(formData.accountNumber ? { accountNumber: … } : {})` — and omission is
 *   what produces the undefined. Reproducing the caller exactly is the
 *   difference between a test of this defect and a test of the validator.
 */
