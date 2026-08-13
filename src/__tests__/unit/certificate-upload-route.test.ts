/**
 * @jest-environment node
 */

/**
 * #144 fixed the certificate path nothing calls. This is the one the dashboard
 * posts to.
 *
 * TWO PARALLEL SURFACES
 * ---------------------
 * User certificates exist twice, in two collections:
 *
 *   src/app/actions/certificates.ts     COLLECTIONS.CERTIFICATES
 *   src/app/api/certificates/*          COLLECTIONS.USER_CERTIFICATES
 *
 * /dashboard/certificates posts to /api/certificates/upload and lists from
 * /api/certificates. The three actions — uploadCertificateAction,
 * getUserCertificatesAction, deleteCertificateAction — have NO callers at all;
 * every apparent reference is a comment written during #144 or a scanner note.
 *
 * So the content-type fix in #144 landed on the path the product does not use,
 * and this route kept the defect it corrected. That does not make #144 wrong:
 * those actions are still reachable endpoints, and the academy half of that
 * change — the public verify endpoint vouching for any row, and the dashboard
 * counting uploads as credentials — is live and was the substance of it. But
 * the user-facing upload was never covered, and this file says so plainly so
 * nobody reads #144 as having secured the feature.
 *
 * WHAT WAS WRONG HERE
 * -------------------
 * The type was decided by `file.type`, a string the client sends.
 * uploadFileToStorage does sniff magic bytes, but against a BROADER list that
 * also permits video and Word documents — so an MP4 declared as
 * application/pdf satisfied this check, then satisfied that one, and was stored
 * with `fileType: "application/pdf"` recorded against it.
 *
 * THE URL BRANCH
 * --------------
 * The route also accepts JSON carrying a fileUrl instead of a file, and
 * validated it by hostname:
 *
 *     const allowedHostnames = ["res.cloudinary.com"];
 *
 * res.cloudinary.com is Cloudinary's SHARED delivery domain — every customer
 * serves from it, under /<cloud_name>/. Allowing the hostname allowed any file
 * hosted by anyone on Cloudinary, so the check read as a restriction and was
 * close to none. The cloud name is pinned now, and the declared type has to be
 * one this endpoint accepts rather than arbitrary text stored as fact.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * The other three routes are correctly guarded and needed nothing:
 * /api/certificates/download and /api/certificates/[id] both compare
 * `certData.userId` to the session before serving or deleting, with an admin
 * exception, and /api/certificates lists by the session's own id.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const upload = source('src/app/api/certificates/upload/route.ts');

describe('the uploaded file is what it says it is', () => {
    it('decides the type from the content, not the request', () => {
        // THE test, and the same one #144 applied to the action nobody calls.
        expect(upload).toContain('detectFileType(buffer, file.name)');
        expect(codeOnly(upload)).not.toContain('allowedTypes.includes(file.type)');
    });

    it('records the detected type', () => {
        // A PNG honestly uploaded but declared a PDF is still a PNG.
        expect(upload).toContain('fileType = detectedType');
        expect(codeOnly(upload)).not.toContain('fileType = file.type');
    });

    it('fails closed when the type cannot be detected', () => {
        expect(upload).toContain('if (!detectedType ||');
    });

    it('drops image/jpg, which is not a MIME type', () => {
        // It only ever made the list look more permissive than the check.
        expect(upload).toContain('const ALLOWED_CERTIFICATE_TYPES = ["application/pdf", "image/jpeg", "image/png"]');
    });
});

describe('the URL branch names this account, not just Cloudinary', () => {
    it('pins the cloud name as well as the host', () => {
        // res.cloudinary.com is shared across every Cloudinary customer.
        expect(upload).toContain('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
        expect(upload).toContain('firstSegment !== cloudName');
    });

    it('still requires the Cloudinary host', () => {
        // Vacuity guard: checking only the path segment would accept
        // evil.example/<cloudname>/...
        expect(upload).toContain('hostname === "res.cloudinary.com"');
    });

    it('refuses when the cloud name is not configured', () => {
        // Fails closed rather than treating an unset variable as a match for
        // whatever the first path segment happens to be.
        expect(upload).toContain('if (!cloudName)');
    });

    it('constrains the declared type on that branch too', () => {
        // There is no file to sniff, so the declared type is all there is — but
        // it can be one of the accepted types rather than arbitrary text.
        const jsonBranch = upload.slice(upload.indexOf('contentType.includes("application/json")'));

        expect(jsonBranch.slice(0, 3000)).toContain('ALLOWED_CERTIFICATE_TYPES.includes(fileType)');
    });
});

describe('which certificate path the product actually uses', () => {
    it('the dashboard posts to the route, not the action', () => {
        expect(source('src/app/dashboard/certificates/page.tsx'))
            .toContain('fetch("/api/certificates/upload"');
    });

    it('the actions have no callers', () => {
        // Recorded because it is the reason #144 did not cover this. Every
        // apparent reference is a comment from that change or a scanner note.
        for (const fn of ['uploadCertificateAction', 'getUserCertificatesAction', 'deleteCertificateAction']) {
            const refs = execSync(`grep -rn "${fn}" src || true`, { encoding: 'utf-8', cwd: process.cwd() })
                .split('\n')
                .filter((l) => l.trim())
                .filter((l) => !l.includes('__tests__') && !l.includes('actions/certificates.ts'))
                .filter((l) => {
                    const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                    return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
                });

            expect(refs).toEqual([]);
        }
    });

    it('the two surfaces really are different collections', () => {
        // If they ever converge, the discriminator work in #144 starts applying
        // here and this file should be revisited.
        expect(source('src/app/actions/certificates.ts')).toContain('COLLECTIONS.CERTIFICATES');
        expect(upload).toContain('COLLECTIONS.USER_CERTIFICATES');
    });
});

describe('the routes that were already right', () => {
    it('download checks ownership before redirecting to the file', () => {
        const download = source('src/app/api/certificates/download/route.ts');
        const checkAt = download.indexOf('certData.userId !== session.user.id');
        const redirectAt = download.indexOf('NextResponse.redirect');

        expect(checkAt).toBeGreaterThan(-1);
        expect(redirectAt).toBeGreaterThan(checkAt);
    });

    it('delete checks ownership before removing anything', () => {
        const byId = source('src/app/api/certificates/[id]/route.ts');
        const checkAt = byId.indexOf('certData.userId !== session.user.id');
        const deleteAt = byId.indexOf('.doc(id).delete()');

        expect(checkAt).toBeGreaterThan(-1);
        expect(deleteAt).toBeGreaterThan(checkAt);
    });

    it('the list is scoped to the session', () => {
        expect(source('src/app/api/certificates/route.ts')).toContain('session.user.id');
    });
});
