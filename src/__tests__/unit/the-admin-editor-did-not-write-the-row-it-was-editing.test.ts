/**
 * @jest-environment node
 */

/**
 *   #775 THE ADMIN EDITED AN APPLICATION, WAS TOLD IT WAS SAVED, AND ONE FIELD
 *        IN SIX HAD CHANGED.
 *
 *   Reported by the owner: "The edit form on the admin is not complete with all
 *   information why?"
 *
 *   It is two defects wearing one symptom, and the second is the dangerous one.
 *
 * ── (a) THE FORM SHOWED FIVE OF FORTY-SEVEN, AND LOADED FOUR ────────────────
 *
 *   The WAVE application form collects 47 answers across seven sections. The
 *   admin who approves or rejects it could edit five. Worse, the list used to
 *   LOAD the dialog and the list used to DRAW it were separate literals and
 *   disagreed:
 *
 *       seeded : surname, firstName, otherNames, phone
 *       drawn  : surname, firstName, phone, stateOfResidence, lgaOfResidence
 *
 *   `otherNames` was loaded with no box to show it. State and LGA had boxes
 *   that were never loaded, so they opened BLANK on an application that had
 *   both — an admin reading that dialog saw an applicant who had skipped two
 *   questions she had in fact answered. That is the owner's sentence exactly.
 *
 * ── (b) AND THE DOCUMENT BEING EDITED WAS NOT WRITTEN AT ALL ────────────────
 *
 *   editApplicationAction fans an edit out to as many as seven sibling
 *   documents through a hand-maintained map. The edited row itself was written
 *   by this, and only this:
 *
 *       if (collectionName === LAND_LISTINGS
 *             || !ALLOWED_COLLECTIONS.includes(collectionName)) { ... }
 *
 *   The second half is DEAD — a collection outside ALLOWED_COLLECTIONS is
 *   refused two hundred lines earlier. So the row the admin opened was written
 *   for land listings and for nothing else, and every other collection got
 *   whatever the fan-out map happened to spell.
 *
 *   MEASURED before the fix, sending exactly what the screen sends:
 *
 *       success: true — "Application updated with audit trail."
 *
 *         surname           OLD-SURNAME      unchanged
 *         firstName         NEW-FIRST        the only one that landed
 *         otherNames        OLD-OTHER        unchanged
 *         phone             OLD-PHONE        unchanged
 *         stateOfResidence  OLD-STATE-RES    unchanged
 *         lgaOfResidence    OLD-LGA-RES      unchanged
 *         phoneNumber       NEW-PHONE        a key this row never had
 *
 *   The audit trail records `after: sanitized` — all six — so the log asserted
 *   five changes that were never made. An admin correcting a member's surname
 *   got a success toast and a receipt, and nothing had happened.
 *
 *   `phoneNumber` and `state` are wave REGISTRATION field names, on a wave
 *   APPLICATION row. Both are still written, alongside the correct ones: this
 *   finding adds writes and removes none, because a row somewhere may already
 *   carry the stray key and the owner's rule is that nothing is destroyed.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   The NIN and BVN are stored HASHED (see _wv_applications.ts), so the editor
 *   cannot show them and does not try. That is a property worth keeping, not a
 *   missing field, and unhashing them to fill a box would be the opposite of
 *   the repair.
 *
 *   The read-only "View Details" modal was already complete — it iterates the
 *   document — so only the EDITOR is changed here.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the unconditional docRef write reverted to its dead condition   KILLED
 *     waveUpdate.phone dropped, leaving only phoneNumber       SURVIVED → KILLED
 *     the seed loop narrowed back to four fields                      KILLED
 *     a field added to the form but not to ALLOWED_EDIT_FIELDS        KILLED
 *     reword this header                                    SURVIVED, intended
 *
 *   THE PHONE MUTANT SURVIVED THE FIRST RUN, and the fault was mine. Every
 *   test here edited the wave row DIRECTLY, where the new unconditional write
 *   lands `phone` from `sanitized` and masks whatever the fan-out map spells.
 *   The map only matters when the admin edits a DIFFERENT document — the user
 *   record, the cooperative row — and nothing exercised that. With that case
 *   added the mutant dies on it alone, which is the right place for it to die.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;
const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const APP = 'WAVE-123';

const STORED = {
    surname: 'OLD-SURNAME',
    firstName: 'OLD-FIRST',
    otherNames: 'OLD-OTHER',
    phone: 'OLD-PHONE',
    stateOfResidence: 'OLD-STATE-RES',
    lgaOfResidence: 'OLD-LGA-RES',
    lgaOfOrigin: 'OLD-LGA-ORIG',
    nextOfKinName: 'OLD-NOK',
} as const;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'a@b.c' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'] });
    store.seed(COLLECTIONS.USERS, MEMBER, { serviceRegistrations: { wave: { applicationId: APP } } });
    store.seed(COLLECTIONS.WAVE_APPLICATIONS, APP, { userId: MEMBER, ...STORED });
});

const editWave = async (fields: Record<string, unknown>) => {
    const { editApplicationAction } = await import('@/app/actions/admin/_applications');
    return (await editApplicationAction({
        collection: COLLECTIONS.WAVE_APPLICATIONS,
        docId: APP,
        fields: fields as any,
    })) as any;
};

const waveRow = () => store.get(COLLECTIONS.WAVE_APPLICATIONS, APP) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#775 — the row the admin opened is the row that changes', () => {
    it('EVERY FIELD THE ADMIN EDITS IS ACTUALLY WRITTEN', async () => {
        //   THE test. Before the fix this passed for `firstName` alone.
        const res = await editWave({
            surname: 'NEW-SURNAME',
            firstName: 'NEW-FIRST',
            otherNames: 'NEW-OTHER',
            phone: 'NEW-PHONE',
            stateOfResidence: 'NEW-STATE-RES',
            lgaOfResidence: 'NEW-LGA-RES',
        });

        expect(res.success).toBe(true);

        const row = waveRow();
        expect(row.surname).toBe('NEW-SURNAME');
        expect(row.firstName).toBe('NEW-FIRST');
        expect(row.otherNames).toBe('NEW-OTHER');
        expect(row.phone).toBe('NEW-PHONE');
        expect(row.stateOfResidence).toBe('NEW-STATE-RES');
        expect(row.lgaOfResidence).toBe('NEW-LGA-RES');
    });

    it('AND A SUCCESS IS NOT REPORTED FOR A FIELD THAT DID NOT MOVE', async () => {
        //   The audit trail records `after: sanitized`. That claim is only
        //   honest if sanitized is what the row now holds — which is what the
        //   dead condition made false.
        await editWave({ surname: 'CHANGED' });

        expect(waveRow().surname).toBe('CHANGED');
        //   and the untouched neighbours are left exactly alone
        expect(waveRow().firstName).toBe(STORED.firstName);
        expect(waveRow().lgaOfResidence).toBe(STORED.lgaOfResidence);
    });

    it('the wave row\'s OWN phone field is written, not only the registration spelling', async () => {
        await editWave({ phone: 'NEW-PHONE' });

        expect(waveRow().phone).toBe('NEW-PHONE');
        //   the stray key is kept rather than removed — nothing is destroyed
        expect(waveRow().phoneNumber).toBe('NEW-PHONE');
    });

    it('AND WHEN THE ADMIN EDITS A DIFFERENT ROW, THE FAN-OUT STILL SPELLS IT RIGHT', async () => {
        /*
         *   This is the case the direct write above does NOT cover, and the one
         *   the fan-out map exists for. Editing the member's USER record must
         *   carry the new phone onto their wave application — and that row is
         *   reached only through `waveUpdate`, where the key was `phoneNumber`.
         *
         *   Dropping `waveUpdate.phone` SURVIVED the first mutation run because
         *   every other test here edits the wave row directly, where the new
         *   unconditional write masks the wrong spelling. The fault was in the
         *   test, not the fix: without this case the map could regress to a
         *   field name nothing reads and nothing would notice.
         */
        const { editApplicationAction } = await import('@/app/actions/admin/_applications');
        const res = (await editApplicationAction({
            collection: COLLECTIONS.USERS,
            docId: MEMBER,
            fields: { phone: 'FANNED-OUT' } as any,
        })) as any;

        expect(res.success).toBe(true);
        expect(waveRow().phone).toBe('FANNED-OUT');
    });

    it('and the flat next-of-kin and origin-LGA fields are editable at all', async () => {
        //   The allow-list carried only the DOTTED spellings (nextOfKin.name),
        //   which cannot address this row's flat keys — so these four could
        //   never be corrected by anybody.
        const res = await editWave({ nextOfKinName: 'NEW-NOK', lgaOfOrigin: 'NEW-LGA-ORIG' });

        expect(res.success).toBe(true);
        expect(waveRow().nextOfKinName).toBe('NEW-NOK');
        expect(waveRow().lgaOfOrigin).toBe('NEW-LGA-ORIG');
    });

    it('CONTROL: a key that is not on the allow-list is still refused', async () => {
        //   The fix widens what the editor writes; it must not turn the editor
        //   into an arbitrary document writer.
        const res = await editWave({ status: 'approved', rejectionReason: 'x' });

        expect(res.success).toBe(false);
        expect(waveRow().status).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#775 — the form and the allow-list cannot drift apart', () => {
    const page = readFileSync(
        join(process.cwd(), 'src/app/admin/wave/applications/page.tsx'), 'utf8');
    const action = readFileSync(
        join(process.cwd(), 'src/app/actions/admin/_applications.ts'), 'utf8');

    const formKeys = [...page
        .split('const EDITABLE_WAVE_FIELDS')[1]
        .split('];')[0]
        .matchAll(/key:\s*"([^"]+)"/g)].map(m => m[1]);

    const allowed = [...action
        .split('const ALLOWED_EDIT_FIELDS')[1]
        .split('];')[0]
        .matchAll(/"([^"]+)"/g)].map(m => m[1]);

    it('the form is no longer five boxes', () => {
        //   Vacuity guard: the assertion below is trivially true of an empty
        //   list, and the defect was a list that was too short.
        expect(formKeys.length).toBeGreaterThanOrEqual(15);
    });

    it('EVERY BOX ON THE FORM IS A FIELD THE SERVER WILL ACTUALLY WRITE', () => {
        //   A box whose key is not on the allow-list is silently dropped by the
        //   sanitiser — it looks editable, accepts typing, saves "successfully"
        //   and changes nothing. That is defect (b) in a new costume, so it is
        //   ratcheted rather than left to review.
        const dropped = formKeys.filter(k => !allowed.includes(k));
        expect(dropped).toEqual([]);
    });

    it('and the dialog is seeded from that same list, not a second literal', () => {
        //   The drift in (a) was possible only because two literals existed.
        //   One `for (const { key } of EDITABLE_WAVE_FIELDS)` seeds the draft.
        const seedLoop = /for\s*\(\s*const\s*\{\s*key\s*\}\s*of\s+EDITABLE_WAVE_FIELDS\s*\)/;
        expect(seedLoop.test(page)).toBe(true);

        //   and no hand-written second list of field literals survives in the
        //   open-edit handler
        const handler = page.split('function handleOpenEdit')[1].split('\n    }')[0];
        expect(handler).not.toMatch(/surname:\s*app\.data/);
    });
});
