/**
 * @jest-environment node
 */

/**
 *   #376 ERASURE SCRUBBED ONE ROW OUT OF NINE.
 *
 *        #283 fixed WHICH FIELDS erasure removes from the user document. #371
 *        fixed the SPELLINGS of those fields, because a normaliser guarantees
 *        several of them exist twice. Both ended by recording the same open
 *        question, in the same words: saveKYCProfileAction copies the member's
 *        name, phone, state and address into the module collections, and "this
 *        patch is a user-row patch and does not reach them".
 *
 *        It is not only that sync. Each module's own onboarding writes a FULL
 *        copy when the application is submitted, and admin/_applications.ts
 *        writes a third when an admin edits the profile. So after a
 *        right-to-erasure request the user row said "Redacted User" while:
 *
 *          cooperative_members             name, date of birth, gender, email,
 *                                          phone, residential address,
 *                                          occupation, NEXT OF KIN — a third
 *                                          party who never consented — BVN and
 *                                          NIN in clear, the bank account, and
 *                                          the Cloudinary links to the ID scan,
 *                                          passport photo and proof of address
 *          seller_verifications            NIN, BVN and CAC IN CLEAR (only the
 *                                          copies mirrored onto the user row
 *                                          are hashed), the bank account under
 *                                          TWO roots, the address under two
 *          export_onboarding_applications  kyc.nin and kyc.bvn in clear,
 *                                          kyc.documents, the bank block
 *          wave_applications               fifty fields, next of kin and the
 *                                          voter's card number among them
 *          academy_applications            personalInfo, whole
 *          farm_nation_applications        profile, whole
 *          wave_members                    name, email, phone
 *          marketplace_sellers             business name, email, phone
 *
 *        THE RECORDED FINDING SAID FIVE COLLECTIONS. IT IS EIGHT — the five are
 *        the ones the KYC sync touches, and the other three were found by
 *        following the writers instead of the sync. The N-doors shape again.
 *
 *        AND THE ONE PLACE THAT DID SCRUB A MODULE ROW USED THE WRONG LIST. The
 *        GDPR cron applied userErasurePatch to cooperative_members, which is
 *        built against `interface User`: it removes the field names the two
 *        rows happen to share and leaves what only the member row has — the
 *        flat nextOfKinName/Phone/Address the resubmission path writes, the
 *        ward, the bank name.
 *
 *        Fixed with a per-collection definition in
 *        lib/module-application-erasure.ts, used by all three erasure doors.
 *        Nothing is deleted: the rows keep their status, dates, balances and
 *        ids and gain erasedOwnerMarker, and their document references are
 *        copied into the retention record FIRST — #292's rule, that removing
 *        the link without keeping it destroys the only record of whose the file
 *        is, while the file itself is never removed.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    MODULE_ERASURE_TARGETS,
    moduleErasurePatch,
    retainedDocumentsFrom,
    eraseModuleApplications,
} from '@/lib/module-application-erasure';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const UID = 'member-1';

type Row = { id: string; data: Record<string, any> };

/** A query snapshot in the shape the adapter returns. */
function snapshot(rows: Row[]) {
    return {
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
    };
}

/**
 * Seed the harness: `queries` keyed by COLLECTION name (what a `.get()` on a
 * builder asks for), `documents` keyed by DOCUMENT id (what `.doc(id).get()`
 * asks for). Both go through the same recorder, which is why the two maps are
 * separate and the ids below never collide with a collection name.
 */
/**
 * What each query actually asked for, captured through the harness's own side
 * channel. The mock publishes `__firestoreAccess` synchronously immediately
 * before calling the recorder, and it is the only way to tell a query that
 * filters on the right field from one that filters on the wrong one — the
 * recorder returns the seeded rows either way.
 */
let queried: Array<{ collection: string; filters: Array<{ field: string; op: string; value: any }> }> = [];

function seed(queries: Record<string, Row[]>, documents: Record<string, Record<string, any>> = {}) {
    queried = [];
    (global as any).mockFirestoreGet = jest.fn((key: string) => {
        const access = (global as any).__firestoreAccess;
        if (access?.kind === 'query') {
            queried.push({ collection: access.collection, filters: access.query?.filters ?? [] });
        }
        if (Object.prototype.hasOwnProperty.call(queries, key)) {
            return Promise.resolve(snapshot(queries[key]));
        }
        if (Object.prototype.hasOwnProperty.call(documents, key)) {
            return Promise.resolve({ exists: true, id: key, data: () => documents[key] });
        }
        return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => undefined });
    });
}

/** Every batched write, as { collection, id, patch }. */
function batchedWrites(): Array<{ collection: string; id: string; patch: Record<string, any> }> {
    return ((global as any).mockFirestoreSet as jest.Mock).mock.calls
        .filter((c) => c[0] && typeof c[0] === 'object' && c[0].__collection)
        .map((c) => ({ collection: c[0].__collection, id: c[0].id, patch: c[1] }));
}

/** The retention write, which goes through docRef.set and so records by id. */
function retentionWrite(): Record<string, any> | undefined {
    const call = ((global as any).mockFirestoreSet as jest.Mock).mock.calls
        .find((c) => c[0] === UID);
    return call ? call[1] : undefined;
}

const isDeleteSentinel = (v: any) =>
    !!v && typeof v === 'object' && (v._methodName === 'FieldValue.delete' || v.constructor?.name === 'DeleteTransform');

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).mockFirestoreSet = jest.fn();
    (global as any).mockFirestoreBatchCommit = jest.fn(() => Promise.resolve());
    (global as any).mockFirestoreBatchDelete = jest.fn();
    (global as any).mockFirestoreDelete = jest.fn(() => Promise.resolve());
    seed({});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#376 — the definition covers every collection that holds a copy', () => {
    const names = () => MODULE_ERASURE_TARGETS.map((t) => t.collection);

    it('ALL EIGHT COLLECTIONS ARE TARGETS', () => {
        expect(names().sort()).toEqual([
            COLLECTIONS.ACADEMY_APPLICATIONS,
            COLLECTIONS.COOPERATIVE_MEMBERS,
            COLLECTIONS.EXPORT_APPLICATIONS,
            COLLECTIONS.FARM_NATION_APPLICATIONS,
            COLLECTIONS.MARKETPLACE_SELLERS,
            COLLECTIONS.SELLER_VERIFICATIONS,
            COLLECTIONS.WAVE_APPLICATIONS,
            COLLECTIONS.WAVE_MEMBERS,
        ].sort());
    });

    it('EVERY COLLECTION THE KYC SYNC FANS PII INTO IS ONE OF THEM', () => {
        /**
         * Derived from kyc.ts, not remembered. saveKYCProfileAction's own
         * cross-module sync is the thing #283 and #371 both recorded as
         * out of reach, so its target list is the floor for this one — and if
         * a sixth is added there tomorrow, this fails rather than drifting.
         */
        const kyc = source('src/app/actions/kyc.ts');
        const start = kyc.indexOf('const batch = db.batch();');
        const end = kyc.indexOf('await runQueryWithRetry(() => batch.commit());', start);

        expect({ found: start > -1 && end > start }).toEqual({ found: true });

        const block = kyc.slice(start, end);
        const synced = [...block.matchAll(/COLLECTIONS\.([A-Z_]+)/g)].map((m) => m[1]);

        expect(synced.length).toBe(5);
        for (const key of synced) {
            expect({ key, covered: names().includes((COLLECTIONS as any)[key]) })
                .toEqual({ key, covered: true });
        }
    });

    it('AND THE FIELDS THAT SYNC WRITES ARE COVERED, ROOT BY ROOT', () => {
        // `personalInfo.phone` is covered by erasing the `personalInfo` root;
        // `phone` by erasing `phone`. Checked against the real dotted keys the
        // sync uses rather than against a list retyped here.
        const kyc = source('src/app/actions/kyc.ts');
        const start = kyc.indexOf('const batch = db.batch();');
        const block = kyc.slice(start, kyc.indexOf('await runQueryWithRetry(() => batch.commit());', start));

        const byCollection = new Map(MODULE_ERASURE_TARGETS.map((t) => [t.collection, t.pii]));
        let checked = 0;

        for (const chunk of block.split(/COLLECTIONS\./).slice(1)) {
            const key = chunk.match(/^([A-Z_]+)/)?.[1];
            const collection = key ? (COLLECTIONS as any)[key] : undefined;
            const pii = collection ? byCollection.get(collection) : undefined;
            if (!pii) continue;

            for (const m of chunk.matchAll(/'([a-zA-Z][a-zA-Z.]*)':/g)) {
                const root = m[1].split('.')[0];
                if (root === 'updatedAt') continue;
                checked++;
                expect({ collection, root, covered: pii.includes(root) })
                    .toEqual({ collection, root, covered: true });
            }
            // The unquoted keys in the same object literal — `phone:` etc.
            for (const m of chunk.matchAll(/\n\s{16,}([a-zA-Z][a-zA-Z0-9]*):/g)) {
                const root = m[1];
                if (root === 'updatedAt') continue;
                checked++;
                expect({ collection, root, covered: pii.includes(root) })
                    .toEqual({ collection, root, covered: true });
            }
        }

        // Not vacuous: the sweep really found the sync's field keys.
        expect(checked).toBeGreaterThanOrEqual(14);
    });

    it('AND SO IS EVERY FIELD THE ADMIN PROFILE EDITOR FANS OUT', () => {
        /**
         * The SECOND derivation, and the one that catches the spellings the KYC
         * sync never writes. admin/_applications.ts builds one update object
         * per module and assigns the field names directly —
         *
         *     waveUpdate.phoneNumber = val("phone");
         *     sellerUpdate["bankAccount.accountNumber"] = accNumVal;
         *     sellerUpdate["bankDetails.accountNumber"] = accNumVal;
         *
         * — so it is a machine-readable statement of what an admin edit puts on
         * each row. Two roots for one bank account, and a phone spelling the
         * sync does not use: exactly the drift #371 was opened for, read off
         * the source rather than remembered.
         */
        const editor = source('src/app/actions/admin/_applications.ts');
        const PREFIX: Record<string, string> = {
            coop: COLLECTIONS.COOPERATIVE_MEMBERS,
            wave: COLLECTIONS.WAVE_APPLICATIONS,
            seller: COLLECTIONS.SELLER_VERIFICATIONS,
            export: COLLECTIONS.EXPORT_APPLICATIONS,
            academy: COLLECTIONS.ACADEMY_APPLICATIONS,
            farm: COLLECTIONS.FARM_NATION_APPLICATIONS,
        };
        const byCollection = new Map(MODULE_ERASURE_TARGETS.map((t) => [t.collection, t.pii]));
        const seen = new Set<string>();

        const record = (prefix: string, field: string) => {
            const collection = PREFIX[prefix];
            if (!collection) return;
            const root = field.split('.')[0];
            if (root === 'updatedAt' || root === 'lastEditedBy' || root === 'lastEditedAt') return;
            seen.add(`${collection}:${root}`);
            expect({ collection, root, covered: byCollection.get(collection)!.includes(root) })
                .toEqual({ collection, root, covered: true });
        };

        for (const m of editor.matchAll(/(coop|wave|seller|export|academy|farm)Update\.([a-zA-Z][a-zA-Z0-9]*)\s*=/g)) {
            record(m[1], m[2]);
        }
        for (const m of editor.matchAll(/(coop|wave|seller|export|academy|farm)Update\["([a-zA-Z][a-zA-Z0-9.]*)"\]\s*=/g)) {
            record(m[1], m[2]);
        }

        // Not vacuous, and named: these four are the ones only this file writes.
        expect(seen.size).toBeGreaterThanOrEqual(25);
        expect(seen).toContain(`${COLLECTIONS.WAVE_APPLICATIONS}:phoneNumber`);
        expect(seen).toContain(`${COLLECTIONS.SELLER_VERIFICATIONS}:bankAccount`);
        expect(seen).toContain(`${COLLECTIONS.SELLER_VERIFICATIONS}:bankDetails`);
        expect(seen).toContain(`${COLLECTIONS.SELLER_VERIFICATIONS}:location`);
    });

    it('every target names fields and a way to find its rows', () => {
        for (const t of MODULE_ERASURE_TARGETS) {
            expect({ c: t.collection, fields: t.pii.length > 0 }).toEqual({ c: t.collection, fields: true });
            expect(t.deterministicIds(UID).length).toBeGreaterThan(0);
            for (const id of t.deterministicIds(UID)) expect(id).toContain(UID);
        }
    });

    it('THE THREE COLLECTIONS THAT HOLD IDENTITY NUMBERS IN CLEAR ARE SCRUBBED OF THEM', () => {
        const pii = (c: string) => MODULE_ERASURE_TARGETS.find((t) => t.collection === c)!.pii;

        expect(pii(COLLECTIONS.COOPERATIVE_MEMBERS)).toEqual(expect.arrayContaining(['bvn', 'nin']));
        expect(pii(COLLECTIONS.SELLER_VERIFICATIONS)).toEqual(expect.arrayContaining(['nin', 'bvn', 'cac']));
        // The export row keeps them under `kyc`, so the root is what goes.
        expect(pii(COLLECTIONS.EXPORT_APPLICATIONS)).toContain('kyc');
    });

    it('and the next of kin goes in all three of its spellings', () => {
        // A third party who never consented and cannot ask for their own
        // erasure. The onboarding path writes the nested root; the resubmission
        // path writes the flat trio; the /api register route writes the nested
        // root under different child names, which the root covers.
        const coop = MODULE_ERASURE_TARGETS.find((t) => t.collection === COLLECTIONS.COOPERATIVE_MEMBERS)!.pii;

        expect(coop).toEqual(expect.arrayContaining([
            'nextOfKin', 'nextOfKinName', 'nextOfKinPhone', 'nextOfKinAddress',
        ]));
        const wave = MODULE_ERASURE_TARGETS.find((t) => t.collection === COLLECTIONS.WAVE_APPLICATIONS)!.pii;
        expect(wave).toEqual(expect.arrayContaining([
            'nextOfKinName', 'nextOfKinPhone', 'nextOfKinRelationship',
        ]));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#376 — the patch removes the identity and retires the row', () => {
    const target = MODULE_ERASURE_TARGETS.find((t) => t.collection === COLLECTIONS.COOPERATIVE_MEMBERS)!;

    it('EVERY NAMED FIELD IS DELETED — counted, not sampled', () => {
        const patch = moduleErasurePatch(target, UID);
        const deleted = Object.keys(patch).filter((k) => isDeleteSentinel(patch[k]));

        expect(deleted.sort()).toEqual([...target.pii].sort());
    });

    it('and the row is MARKED rather than removed — #300', () => {
        const patch = moduleErasurePatch(target, UID);

        expect(patch.ownerErased).toBe(true);
        expect(patch.ownerErasedUserId).toBe(UID);
        expect(typeof patch.ownerErasedAt).toBe('string');
    });

    it('NOTHING THE ROW IS FOR IS TOUCHED', () => {
        // The balances, status and dates a payout still needs. #300 refuses to
        // destroy the record; this only removes the person from it.
        const patch = moduleErasurePatch(target, UID);

        for (const kept of ['savingsBalance', 'loanBalance', 'membershipStatus',
                            'createdAt', 'userId', 'paymentStatus', 'tier']) {
            expect({ kept, present: kept in patch }).toEqual({ kept, present: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#376 — the uploaded-document references are kept before the field goes', () => {
    it('a dotted path is read out of the row', () => {
        const exportTarget = MODULE_ERASURE_TARGETS.find((t) => t.collection === COLLECTIONS.EXPORT_APPLICATIONS)!;

        expect(exportTarget.documentPaths).toEqual(['kyc.documents']);
        expect(retainedDocumentsFrom(exportTarget, 'app-1', {
            kyc: { documents: { idDocument: 'https://res.cloudinary.com/a.jpg' } },
        })).toEqual([{
            collection: COLLECTIONS.EXPORT_APPLICATIONS,
            docId: 'app-1',
            path: 'kyc.documents',
            value: { idDocument: 'https://res.cloudinary.com/a.jpg' },
        }]);
    });

    it('a missing parent yields nothing rather than throwing', () => {
        const exportTarget = MODULE_ERASURE_TARGETS.find((t) => t.collection === COLLECTIONS.EXPORT_APPLICATIONS)!;

        expect(retainedDocumentsFrom(exportTarget, 'app-1', {})).toEqual([]);
        expect(retainedDocumentsFrom(exportTarget, 'app-1', undefined)).toEqual([]);
        expect(retainedDocumentsFrom(exportTarget, 'app-1', { kyc: null })).toEqual([]);
    });

    it('only the three collections that hold references declare a path', () => {
        const withPaths = MODULE_ERASURE_TARGETS
            .filter((t) => t.documentPaths.length > 0)
            .map((t) => t.collection);

        expect(withPaths.sort()).toEqual([
            COLLECTIONS.COOPERATIVE_MEMBERS,
            COLLECTIONS.EXPORT_APPLICATIONS,
            COLLECTIONS.SELLER_VERIFICATIONS,
        ].sort());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#376 — the sweep, end to end', () => {
    it('SCRUBS A ROW FOUND BY THE userId QUERY', async () => {
        seed({
            [COLLECTIONS.COOPERATIVE_MEMBERS]: [{
                id: 'coop-row', data: { userId: UID, fullName: 'Ada Obi', phone: '08030000000' },
            }],
        });

        const result = await eraseModuleApplications(UID);

        expect(result.ok).toBe(true);
        expect(result.rowsScrubbed).toBe(1);

        const writes = batchedWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].collection).toBe(COLLECTIONS.COOPERATIVE_MEMBERS);
        expect(writes[0].id).toBe('coop-row');
        expect(isDeleteSentinel(writes[0].patch.fullName)).toBe(true);
        expect(isDeleteSentinel(writes[0].patch.phone)).toBe(true);
        expect(writes[0].patch.ownerErased).toBe(true);
    });

    it('AND A ROW CARRYING NO userId, AT THE ID ITS WRITER DERIVED', async () => {
        // The case the query cannot see. seller_verifications is the sharp one:
        // actions/user.ts marked doc(userId) only, which is the wrong id for
        // every row the two server-action creators write.
        seed({}, { [`legacy_${UID}`]: { businessName: "Ada's Enterprise", phone: '08030000000' } });

        const result = await eraseModuleApplications(UID);

        const hit = batchedWrites().filter((w) => w.id === `legacy_${UID}`);
        expect(hit.length).toBeGreaterThan(0);
        expect(result.rowsScrubbed).toBe(hit.length);
        for (const w of hit) expect(w.patch.ownerErased).toBe(true);
    });

    it('a row found BOTH ways is written once', async () => {
        seed(
            { [COLLECTIONS.WAVE_MEMBERS]: [{ id: UID, data: { userId: UID, name: 'Ada Obi' } }] },
            { [UID]: { userId: UID, name: 'Ada Obi' } },
        );

        await eraseModuleApplications(UID);

        expect(batchedWrites().filter((w) => w.collection === COLLECTIONS.WAVE_MEMBERS)).toHaveLength(1);
    });

    it('EVERY TARGET COLLECTION IS ASKED, AND ASKED FOR THIS USER', async () => {
        await eraseModuleApplications(UID);

        // The FILTER, not just the collection. A sweep keyed on a field the
        // rows do not carry finds nothing and reports a clean erasure — which
        // is the failure mode this whole finding is about, one level up.
        for (const t of MODULE_ERASURE_TARGETS) {
            const asked = queried.find((q) => q.collection === t.collection);
            expect({ c: t.collection, filters: asked?.filters })
                .toEqual({ c: t.collection, filters: [{ field: 'userId', op: '==', value: UID }] });
        }
        expect(queried).toHaveLength(MODULE_ERASURE_TARGETS.length);
    });

    it('THE REFERENCES ARE RETAINED, AND BEFORE THE SCRUB COMMITS', async () => {
        seed({
            [COLLECTIONS.COOPERATIVE_MEMBERS]: [{
                id: 'coop-row',
                data: { userId: UID, documents: { validId: { url: 'https://res.cloudinary.com/id.jpg' } } },
            }],
        });

        await eraseModuleApplications(UID);

        const retention = retentionWrite();
        expect(retention?.moduleDocuments).toEqual([{
            collection: COLLECTIONS.COOPERATIVE_MEMBERS,
            docId: 'coop-row',
            path: 'documents',
            value: { validId: { url: 'https://res.cloudinary.com/id.jpg' } },
        }]);

        // Order matters: retained first, or a failure between the two loses the
        // only record of whose the file is while the file itself stays.
        const setMock = (global as any).mockFirestoreSet as jest.Mock;
        const commitMock = (global as any).mockFirestoreBatchCommit as jest.Mock;
        const retentionCall = setMock.mock.calls.findIndex((c) => c[0] === UID);
        expect(retentionCall).toBeGreaterThan(-1);
        expect(setMock.mock.invocationCallOrder[retentionCall])
            .toBeLessThan(commitMock.mock.invocationCallOrder[0]);
    });

    it('and NO retention key is written when there is nothing to retain', async () => {
        // A second erasure pass over an already-scrubbed account finds none.
        // Writing an empty array through a merge would erase what the first
        // pass kept — the #300 mistake, one level down.
        seed({ [COLLECTIONS.WAVE_MEMBERS]: [{ id: UID, data: { userId: UID, name: 'Ada Obi' } }] });

        await eraseModuleApplications(UID);

        expect(retentionWrite()).toBeUndefined();
    });

    it('IF THE REFERENCES CANNOT BE KEPT, NOTHING IS SCRUBBED', async () => {
        seed({
            [COLLECTIONS.SELLER_VERIFICATIONS]: [{
                id: 'ver-1', data: { userId: UID, documents: { idDoc: 'https://res.cloudinary.com/x.jpg' } },
            }],
        });
        (global as any).mockFirestoreSet = jest.fn((key: any) => {
            if (key === UID) throw new Error('retention store unreachable');
        });

        const result = await eraseModuleApplications(UID);

        expect(result.ok).toBe(false);
        expect(result.rowsScrubbed).toBe(0);
        expect(result.failures).toContain('retention');
        expect((global as any).mockFirestoreBatchCommit).not.toHaveBeenCalled();
    });

    it('A COLLECTION THAT CANNOT BE READ IS REPORTED, NOT SWALLOWED', async () => {
        // The KYC sync catches its own errors and logs a warning, which is
        // right for a convenience sync and wrong here: telling somebody their
        // data is gone when a collection was unreachable is the outcome the
        // erasure path exists to avoid.
        (global as any).mockFirestoreGet = jest.fn((key: string) => {
            if (key === COLLECTIONS.WAVE_APPLICATIONS) return Promise.reject(new Error('boom'));
            return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => undefined });
        });

        const result = await eraseModuleApplications(UID);

        expect(result.ok).toBe(false);
        expect(result.failures).toEqual([COLLECTIONS.WAVE_APPLICATIONS]);
    });

    it('NOTHING IS EVER DELETED', async () => {
        seed({
            [COLLECTIONS.COOPERATIVE_MEMBERS]: [{ id: 'coop-row', data: { userId: UID, fullName: 'Ada Obi' } }],
            [COLLECTIONS.SELLER_VERIFICATIONS]: [{ id: 'ver-1', data: { userId: UID, nin: '12345678901' } }],
        });

        await eraseModuleApplications(UID);

        expect((global as any).mockFirestoreBatchDelete).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreDelete).not.toHaveBeenCalled();
    });

    it('an account with no module rows is a clean pass, not a failure', async () => {
        const result = await eraseModuleApplications(UID);

        expect(result).toEqual({ ok: true, rowsScrubbed: 0, retained: [], failures: [] });
        expect((global as any).mockFirestoreBatchCommit).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#376 — every erasure door uses it, and none keeps its own list', () => {
    /**
     * WAS THREE DOORS, EACH CALLING eraseModuleApplications DIRECTLY.
     *
     * #206 found a FOURTH — bulkDeleteUsersAction — which called it not at
     * all, and scrubbed nothing whatever. Rather than adding a fourth direct
     * caller, the two ADMIN doors now share one operation
     * (lib/user-soft-delete.ts), which is what makes a fifth impossible to get
     * wrong: there is one implementation of "delete a user", not two that
     * happen to agree.
     *
     * So the doors below are the ones that call the sweep directly, and the two
     * admin doors are checked through the operation they share.
     */
    const DOORS = [
        'src/app/actions/user.ts',                    // the member's own request
        'src/lib/user-soft-delete.ts',                // BOTH admin deletions
        'src/app/api/cron/gdpr-purge/route.ts',       // the 30-day sweep
    ];

    /** The two admin doors, which reach the sweep through the shared operation. */
    const ADMIN_DOORS = [
        'src/app/actions/admin_extensions.ts',        // one user
        'src/app/actions/bulk-user-operations.ts',    // up to fifty
    ];

    it('EACH DOOR CALLS THE SHARED SWEEP', () => {
        for (const door of DOORS) {
            const s = source(door);
            expect({ door, imports: /from\s+["']@\/lib\/module-application-erasure["']/.test(s) })
                .toEqual({ door, imports: true });
            expect({ door, calls: /eraseModuleApplications\(/.test(s) })
                .toEqual({ door, calls: true });
        }
    });

    it('AND BOTH ADMIN DOORS REACH IT THROUGH THE ONE SHARED OPERATION', () => {
        // #206. The bulk door wrote five bookkeeping fields and scrubbed
        // nothing; five successive fixes had all landed on its sibling.
        for (const door of ADMIN_DOORS) {
            const s = source(door);
            expect({ door, calls: /softDeleteUserRecord\(/.test(s) })
                .toEqual({ door, calls: true });
            // And neither keeps a second implementation beside it.
            expect({ door, ownPatch: /userErasurePatch\(/.test(s) })
                .toEqual({ door, ownPatch: false });
        }
    });

    it('AND ACTS ON A FAILURE RATHER THAN CONTINUING', () => {
        // #305's shape: a door that scrubs and reports success regardless is
        // the defect, not the absence of the call.
        // The NEGATED check, not a mention of the field. `if (false)` beside a
        // `moduleErasure.failures` in the body reads as handled and is not.
        for (const door of DOORS) {
            expect({ door, checked: /if\s*\(!moduleErasure\.ok\)/.test(source(door)) })
                .toEqual({ door, checked: true });
        }

        // And the admin doors act on the shared operation's verdict the same
        // way — a half-scrubbed account reported as deleted is how personal
        // data survives a deletion nobody looks at again.
        for (const door of ADMIN_DOORS) {
            expect({ door, checked: /if\s*\(!outcome\.ok\)/.test(source(door)) })
                .toEqual({ door, checked: true });
        }
    });

    it('no door writes a module field list of its own', () => {
        // The whole argument of #283 and #305: a hand-written list in one file
        // is how the omission happens. Anything naming a module PII field
        // outside the shared module is a second list.
        for (const door of DOORS) {
            const s = source(door);
            expect({ door, hit: /nextOfKinName|residentialAddress|bankAccountNumber/.test(s) })
                .toEqual({ door, hit: false });
        }
    });

    it('THE SHARED MODULE IS THE ONLY PLACE THE COLLECTION SET IS STATED', () => {
        // A sweep, so a fourth erasure door added later is visible here.
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) {
                    if (e.name === '__tests__') continue;
                    walk(rel);
                } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) files.push(rel);
            }
        };
        walk('src');

        const callers = files.filter((f) => /eraseModuleApplications\(/.test(source(f)));

        // The shared operation is among the direct callers; the two admin doors
        // are deliberately NOT, because they go through it.
        expect(callers.sort()).toEqual([...DOORS, 'src/lib/module-application-erasure.ts'].sort());
        expect(files.length).toBeGreaterThan(400);
    });

    it('and the finding is recorded where the next sweep will read it', () => {
        const raw = readFileSync('src/lib/module-application-erasure.ts', 'utf-8');

        expect(raw).toContain('#376');
        expect(raw).toContain('THE RECORDED FINDING SAID FIVE COLLECTIONS. IT IS EIGHT');
        // Measured on code, not on prose: the tombstone above names the
        // collections in a comment, and a raw sweep would count those.
        expect(source('src/lib/module-application-erasure.ts')).not.toContain('THE RECORDED FINDING');
    });
});
