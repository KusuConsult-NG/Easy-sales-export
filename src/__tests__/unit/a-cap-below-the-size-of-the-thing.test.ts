/**
 * @jest-environment node
 */

/**
 *   THE PLATFORM HAD DECIDED VIDEO GETS 200MB, AND THE DOOR MOST UPLOADS GO
 *   THROUGH HAD NEVER BEEN TOLD.
 *
 *   actions/resource-actions.ts:
 *
 *       // Validate file size (50MB for documents, 200MB for videos)
 *       const maxSize = category === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
 *
 *   api/upload/route.ts — which describes itself as "the generic one behind
 *   MasterUploader, and so the one most uploads actually use":
 *
 *       const maxSize = 50 * 1024 * 1024; // 50 MB
 *
 *   Two copies of one rule, disagreeing, with the wrong number in the live
 *   door. A 50MB cap on video is a cap below the size of the thing: a
 *   ten-minute lesson recording does not fit in it, and Academy lesson videos
 *   are exactly what MasterUploader is most used for. Worse, MasterUploader's
 *   own `maxSize = 50` default refused them IN THE BROWSER, so the upload was
 *   never attempted and the 200MB the platform meant to allow was unreachable
 *   from any screen.
 *
 * ── AND THE CEILING CANNOT BE CHOSEN FROM WHAT THE CLIENT CLAIMS ────────────
 *
 *   The size guard has to run BEFORE `file.arrayBuffer()` — that is #273, and
 *   the reason is that the buffer is the thing being refused. At that moment
 *   the only type available is `file.type`, the client's word for it.
 *
 *   So "video gets 200MB" handed anyone willing to type `video/mp4` a
 *   four-fold allowance for any file at all. The ceiling is therefore asked
 *   TWICE: once of the declared type, to avoid refusing a real video unread,
 *   and again of the DETECTED type before anything is stored. The declared
 *   type may buy the read and nothing else.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    DEFAULT_MAX_UPLOAD_MB,
    DEFAULT_MAX_VIDEO_UPLOAD_MB,
    defaultLimitMbFor,
    isVideoType,
} from '@/lib/upload-limits';

const MB = 1024 * 1024;

beforeEach(() => {
    delete process.env.MAX_UPLOAD_SIZE_MB;
    delete process.env.MAX_VIDEO_UPLOAD_SIZE_MB;
});

/** Re-imported per test: uploadSizeLimitBytes reads process.env when called. */
async function limitFor(type?: string): Promise<number> {
    const { uploadSizeLimitBytes } = await import('@/lib/storage-admin');
    return uploadSizeLimitBytes(type);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('video is allowed more than a document', () => {
    it('A VIDEO MAY BE 100MB — the defect', async () => {
        //   THE test. An ordinary lesson recording was refused at 50MB, and
        //   80MB is one; it is accepted, and it is well clear of the 50MB a
        //   document still gets.
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
        expect(80 * MB).toBeLessThan(await limitFor('video/mp4'));
        expect(await limitFor('application/pdf')).toBeLessThan(await limitFor('video/mp4'));
    });

    it('AND 120MB IS REFUSED HERE RATHER THAN BY CLOUDINARY', async () => {
        /*
         *   This assertion used to say the opposite, and it was right at the
         *   time: 120MB is an ordinary recording and a 50MB cap refused it.
         *
         *   What changed is not the appetite for large video, it is the
         *   discovery that the ceiling was above what the storage backend
         *   accepts. Cloudinary refuses a single upload over 100MB on this
         *   account's plan, so a 120MB file passed every check here, uploaded
         *   COMPLETELY, and died at the far end with "File size too large. Got
         *   125829120. Maximum is 104857600."
         *
         *   Refusing it here costs the person nothing. Refusing it there costs
         *   them the whole upload. That is the only difference, and it is the
         *   entire reason for the number.
         */
        expect(120 * MB).toBeGreaterThan(await limitFor('video/mp4'));
    });

    it('AND SO MAY THE OTHER TWO VIDEO TYPES THIS PLATFORM ACCEPTS', async () => {
        //   storage-admin's own EXTENSION_FOR_TYPE lists three. A rule written
        //   against "video/mp4" alone would leave .mov — what a phone records —
        //   on the old ceiling.
        expect(await limitFor('video/quicktime')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
        expect(await limitFor('video/webm')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
    });

    it('AND A DOCUMENT KEEPS THE ORDINARY CEILING, which is the part that must not move', async () => {
        /*
         *   THE INVARIANT IS THE SEPARATION, NOT THE NUMBER. This read
         *   `toBe(50 * MB)` and went red when the image and document ceiling
         *   moved to 10 — but nothing it protects had changed. What it exists
         *   to catch is video's allowance leaking onto everything else, so it
         *   asks for the ordinary constant and, below, that the two differ.
         */
        expect(await limitFor('application/pdf')).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
        expect(await limitFor('image/png')).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
        expect(await limitFor('image/png')).toBeLessThan(await limitFor('video/mp4'));
    });

    it('and a missing type gets the ordinary ceiling, not the generous one', async () => {
        //   Unknown is not video. Defaulting the other way would give every
        //   typeless upload 200MB.
        expect(await limitFor(undefined)).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
        expect(await limitFor('')).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
    });

    it('and "video" is asked of the MIME type, never of a filename', () => {
        //   An extension is a claim about nothing.
        expect(isVideoType('video/mp4')).toBe(true);
        expect(isVideoType('holiday.mp4')).toBe(false);
        expect(isVideoType('application/pdf')).toBe(false);
        expect(isVideoType(null)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the limit is configurable, per kind', () => {
    it('MAX_VIDEO_UPLOAD_SIZE_MB overrides the video ceiling', async () => {
        process.env.MAX_VIDEO_UPLOAD_SIZE_MB = '500';
        expect(await limitFor('video/mp4')).toBe(500 * MB);
    });

    it('AND IT DOES NOT MOVE THE DOCUMENT CEILING WITH IT', async () => {
        process.env.MAX_VIDEO_UPLOAD_SIZE_MB = '500';
        expect(await limitFor('application/pdf')).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
    });

    it('MAX_UPLOAD_SIZE_MB still overrides the ordinary one', async () => {
        process.env.MAX_UPLOAD_SIZE_MB = '5';
        expect(await limitFor('application/pdf')).toBe(5 * MB);
    });

    it('and it does not silently cap video', async () => {
        //   Two knobs, two answers. A deployment tightening documents to 5MB
        //   has not said anything about video.
        process.env.MAX_UPLOAD_SIZE_MB = '5';
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
    });

    it('AN UNREADABLE OVERRIDE FALLS BACK rather than disarming the ceiling', async () => {
        //   #350's lesson. parseInt("abc") is NaN, and a NaN ceiling compares
        //   false against every size — a limit that refuses nothing.
        process.env.MAX_VIDEO_UPLOAD_SIZE_MB = 'abc';
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);

        process.env.MAX_VIDEO_UPLOAD_SIZE_MB = '0';
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);

        process.env.MAX_VIDEO_UPLOAD_SIZE_MB = '-1';
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the declared type buys the read and nothing more', () => {
    const read = (rel: string) => stripComments(
        readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

    it('BOTH DOORS RE-CHECK THE SIZE AGAINST THE DETECTED TYPE', () => {
        //   Without this, `video/mp4` in a form field is a 200MB allowance for
        //   anything: a 150MB PDF passes the pre-read guard, fails no later
        //   check that cares about size, and is stored.
        //
        //   Pinned on the CODE because the hole is an ABSENT second check —
        //   there is no value to assert, only a call that has to exist after
        //   detection.
        for (const file of ['src/lib/storage-admin.ts', 'src/app/api/upload/route.ts']) {
            const src = read(file);
            const detected = src.search(/detectedMime|detectedType/);
            const recheck = src.lastIndexOf('uploadSizeLimitBytes(');

            expect(detected).toBeGreaterThan(-1);
            expect(recheck).toBeGreaterThan(detected);
        }
    });

    it('AND THE FIRST CHECK STILL RUNS BEFORE THE BUFFER IS ALLOCATED', () => {
        //   #273, unchanged and easy to undo: moving the size guard after
        //   arrayBuffer() would allocate the very thing it refuses.
        const src = read('src/lib/storage-admin.ts');

        expect(src.indexOf('uploadSizeLimitBytes(')).toBeLessThan(src.indexOf('await file.arrayBuffer()'));
    });

    it('and the route no longer states the number itself', () => {
        //   It held a fourth copy, and it was the copy that was wrong.
        const src = read('src/app/api/upload/route.ts');

        expect(src).not.toContain('50 * 1024 * 1024');
        expect(src).toContain('uploadSizeLimitBytes(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the browser agrees with the server about what it will take', () => {
    it('THE SHARED DEFAULTS ARE ONE PAIR OF NUMBERS', () => {
        //   MasterUploader cannot import storage-admin — it pulls in the logger
        //   and the file-type sniffer, which are server code — so the numbers
        //   live in a client-safe module and BOTH sides read them.
        //   PINNED TO CLOUDINARY'S image AND raw CEILING, like the video one
        //   below. storage-admin sends a PDF or Word file to `raw` and
        //   everything else to `image`, and on the plan where video is 100MB
        //   both of those are 10MB. 50 here let a 20MB product photo or a
        //   scanned title deed upload in full and be refused at the far end.
        expect(DEFAULT_MAX_UPLOAD_MB).toBe(10);
        //   PINNED TO CLOUDINARY'S OWN CEILING, not to a preference. 200
        //   here let a 150MB video upload completely and be refused by the
        //   storage backend at the far end — the person waits out the whole
        //   upload and loses it. Raise this only with the storage plan, and
        //   check the plan's figure first.
        expect(DEFAULT_MAX_VIDEO_UPLOAD_MB).toBe(100);
        expect(defaultLimitMbFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB);
        expect(defaultLimitMbFor('application/pdf')).toBe(DEFAULT_MAX_UPLOAD_MB);
    });

    it('AND THE SERVER CEILING IS THE SHARED DEFAULT, in bytes', async () => {
        //   The two could drift into disagreeing, which is the whole defect
        //   this file is about, one layer up.
        expect(await limitFor('video/mp4')).toBe(DEFAULT_MAX_VIDEO_UPLOAD_MB * MB);
        expect(await limitFor('application/pdf')).toBe(DEFAULT_MAX_UPLOAD_MB * MB);
    });

    it('THE UPLOADER NO LONGER PINS 50MB AS ITS DEFAULT — the browser-side defect', () => {
        //   `maxSize = 50` refused the file before any request was made, so the
        //   server's 200MB was unreachable from the screen that needed it.
        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/components/shared/MasterUploader.tsx'), 'utf8'),
            { label: 'MasterUploader.tsx' });

        expect(src).not.toMatch(/maxSize\s*=\s*50\b/);
        expect(src).toContain('defaultLimitMbFor(');
    });

    it('POSITIVE CONTROL: a caller that sets its own limit still keeps it', () => {
        //   Twelve call sites pass maxSize={5} for identity documents. A change
        //   that overrode them would quietly raise those to 50 or 200.
        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/components/shared/MasterUploader.tsx'), 'utf8'),
            { label: 'MasterUploader.tsx' });

        expect(src).toContain('maxSize ??');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to lib/upload-limits.ts, lib/storage-admin.ts,
 *   api/upload/route.ts and MasterUploader.tsx, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   video ceiling back to 50 — the defect       4   "A VIDEO MAY BE 100MB"
 *
 *   every type gets the video ceiling           2   "AND A DOCUMENT IS STILL
 *                                                   50MB"
 *
 *   isVideoType matches the filename instead    1   "and 'video' is asked of
 *   of the MIME type                                the MIME type"
 *
 *   the detected-type re-check is removed       1   "BOTH DOORS RE-CHECK THE
 *                                                   SIZE AGAINST THE DETECTED
 *                                                   TYPE"
 *
 *   the size guard moves after arrayBuffer()    1   "AND THE FIRST CHECK STILL
 *                                                   RUNS BEFORE THE BUFFER"
 *
 *   MAX_VIDEO_UPLOAD_SIZE_MB read with the      1   "AN UNREADABLE OVERRIDE
 *   old `|| fallback` (0 and NaN pass through)      FALLS BACK"
 *
 *   MasterUploader keeps `maxSize = 50`         1   "THE UPLOADER NO LONGER
 *                                                   PINS 50MB"
 *
 *   MasterUploader ignores the caller's         1   "POSITIVE CONTROL: a caller
 *   maxSize entirely                                that sets its own limit"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the header comment above             0   SURVIVED ✓
 *   uploadSizeLimitBytes
 */
