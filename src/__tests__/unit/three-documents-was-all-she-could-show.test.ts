/**
 * @jest-environment node
 */

/**
 *   #860 THREE DOCUMENTS WAS ALL SHE COULD SHOW.
 *
 *   THE OWNER: "also add multiple document upload".
 *
 *   The listing form took exactly three files, one each: Land Title, Survey
 *   Plan, Tax Clearance. A seller with a deed of assignment, a power of
 *   attorney, a probate order, a second survey after a subdivision, or simply a
 *   certificate of occupancy that runs to two pages had nowhere to put them —
 *   and verification is decided on what she can show.
 *
 * ── THE NAMED SLOTS ARE KEPT, AND THAT IS THE DESIGN RATHER THAN CAUTION ────
 *
 *   The obvious change is to replace the three with one "upload your documents"
 *   field. It would be worse. Those names are what an admin verifying the land
 *   reads: "is there a C of O" is a different question from "are there eight
 *   files", and the review queue is built on the first.
 *
 *   #856 is the record of what happens when the PRESENCE of documents is
 *   confused with their substance — a badge that read "Verified Land" because
 *   `documents.length > 0`. Flattening the slots would push this module further
 *   in exactly that direction.
 *
 *   So the three stay named and required as they were, and anything else goes
 *   in a multi-file field beside them. All of it lands in the same
 *   `documentUrls` array the action already takes, so nothing downstream
 *   changes.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';
const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#860 — a seller can attach more than three documents', () => {
    it('THE REPORTED GAP: there is a multiple-file input', () => {
        const src = code(FORM);
        const at = src.indexOf('Other Supporting Documents');

        expect(at).toBeGreaterThan(-1);
        //   1,400, measured rather than guessed: the description paragraph
        //   between the label and the input is long, and 900 stopped inside
        //   it. A window chosen by eye is a window that fails against
        //   correct code — twice in this session before it was measured.
        expect(src.slice(at, at + 1400)).toContain('multiple');
    });

    it('AND THE FILES SHE ADDS ARE UPLOADED, not just listed', () => {
        /*
         *   The half that makes the field real rather than decorative. A picker
         *   whose files never reach the upload loop shows her a list and submits
         *   nothing — which looks like it worked, and is the worse failure.
         */
        const src = code(FORM);

        expect(src).toContain('for (const extra of extraDocuments)');
        expect(src).toContain('docUploads.push(uploadFile(extra, path))');
    });

    it('AND THEY GO INTO THE SAME documentUrls THE ACTION ALREADY TAKES', () => {
        /*
         *   Uploaded into `docUploads` before the single `Promise.all`, so they
         *   flow through the existing null-filter into `documentUrls`. Nothing
         *   downstream — the action, the admin queue, stripInternalLandFields —
         *   needs to know this happened.
         */
        const src = code(FORM);
        const uploadAt = src.indexOf('for (const extra of extraDocuments)');
        const awaitAt = src.indexOf('const uploadedDocs = await Promise.all(docUploads)');

        expect(uploadAt).toBeGreaterThan(-1);
        expect(awaitAt).toBeGreaterThan(uploadAt);
        expect(src).toContain('if (url) documentUrls.push(url)');
    });

    it('AND SHE CAN TAKE ONE BACK OFF', () => {
        //   A picker with no remove is a trap: one wrong file and she starts the
        //   form again. The images picker beside it already has one.
        const src = code(FORM);

        expect(src).toContain('removeExtraDocument');
        expect(src).toContain('aria-label={`Remove ${file.name}`}');
    });

    it('AND THE COUNT IS BOUNDED', () => {
        /*
         *   An unbounded `multiple` input is an unbounded upload bill, on a
         *   form any registered seller can open. Eight is the cap the image
         *   picker on this same page already uses, so the two behave alike.
         */
        const src = code(FORM);
        const at = src.indexOf('addExtraDocuments');

        expect(src.slice(at, at + 400)).toContain('.slice(0, 8)');
    });

    it('AND PICKING THE SAME FILE TWICE STILL REGISTERS', () => {
        /*
         *   A file input does not fire `change` when the selection is identical
         *   to last time, so removing a file and re-picking it silently does
         *   nothing until the value is cleared. Subtle, invisible, and exactly
         *   the kind of thing a seller would read as the form being broken.
         */
        const src = code(FORM);
        const at = src.indexOf('addExtraDocuments');

        expect(src.slice(at, at + 400)).toContain('e.target.value = ""');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#860 — and the three named documents are still asked for by name', () => {
    it('ALL THREE SLOTS SURVIVE', () => {
        const src = code(FORM);

        for (const label of ['Land Title Document', 'Survey Plan', 'Tax Clearance']) {
            expect({ label, present: src.includes(label) }).toEqual({ label, present: true });
        }
    });

    it('AND THE TWO THAT WERE REQUIRED STILL ARE', () => {
        /*
         *   The regression that would matter most: a seller could otherwise
         *   satisfy the form with eight photographs of a fence and no C of O,
         *   and the review queue is built on those two being present.
         */
        const src = code(FORM);

        for (const label of ['Land Title Document', 'Survey Plan']) {
            const at = src.indexOf(`label="${label}"`);
            expect({ label, found: at > -1 }).toEqual({ label, found: true });
            //   Measured: 495 and 441 characters from the label to its
            //   `required`, so the window is 700.
            expect({ label, required: src.slice(at, at + 700).includes('required') })
                .toEqual({ label, required: true });
        }
    });

    it('AND THE OPTIONAL ONE IS STILL OPTIONAL', () => {
        //   The other direction: making tax clearance required would block every
        //   seller who has not paid land tax this year.
        const src = code(FORM);
        const at = src.indexOf('label="Tax Clearance Certificate (Optional)"');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 300)).not.toContain('required');
    });
});
