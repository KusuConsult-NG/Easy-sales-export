/**
 * @jest-environment node
 */

/**
 *   #784 A MEMBER COULD SEND A DOCUMENT AND THEN NEVER SEE IT, CHANGE IT OR
 *        TAKE IT BACK.
 *
 *   The owner: "users should be able to upload docs and files and also should
 *   be able to remove them or edit them after publishing."
 *
 *   SWEPT, and most of the platform was already right — which is the useful
 *   half of the answer.
 *
 *       components/onboarding/DocumentUpload   `value` + a Remove button   OK
 *       marketplace product edit               removeImage(index)          OK
 *       components/shared/MasterUploader       NEITHER                     ✗
 *
 *   MasterUploader had no way to be TOLD about a document that was already
 *   attached. It initialises to `file: null, completed: false` and renders an
 *   empty dropzone, so a member reopening a saved or rejected cooperative
 *   application saw three empty boxes while the record held her ID, her
 *   passport photograph and her proof of address. She could not see what she
 *   had sent, could not check it was the right file, and could not take it
 *   back — the only move available was to upload something again.
 *
 *   That is #775's defect in the document dimension: a form that opens blank on
 *   a record that has values.
 *
 *   Its "Change" button looked like the answer and was not. It runs
 *   `setFile(null); setCompleted(false)` — LOCAL state only. The parent still
 *   holds the old URL, so a member who pressed Change and then thought better
 *   of it had changed nothing, and the screen said otherwise.
 *
 * ── DETACH, NEVER DESTROY ───────────────────────────────────────────────────
 *
 *   The owner's standing instruction is that nothing on Cloudinary is deleted.
 *   `onRemove` detaches the document from the RECORD; the asset stays exactly
 *   where it is. That is not a limitation dressed up as a feature — it is what
 *   makes a mistaken removal recoverable, and it is why this finding adds no
 *   `cloudinary.uploader.destroy` call anywhere.
 *
 *   /api/upload accordingly still exposes POST and nothing else.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the `existing` panel removed from MasterUploader            KILLED
 *     onRemove rendered unconditionally                           KILLED
 *     the cooperative step's existing= bindings dropped           KILLED
 *     a cloudinary destroy call introduced                        KILLED
 *     reword this header                               SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const UPLOADER = 'src/components/shared/MasterUploader.tsx';
const COOP_STEP = 'src/app/cooperatives/onboarding/steps/DocumentUploadStep.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#784 — a member can see the document they already sent', () => {
    it('THE UPLOADER CAN BE TOLD WHAT IS ALREADY ATTACHED', () => {
        //   THE test. It had no such prop, so every box opened empty.
        const src = stripComments(read(UPLOADER));

        expect(src).toMatch(/existing\?:\s*\{\s*name\?:\s*string;\s*url:\s*string\s*\}/);
        expect(src).toMatch(/existing\?\.url/);
    });

    it('AND SHOWS IT, WITH A LINK TO OPEN IT', () => {
        //   Seeing the filename is not enough to tell a passport photograph
        //   from a driving licence uploaded into the wrong box.
        const src = stripComments(read(UPLOADER));
        const panel = src.split('existing?.url && !file && !completed')[1] ?? '';

        expect(panel).toMatch(/href=\{existing\.url\}/);
        expect(panel).toMatch(/Replace/);
        expect(panel).toMatch(/Remove/);
    });

    it('AND THE EMPTY DROPZONE STANDS DOWN WHEN ONE IS ATTACHED', () => {
        /*
         *   Otherwise both render and the member sees an attached document AND
         *   an invitation to upload one, with no way to tell which the form
         *   will use.
         */
        const src = stripComments(read(UPLOADER));
        expect(src).toMatch(/!existing\?\.url && !file && !completed/);
    });

    it('REMOVE IS OFFERED ONLY WHERE IT WOULD ACTUALLY WORK', () => {
        /*
         *   Two conditions, both load-bearing.
         *
         *   `onRemove` — a screen that cannot handle a removal must not appear
         *   to offer one; a button that does nothing is the defect this audit
         *   keeps finding.
         *
         *   `!required` — a required document cannot be absent, and the server's
         *   resubmit path writes a document field only when a NEW url arrives,
         *   so a removal would not propagate. Offering it would promise
         *   something neither the form nor the server will do. Replace is the
         *   control that does the job, and it is offered on both.
         */
        const src = stripComments(read(UPLOADER));
        expect(src).toMatch(/\{onRemove && !required && \(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#784 — the screen that needed it is wired', () => {
    it('ALL THREE COOPERATIVE DOCUMENTS ARE SHOWN AND REMOVABLE', () => {
        /*
         *   Valid ID, passport photograph and proof of address. Two of three
         *   would be this audit's most repeated finding, so the count is
         *   asserted rather than a specimen.
         */
        const src = stripComments(read(COOP_STEP));

        expect((src.match(/existing=\{data\./g) ?? []).length).toBe(3);
        expect((src.match(/onRemove=\{\(\) => onChange\(/g) ?? []).length).toBe(3);

        for (const key of ['validId', 'passportPhoto', 'proofOfAddress']) {
            expect(src).toMatch(new RegExp(`existing=\\{data\\.${key}`));
            expect(src).toMatch(new RegExp(`${key}: undefined`));
        }
    });

    it('CONTROL: the screens that already worked are untouched', () => {
        /*
         *   Most of the platform was already right, and "fix everything"
         *   applied to a working path is churn that risks a regression.
         *   DocumentUpload has had `value` and a Remove button all along; the
         *   marketplace product editor has removeImage.
         */
        const doc = stripComments(read('src/components/onboarding/DocumentUpload.tsx'));
        expect(doc).toMatch(/value\?:\s*string/);
        expect(doc).toMatch(/function handleRemove/);

        const product = stripComments(read('src/app/marketplace/seller/products/[id]/edit/EditProductClient.tsx'));
        expect(product).toMatch(/const removeImage = \(index: number\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#784 — removing detaches, and never destroys', () => {
    it('#675 ALREADY GUARDS THIS, AND THIS IS THE CASE IT PREDICTED', () => {
        /*
         *   #675's header says, in as many words, that the gap it was closing
         *   "shows up the first time somebody implements 'remove this photo'
         *   the obvious way". This finding IS that implementation, and it took
         *   the other road: detach from the record, leave the asset.
         *
         *   Its rule is NOT restated here. A second copy of a sweep is a second
         *   thing to keep in step, and the existing one is stricter — it also
         *   covers delete_resources and api.delete. What is asserted is that it
         *   still exists and still runs, because deleting it would be the
         *   quiet way to make this finding's changes look safe.
         */
        const guard = read('src/__tests__/unit/nothing-destroys-an-uploaded-asset.test.ts');

        expect(guard).toMatch(/uploader\s*\\?\.\s*destroy/);
        expect(guard).toMatch(/delete_resources/);
    });

    it('AND THE UPLOAD ROUTE STILL EXPOSES NO DELETE', () => {
        //   The other way this could have been built, and the reason it was
        //   not. A DELETE endpoint is a destroy call waiting for a caller.
        const src = stripComments(read('src/app/api/upload/route.ts'));

        expect(src).toMatch(/export const POST/);
        expect(src).not.toMatch(/export const DELETE/);
    });

    it('and the uploader itself calls no network delete', () => {
        const src = stripComments(read(UPLOADER));
        expect(src).not.toMatch(/method:\s*["']DELETE["']/);
    });
});
