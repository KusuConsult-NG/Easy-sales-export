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

import { DEFAULT_MAX_UPLOAD_MB, DEFAULT_MAX_VIDEO_UPLOAD_MB } from '@/lib/upload-limits';

/**
 * The numbers to hunt for, TAKEN FROM THE CONSTANTS rather than restated.
 *
 *   THIS LIST WAS FROZEN ONCE AND IT COST A SURVIVING MUTANT. It read
 *   `(50|100|200)` — the ceilings on the day it was written — and when the
 *   image cap moved to 10, a hardcoded `10 * 1024 * 1024` planted in a second
 *   file passed every assertion here. A ratchet that names the values it
 *   guards stops guarding them the moment they change, which is exactly when
 *   a stale copy is most likely to be left behind.
 *
 *   Derived, it cannot fall out of step: change either constant and the scan
 *   changes with it. 200 stays in the list because it is the value this file
 *   was created to hunt down, and a copy of it left anywhere is still wrong.
 */
const CEILINGS = [...new Set([DEFAULT_MAX_UPLOAD_MB, DEFAULT_MAX_VIDEO_UPLOAD_MB, 200])]
    .sort((a, b) => b - a)
    .join('|');

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

    /*
     *   AND THREE FILES THAT CHOOSE THE SAME NUMBER FOR THEIR OWN REASONS.
     *
     *   THE SCAN CANNOT TELL A COINCIDENCE FROM A COPY, and this is where that
     *   bites. A screen setting its own, narrower bound is legitimate — the
     *   `maxSize` prop MasterUploader documents, 5MB for an avatar — and while
     *   the platform ceiling was 50MB these three were plainly narrower than
     *   it. They collide only because the image ceiling moved to 10, which is
     *   a number a screen is likely to pick for itself.
     *
     *   Listed rather than the scan being weakened, because each was READ and
     *   is its own rule, not a restatement of the platform's:
     */

    //   A bound on what the image PROXY will fetch and relay onward. Not an
    //   upload ceiling at all — nothing is being stored.
    join('app', 'api', 'proxy-image', 'route.ts'),

    //   "Max 5 files, 10MB each" — the dispute form's own attachment rule,
    //   which also caps the COUNT, so it is plainly a rule of its own.
    join('dashboard', 'disputes', 'new', 'NewDisputeClient.tsx'),

    //   The loan wizard's own stated bound, in copy only; it computes nothing.
    join('components', 'LoanApplicationWizard.tsx'),
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
            .filter((f) => new RegExp(`\\b(${CEILINGS})\\s*\\*\\s*1024\\s*\\*\\s*1024\\b`).test(f.code))
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
            .filter((f) => new RegExp(`(?<![-\\w.])(${CEILINGS})MB\\b`, 'i').test(f.code))
            .map((f) => f.file.replace(process.cwd() + '/', ''));

        expect(offenders).toEqual([]);
    });

    it('and the owner really does define them, so the scan has something to protect', () => {
        const owner = files.find((f) => f.file.endsWith(OWNER))!;

        expect(owner.code).toMatch(/DEFAULT_MAX_UPLOAD_MB\s*=\s*\d+/);
        expect(owner.code).toMatch(/DEFAULT_MAX_VIDEO_UPLOAD_MB\s*=\s*\d+/);
    });
});
