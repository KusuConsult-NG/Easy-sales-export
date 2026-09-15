/**
 * @jest-environment node
 */

/**
 *   #783 THREE OF THE SIX ADMIN APPLICATION SCREENS COULD NOT CORRECT ANYTHING
 *        AT ALL, AND A FOURTH HAD TWO BOXES THAT DID NOTHING.
 *
 *   The owner: "ensure all forms that collects data shows admin the same data
 *   that are being collected and when admin clicks edit, admin should be able
 *   to see all the fields and should be able to edit it."
 *
 *   MEASURED across the six screens:
 *
 *       export/applications        no editor
 *       academy/applications       no editor
 *       farm-nation/applications   no editor
 *       marketplace/sellers         5 fields
 *       cooperatives/members       14 fields, TWO OF THEM DROPPED
 *       wave/applications          17 fields  (after #775)
 *
 *   THE VIEWING HALF WAS ALREADY FINE, which is worth saying because it is half
 *   of what was asked for: all six render DynamicDetailModal, which iterates
 *   the stored document, so an admin could always SEE everything collected.
 *   #779 fixed the one thing it was showing wrongly. What three of them could
 *   not do is CHANGE any of it.
 *
 *   Export's screen has an "Edit" button, and it is a different thing: it asks
 *   the APPLICANT to revise. An admin who spotted a typo could send the
 *   applicant away to fix it and could not fix it themselves.
 *
 * ── AND THE FOURTH IS #775 AGAIN, INSIDE THE FIX FOR #775 ───────────────────
 *
 *   The cooperative members editor renders "Date of Birth" and "Ward". Neither
 *   key was on ALLOWED_EDIT_FIELDS, so the sanitiser dropped both: an admin
 *   typed a correction, the dialog said it had saved, and the record was
 *   unchanged.
 *
 *   #775 found precisely that on the WAVE screen and wrote a ratchet for it —
 *   which checked the WAVE screen. "A correct rule applied to some of the
 *   places it names" is this audit's most repeated finding, and here it is
 *   inside the repair for its own last occurrence. This suite sweeps the SET.
 *
 * ── dateOfBirth IS DELIBERATELY EDITABLE HERE AND NOWHERE ELSE ──────────────
 *
 *   The submission paths write it only when the user record has none, because
 *   "an application is a declaration, not a correction" (#156), and that note
 *   says the audited admin route is where a genuinely wrong record gets fixed.
 *   This is that route.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     dateOfBirth removed from the server allow-list again        KILLED
 *     a field added to a screen's list but not the allow-list     KILLED
 *     the shared editor seeding from a second list                KILLED
 *     the editor dropping nested nextOfKin.* values               KILLED
 *     a screen's editor removed entirely                          KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ALL_EDITABLE_FIELD_SETS, readRecordPath, seedEditDraft } from '@/lib/admin-editable-fields';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every admin screen that reviews one member's record. */
const SCREENS: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'export', file: 'src/app/admin/export/applications/page.tsx' },
    { name: 'academy', file: 'src/app/admin/academy/applications/page.tsx' },
    { name: 'farm-nation', file: 'src/app/admin/farm-nation/applications/page.tsx' },
    { name: 'marketplace', file: 'src/app/admin/marketplace/sellers/page.tsx' },
    { name: 'cooperative', file: 'src/app/admin/cooperatives/members/page.tsx' },
    { name: 'wave', file: 'src/app/admin/wave/applications/page.tsx' },
];

/** The server's own allow-list, parsed rather than restated. */
function allowedEditFields(): string[] {
    const src = read('src/app/actions/admin/_applications.ts');
    const block = src.split('const ALLOWED_EDIT_FIELDS')[1].split('];')[0];
    return [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#783 — every admin record screen can correct the record', () => {
    it('the screen list is the real one', () => {
        //   Vacuity guard: every assertion below is trivially true of a file
        //   that has been renamed away.
        expect(SCREENS).toHaveLength(6);
        for (const { file } of SCREENS) {
            expect(existsSync(join(process.cwd(), file))).toBe(true);
        }
    });

    it.each(SCREENS)('$name can EDIT, not only view', ({ file }) => {
        const src = read(file);
        //   the view half — already true everywhere, pinned so it stays true
        expect(src).toMatch(/DynamicDetailModal/);
        //   the half that was missing on three of the six
        expect(src).toMatch(/editApplicationAction/);
    });

    it.each(SCREENS)('$name renders an editor dialog', ({ file }) => {
        /*
         *   Three shapes exist and all three are legitimate: the shared
         *   AdminRecordEditor on the screens that had nothing, and the two
         *   pre-existing in-place dialogs on marketplace and cooperative, which
         *   now draw and SEED from the shared field list. WAVE keeps #775's own
         *   dialog. What is not legitimate is a screen with none of them.
         */
        const src = read(file);
        expect(/AdminRecordEditor|setEditingApp|setEditDraft|setEditFields/.test(src)).toBe(true);
    });

    it.each(SCREENS)('$name seeds its draft from ONE list', ({ name, file }) => {
        /*
         *   #775's defect: a dialog that loads one list and draws another opens
         *   boxes BLANK on records that have values. It was live on two more
         *   screens — cooperative seeded 13 of 22, and marketplace seeded
         *   `address`/`state` while drawing `residentialAddress`/
         *   `stateOfOrigin`, so neither box ever showed what was stored.
         */
        const src = stripComments(read(file));
        if (name === 'wave') {
            //   #775's own loop, over its own list
            expect(src).toMatch(/for \(const \{ key \} of EDITABLE_WAVE_FIELDS\)/);
        } else {
            //   Either the screen seeds with the shared helper, or it hands the
            //   record to AdminRecordEditor, which seeds from the one list it
            //   also draws (asserted in its own describe below).
            expect(/seedEditDraft\(|<AdminRecordEditor/.test(src)).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#783 — no screen offers a box the server will drop', () => {
    it('EVERY DECLARED FIELD IS ONE THE SERVER WILL WRITE', () => {
        /*
         *   THE test, and the one #775 wrote for a single screen. A box whose
         *   key is not on the allow-list is silently discarded: it looks
         *   editable, accepts typing, saves "successfully" and changes nothing.
         *   That is what Date of Birth and Ward did.
         */
        const allowed = allowedEditFields();
        const dropped: string[] = [];

        for (const [module, fields] of Object.entries(ALL_EDITABLE_FIELD_SETS)) {
            for (const f of fields) {
                if (!allowed.includes(f.key)) dropped.push(`${module}.${f.key}`);
            }
        }

        expect(dropped).toEqual([]);
    });

    it('AND NO SCREEN STILL CARRIES AN INLINE LIST THAT COULD DRIFT', () => {
        //   The two screens that had their own literals are on the shared list
        //   now. WAVE's own list is checked separately by #775's suite.
        const allowed = allowedEditFields();

        for (const name of ['marketplace', 'cooperative']) {
            const file = SCREENS.find(s => s.name === name)!.file;
            const src = read(file);
            const inline = [...src.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:/g)].map(m => m[1]);
            expect({ name, inline }).toEqual({ name, inline: [] });
        }

        //   and WAVE's inline list, which #775 owns, is still all-allowed
        const wave = read(SCREENS.find(s => s.name === 'wave')!.file);
        const waveKeys = [...wave.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:/g)].map(m => m[1]);
        expect(waveKeys.filter(k => !allowed.includes(k))).toEqual([]);
    });

    it('the two keys that were being dropped are allowed now', () => {
        const allowed = allowedEditFields();
        expect(allowed).toContain('dateOfBirth');
        expect(allowed).toContain('ward');
    });

    it('CONTROL: the allow-list is still a list, not a wildcard', () => {
        /*
         *   The cheapest way to make every assertion above pass would be to let
         *   the editor write anything — which would let an admin set `status`,
         *   `roles` or `approvedBy` from a text box.
         */
        const allowed = allowedEditFields();
        for (const forbidden of ['status', 'roles', 'approvedBy', 'userId', 'createdAt']) {
            expect(allowed).not.toContain(forbidden);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#783 — the shared editor cannot repeat #775\'s seeding bug', () => {
    const editor = () => stripComments(read('src/components/admin/AdminRecordEditor.tsx'));

    it('IT SEEDS FROM THE SAME LIST IT DRAWS', () => {
        /*
         *   #775's defect was two lists: the WAVE dialog loaded four fields and
         *   drew five, so State and LGA opened BLANK on applications that had
         *   both. One loop over one list cannot do that.
         */
        const src = editor();
        expect(src).toMatch(/for \(const \{ key \} of fields\)/);
        //   and there is no second literal to disagree with
        expect(src).not.toMatch(/\{\s*key:\s*"/);
    });

    it('AND IT READS A NESTED VALUE, not just a flat key', () => {
        /*
         *   `nextOfKin.phone` is a real allow-list key and a NESTED path on the
         *   record. Seeding it with record["nextOfKin.phone"] finds undefined
         *   and opens the box blank on a member who has one — #775 again, with
         *   a dot in it.
         */
        //   ASKED, not read. The reader is shared code now, so it can be
        //   called with a known record instead of pattern-matched in a file.
        expect(readRecordPath({ nextOfKin: { phone: '08031234567' } }, 'nextOfKin.phone'))
            .toBe('08031234567');
        //   a flat key still wins, and a missing one is empty rather than "undefined"
        expect(readRecordPath({ 'nextOfKin.phone': 'flat' }, 'nextOfKin.phone')).toBe('flat');
        expect(readRecordPath({}, 'nextOfKin.phone')).toBe('');
        expect(readRecordPath(null, 'phone')).toBe('');

        //   and the editor uses THAT function rather than a second copy
        expect(editor()).toMatch(/readRecordPath\(record, key\)/);
    });

    it('AND SEEDING IS ONE FUNCTION, asked directly', () => {
        //   The whole point of #783's repair: one list in, one draft out.
        const draft = seedEditDraft(
            { firstName: 'Ada', nextOfKin: { name: 'Ngozi' } },
            [{ key: 'firstName', label: 'First' }, { key: 'nextOfKin.name', label: 'NOK' }, { key: 'phone', label: 'Phone' }],
        );
        expect(draft).toEqual({ firstName: 'Ada', 'nextOfKin.name': 'Ngozi', phone: '' });
    });

    it('and it says the member will be told', () => {
        //   #782 made that true; a dialog that does not say so invites an admin
        //   to treat an edit as private.
        expect(editor()).toMatch(/member is notified|shown to the member/i);
    });
});
