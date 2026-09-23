/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "I want to change from cloudinary to Imagekit. check if
 *   everything is wired properly."
 *
 *   Two of the things that were not.
 *
 * ── /api/upload PUT EVERY USER'S FILES IN ONE DIRECTORY ─────────────────────
 *
 *   The route builds, for Cloudinary and for the local disk:
 *
 *       publicId = `${safeFolderName}/${userId}/${safeDocType}-${timestamp}`
 *
 *   and the ImageKit branch passed `folder: safeFolderName` — no `userId`.
 *   uploadDocumentAction, the OTHER door onto the same store, got it right
 *   (`documents/${userId}`), so the two disagreed about where a file goes.
 *
 *   IT IS NOT ONLY UNTIDY. That branch also sets `useUniqueFileName: false`,
 *   which turns off ImageKit's own collision protection, and the timestamp is
 *   in SECONDS. Two DIFFERENT people uploading the same documentType in the
 *   same second therefore resolved to one name in one folder. The user
 *   segment is what made that impossible on the other two backends.
 *
 *   Within one user the deterministic name is deliberate and unchanged:
 *   Cloudinary signs a fixed public_id here too, so a re-upload of the same
 *   document replaces the old one on every backend alike.
 *
 * ── AND NOBODY COULD SAY WHICH IMAGEKIT ACCOUNT WAS OURS ────────────────────
 *
 *   lib/imagekit exports `getImageKitId()`, which reads IMAGEKIT_ID and falls
 *   back to deriving the account from the configured URL endpoint. Nothing
 *   called it. The three gates that decide whether an ImageKit URL belongs to
 *   this platform — proxy-image, certificates/upload, id-card/pdf — each wrote
 *   `process.env.IMAGEKIT_ID || "Easysales"` instead, so with IMAGEKIT_ID
 *   unset all three rejected every legitimate URL of any account not literally
 *   named Easysales, while the endpoint that names the real one sat unread.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const GATES = [
    'src/app/api/proxy-image/route.ts',
    'src/app/api/certificates/upload/route.ts',
    'src/app/api/id-card/pdf/route.ts',
] as const;

describe('the ImageKit account is named in ONE place', () => {
    it.each(GATES)('%s asks lib/imagekit rather than the environment', (rel) => {
        const code = read(rel);

        expect(code).toContain('getImageKitId()');
        //   The literal these three carried. One implementation cannot be four.
        expect(code).not.toContain('process.env.IMAGEKIT_ID');
        expect(code).not.toContain('"Easysales"');
    });

    it('AND THE ONE PLACE READS THE ENDPOINT THE DEPLOY ALREADY SETS', async () => {
        /*
         *   The behavioural half. NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT is passed
         *   as a build arg in the Dockerfile; IMAGEKIT_ID is not passed
         *   anywhere. So deriving the account from the endpoint is the
         *   difference between these gates working and rejecting everything.
         */
        const ORIGINAL = process.env;
        process.env = { ...ORIGINAL };
        delete process.env.IMAGEKIT_ID;
        process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/SomeOtherAccount';

        jest.resetModules();
        const { getImageKitId } = await import('@/lib/imagekit');
        expect(getImageKitId()).toBe('SomeOtherAccount');

        process.env = ORIGINAL;
    });
});

describe('/api/upload lays its files out the same way on every backend', () => {
    const ORIGINAL = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL };
    });

    afterEach(() => {
        process.env = ORIGINAL;
        jest.restoreAllMocks();
    });

    it('SENDS THE USER SEGMENT TO IMAGEKIT, as the other two backends store it', () => {
        /*
         *   Read from the source because reaching this branch through the
         *   handler means standing up a session, a rate limiter, a multipart
         *   body and a magic-byte detector that is pure ESM under a CJS jest —
         *   see upload-content-validation.test.ts's header for what that costs.
         *
         *   The property is a RELATIONSHIP between two lines in one file, which
         *   is exactly what source can state: whatever prefix the publicId is
         *   built from, the ImageKit folder is built from the same one.
         */
        const code = read('src/app/api/upload/route.ts');

        const publicId = code.match(/const publicId = `([^`]+)`/);
        const folder = code.match(/folder: `([^`]+)`/);

        expect(publicId).not.toBeNull();
        expect(folder).not.toBeNull();

        //   The publicId is <prefix>/<name>; the folder must BE that prefix.
        const prefix = publicId![1].slice(0, publicId![1].lastIndexOf('/'));
        expect(folder![1]).toBe(prefix);
        //   And it is not the bare folder, which is what it used to be.
        expect(folder![1]).toContain('${userId}');
    });

    it('and uploadDocumentAction, the other door, already agreed', () => {
        //   The copy that was right. It is asserted so that a future change
        //   which "fixes" the two to differ again fails here as well.
        const code = read('src/app/actions/upload.ts');

        const publicId = code.match(/const publicId = `([^`]+)`/);
        const folder = code.match(/folder: `([^`]+)`/);

        const prefix = publicId![1].slice(0, publicId![1].lastIndexOf('/'));
        expect(folder![1]).toBe(prefix);
        expect(folder![1]).toContain('${userId}');
    });
});
