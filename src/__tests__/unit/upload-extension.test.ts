/**
 * @jest-environment node
 */

/**
 * The upload route's own comment named the risk. Half of it was still open.
 *
 * /api/upload is the generic uploader behind MasterUploader and has six call
 * sites — more than any other route, which is why it is worth reading twice.
 * An earlier pass added a magic-byte check and explained exactly why:
 *
 *     It matters here specifically because a PDF is uploaded to Cloudinary as
 *     `raw`, and the stored public_id keeps the caller's extension. A file
 *     declared application/pdf and named .html is then served as HTML from the
 *     business's own Cloudinary account.
 *
 * The content check went in. The extension did not change:
 *
 *     const extension = extensionIdx !== -1 ? originalName.slice(extensionIdx) : "";
 *     const publicId = `${safeFolderName}/${userId}/${safeDocType}-${timestamp}${extension}`;
 *
 * safeDocType and safeFolderName are sanitised. `extension` went in raw.
 *
 * WHY THE MAGIC-BYTE CHECK DOES NOT CLOSE IT
 * ------------------------------------------
 * A PDF only needs "%PDF-" near the start of the file. One file can satisfy
 * that and still be a working HTML page, because a browser rendering it as HTML
 * ignores the leading bytes it does not understand and runs the script tag
 * further down. Content validation says "this is a PDF"; the extension decides
 * what a browser is told it is. Those are different questions and only the
 * first was being asked.
 *
 * It is served from res.cloudinary.com rather than the app's own origin, so
 * this is not same-origin script execution against the platform. It is the
 * business's Cloudinary account serving attacker-supplied HTML from a
 * trusted-looking URL, which is a phishing page with good provenance.
 *
 * A name like "doc.pdf/../x" also yields an "extension" containing slashes,
 * injecting path segments into the public_id that the folder sanitiser exists
 * to prevent.
 *
 * TWO CHECKS THAT NEVER COMPARED ANSWERS
 * --------------------------------------
 * The route tests `file.type` against its own list, then assertAllowedFileType
 * tests the CONTENT against storage-admin's, which is broader and also permits
 * Word documents. A .docx declared as application/pdf satisfied both — the
 * first because the claim was allowed, the second because the content was
 * allowed somewhere. The narrow list is applied to the detected type now.
 *
 * The Cloudinary resource type was picked from `file.type` as well, so a PNG
 * declared as a PDF was stored as a raw asset.
 */

import { describe, it, expect } from '@jest/globals';
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

const route = source('src/app/api/upload/route.ts');
const code = codeOnly(route);

describe('the stored extension comes from the content', () => {
    it('no longer slices it out of the uploaded filename', () => {
        // THE test. This was the one unsanitised component of public_id.
        expect(code).not.toContain('originalName.slice(extensionIdx)');
        expect(code).not.toContain('originalName.lastIndexOf(".")');
    });

    it('maps the detected type to a fixed extension', () => {
        expect(route).toContain('const extension = EXTENSION_FOR_TYPE[detectedType]');
        expect(route).toContain('"application/pdf": ".pdf"');
    });

    it('falls back to no extension rather than to the filename', () => {
        // An unmapped type must not reach for the caller's name again.
        expect(route).toContain('EXTENSION_FOR_TYPE[detectedType] ?? ""');
    });

    it('every accepted type has an extension', () => {
        // Otherwise an allowed upload silently loses its extension and a raw
        // asset is served as the wrong thing — the same class, arrived at from
        // the other side.
        const allowed = route.slice(route.indexOf('const ALLOWED_UPLOAD_TYPES'), route.indexOf('const EXTENSION_FOR_TYPE'));
        const mapped = route.slice(route.indexOf('const EXTENSION_FOR_TYPE'));

        for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']) {
            expect(allowed).toContain(`"${type}"`);
            expect(mapped.slice(0, 600)).toContain(`"${type}":`);
        }
    });
});

describe('the two type checks now agree', () => {
    it('applies this route\'s list to the detected type', () => {
        // The declared type was checked against the narrow list and the content
        // against a broader one, so a Word document declared as a PDF passed
        // both.
        expect(route).toContain('ALLOWED_UPLOAD_TYPES.includes(detectedType)');
    });

    it('picks the Cloudinary resource type from the content', () => {
        expect(route).toContain('detectedType === "application/pdf"');
        expect(code).not.toContain('file.type === "application/pdf"');
    });

    it('sends the blob with the detected type', () => {
        expect(route).toContain('new Blob([buffer], { type: detectedType })');
    });

    it('still rejects before touching Cloudinary', () => {
        // Ordering: the content check has to precede the upload, or the file is
        // already stored by the time it is judged.
        const detectAt = route.indexOf('ALLOWED_UPLOAD_TYPES.includes(detectedType)');
        const uploadAt = route.indexOf('api.cloudinary.com');

        expect(detectAt).toBeGreaterThan(-1);
        expect(uploadAt).toBeGreaterThan(detectAt);
    });
});

describe('what was already right', () => {
    it('requires a session and is rate-limited', () => {
        expect(route).toContain('await requireSession()');
        expect(route).toContain('withRateLimit(uploadHandler)');
    });

    it('scopes the stored path to the uploading user', () => {
        // So one user cannot address another's folder, whatever they send as
        // `folder`.
        expect(route).toContain('${safeFolderName}/${userId}/');
    });

    it('still sanitises the folder and document type', () => {
        // These were correct before and must stay so — the fix above removes
        // the extension from the equation, not the other two.
        expect(route).toContain('folder.split("/").map(part => part.replace(/[^a-zA-Z0-9-]/g, "-"))');
        expect(route).toContain('documentType.replace(/[^a-zA-Z0-9-]/g, "-")');
    });

    it('caps the file size', () => {
        expect(route).toContain('50 * 1024 * 1024');
    });
});
