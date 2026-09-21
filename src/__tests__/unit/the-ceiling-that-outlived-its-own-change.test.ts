/**
 * @jest-environment node
 */

/**
 *   ONE UPLOAD CEILING, IN ONE FILE — AND THE MUTANT THAT PROVED THERE WASN'T.
 *
 *   THE OWNER: "make the video size 100mb instead of 200mb. file upload for
 *   products on marketplace etc was failing."
 *
 *   lib/upload-limits exists because the ceiling was stated in two places and
 *   they disagreed: actions/resource-actions.ts allowed video 200MB while
 *   api/upload — the door most uploads actually use — refused anything over
 *   50MB. That file's header says it was created to make the number single.
 *
 *   IT DID NOT FINISH THE JOB. Lowering the shared constant to 100 left TWO
 *   live sites still saying 200:
 *
 *       actions/resource-actions.ts   `category === "video" ? 200 * 1024 * 1024
 *                                      : 50 * 1024 * 1024`  — the ORIGINAL of
 *                                      the rule, never migrated
 *       marketplace/products/add      "MP4, MOV (max 200MB)" in the copy a
 *                                      seller reads, beside a handler that
 *                                      checks nothing at all
 *
 *   Both were caught by grep, not by a test: restoring the hardcoded pair after
 *   the fix passed all 41 tests covering upload limits. The instance was fixed
 *   and the class was left open, which is how this rule has now drifted three
 *   times.
 *
 *   SO THIS ASSERTS THE STRUCTURE. A megabyte figure written into any file but
 *   lib/upload-limits fails here — in the commit that adds it, rather than the
 *   next time somebody changes the ceiling and half the platform keeps the old
 *   one. It is storage-backend-single-rule's sibling, for the number rather
 *   than the destination.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');
const OWNER = join('lib', 'upload-limits.ts');

/**
 * Files that may legitimately state a size, and why.
 *
 *   Kept short on purpose: every entry is a place the ceiling can drift, and
 *   an allow-list that grows without reasons is the duplication it was meant
 *   to prevent wearing a different hat.
 */
const ALLOWED = [
    //   The owner of the numbers.
    OWNER,
    //   Callers that pass their OWN smaller bound for their own screen — the
    //   `maxSize` prop MasterUploader documents. Those are deliberately not
    //   the platform ceiling, and 5MB for an avatar is not a copy of 100MB.
] as const;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * The file with its prose removed.
 *
 *   PROSE IS NOT CODE, and this suite would be useless without the
 *   distinction: upload-limits, storage-admin, api/upload and
 *   resource-actions all QUOTE the old `200 * 1024 * 1024` in their headers to
 *   explain what was wrong with it. A scan that counted those would fire on
 *   every file that documents the history and force the explanations out —
 *   which is the opposite of what this repository wants.
 */
function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('the upload ceiling has exactly one definition', () => {
    const files = walk(SRC).map((f) => ({ file: f, code: codeOf(f) }));

    it('found the source tree (sanity)', () => {
        //   Without this a bad path empties every check below and the suite
        //   passes by scanning nothing.
        expect(files.length).toBeGreaterThan(100);
        expect(files.some((f) => f.file.endsWith(OWNER))).toBe(true);
    });

    it('NO FILE BUT lib/upload-limits COMPUTES A PLATFORM CEILING IN BYTES', () => {
        /*
         *   `N * 1024 * 1024` where N is one of the platform's own numbers.
         *   A screen's own smaller bound (5, 2) is not what this is about and
         *   is not matched.
         */
        const offenders = files
            .filter((f) => !ALLOWED.some((a) => f.file.endsWith(a)))
            .filter((f) => /\b(50|100|200)\s*\*\s*1024\s*\*\s*1024\b/.test(f.code))
            .map((f) => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('AND NO SCREEN WRITES THE CEILING INTO ITS OWN COPY', () => {
        /*
         *   The seller-facing "max 200MB" on the add-product page outlived the
         *   server's 200MB by one commit, and a seller reading it would have
         *   been told a number no door would honour. Copy must interpolate the
         *   constant.
         */
        /*
         *   THE UNIT MUST TOUCH THE NUMBER. An earlier version allowed
         *   whitespace between them and reported nineteen dashboards, because
         *   Tailwind writes `text-green-100 mb-1` and "100 mb" matched. A
         *   ratchet that fires on every screen in the platform is one somebody
         *   deletes, so it asks for "200MB" as a person would write it and the
         *   leading boundary rejects `-100` and `4100`.
         */
        const offenders = files
            .filter((f) => !ALLOWED.some((a) => f.file.endsWith(a)))
            .filter((f) => /(?<![-\w.])(50|100|200)MB\b/i.test(f.code))
            .map((f) => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('and the owner really does define them, so the scan has something to protect', () => {
        const owner = files.find((f) => f.file.endsWith(OWNER))!;

        expect(owner.code).toMatch(/DEFAULT_MAX_UPLOAD_MB\s*=\s*\d+/);
        expect(owner.code).toMatch(/DEFAULT_MAX_VIDEO_UPLOAD_MB\s*=\s*\d+/);
    });
});
