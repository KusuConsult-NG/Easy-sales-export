/**
 * @jest-environment node
 */

/**
 *   #791 A BROKEN THUMBNAIL PRINTED THE ITEM'S TITLE ACROSS THE BADGES ON TOP
 *        OF IT.
 *
 *   Reported by the owner with a screenshot of /admin/academy: three course
 *   cards, each title colliding with its tier and level pills — "Advanced
 *   Agro-Export Market Analysis" with "Elite" and "Advanced" sitting on the
 *   words.
 *
 *   THE TEXT UNDERNEATH WAS NOT A HEADING. It was the ALT TEXT of a broken
 *   image. The card renders
 *
 *       <div className="h-40 relative">
 *         <Image src={course.thumbnail} alt={course.title} fill />
 *         <div className="absolute top-4 right-4"> tier, level </div>
 *       </div>
 *
 *   and a browser paints `alt` INSIDE the failed image's box — the same box the
 *   badges are absolutely positioned in. The give-away in the screenshot is
 *   that the title appears TWICE per card: once as the broken image's alt, once
 *   in the body below where it belongs.
 *
 *   The EMPTY thumbnail case was already handled, with a BookOpen icon. It is
 *   the PRESENT-BUT-BROKEN case that had nothing: a truthy URL passes the
 *   `course.thumbnail ? … : …` guard and only fails later, in the browser.
 *
 * ── THE SWEEP, AND WHAT IT FOUND ────────────────────────────────────────────
 *
 *   Fourteen card images across the platform sit inside a `relative` box that
 *   also holds an absolutely-positioned overlay — the same collision shape.
 *   FOUR already had a hand-rolled `onError` that hides the broken image; TEN
 *   had nothing. That spread is this audit's most repeated finding: a correct
 *   rule applied to some of the places it names.
 *
 *   Six of the ten load REMOTE thumbnails with a long title as their alt, which
 *   is the class the owner photographed. The other four are image-picker
 *   previews sitting under a remove button.
 *
 *   ALL TEN ARE CONVERTED, and the reasoning changed while this was written. The
 *   first plan was to leave the four previews alone under #784's rule — do not
 *   churn a working path — on the grounds that an object URL for a file the
 *   browser already holds cannot 404. Then the sweep flagged them and the
 *   exemption had to be written down as an allow-list, which is where it fell
 *   apart: TWO of the four are not object URLs at all. The seller's edit screen
 *   and the sell/create screen map over `images` — saved, REMOTE product URLs —
 *   so they break exactly like the cards. An allow-list would have been a
 *   written-down mistake. Converting all four costs nothing (a fallback that
 *   never fires is never seen) and leaves the sweep absolute, with no exceptions
 *   to keep in step.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the onError removed from ThumbnailImage                      KILLED
 *     the failed-state branch removed                              KILLED
 *     the whitespace-only src check removed                        KILLED
 *     alt dropped from the component (a11y traded for layout)      KILLED
 *     the academy card reverted to a bare <Image>                  KILLED
 *     one farm-nation card reverted to a bare <Image>              KILLED
 *     the seller edit preview reverted to a bare <Image>           KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const COMPONENT = 'src/components/ui/ThumbnailImage.tsx';

/** The six remote-thumbnail cards the owner's screenshot class covers. */
const CONVERTED = [
    'src/app/admin/academy/page.tsx',
    'src/app/farm-nation/(member)/my-properties/page.tsx',
    'src/app/farm-nation/FarmNationLandingClient.tsx',
    'src/app/farm-nation/properties/PropertiesClient.tsx',
    'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx',
    'src/app/marketplace/products/[id]/ProductDetailClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#791 — a failed image shows a placeholder, not its alt text', () => {
    it('IT HANDLES THE onError AT ALL — which is the whole defect', () => {
        //   THE test. Without this the browser keeps the broken <img> in the
        //   layout and paints `alt` inside it, underneath the badges.
        const src = stripComments(read(COMPONENT));

        expect(src).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
        expect(src).toMatch(/if \(!usable \|\| failed\)/);
    });

    it('AND A WHITESPACE-ONLY URL COUNTS AS NO IMAGE', () => {
        /*
         *   "  " is truthy. It passes the `thumbnail ? …` guard every one of
         *   these cards used, reaches next/image, and becomes a request that
         *   cannot succeed — one of the ways a card ends up showing its own
         *   title.
         */
        const src = stripComments(read(COMPONENT));
        expect(src).toMatch(/typeof src === "string" && src\.trim\(\)\.length > 0/);
    });

    it('AND alt IS KEPT, because the fix is not to break the screen reader', () => {
        /*
         *   Deleting `alt` would also stop the collision, and would be the wrong
         *   fix: it is what a screen reader announces when the image DOES load.
         *   What changes is that a FAILED image is replaced, so there is no alt
         *   text left to paint.
         */
        const src = stripComments(read(COMPONENT));
        expect(src).toMatch(/alt=\{alt\}/);
        expect(src).toMatch(/alt: string;/);
    });

    it('and the placeholder is hidden from assistive tech, being decorative', () => {
        const src = stripComments(read(COMPONENT));
        expect(src).toMatch(/aria-hidden="true"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#791 — the cards that had the defect use it', () => {
    it('THE SCREEN IN THE OWNER\'S SCREENSHOT IS ONE OF THEM', () => {
        const src = stripComments(read('src/app/admin/academy/page.tsx'));

        expect(src).toMatch(/<ThumbnailImage/);
        //   and the bare <Image> that printed the title is gone
        expect(src).not.toMatch(/<Image src=\{course\.thumbnail\}/);
    });

    it('AND SO ARE THE OTHER FIVE', () => {
        for (const p of CONVERTED) {
            const src = stripComments(read(p));
            expect({ p, uses: /<ThumbnailImage/.test(src) }).toEqual({ p, uses: true });
        }
        expect(CONVERTED.length).toBe(6);
    });

    it('EVERY CARD IMAGE UNDER AN OVERLAY IS PROTECTED — swept, not sampled', () => {
        /*
         *   The property, not a specimen. A fifteenth card added tomorrow with a
         *   bare <Image> under a badge is the same defect, and testing the six
         *   that were fixed cannot see it.
         *
         *   PROTECTED means either the shared component or a site's own onError.
         *   Four sites already carried a hand-rolled onError and are left as
         *   they are — #784's rule, do not churn a working path — but they are
         *   covered here, so one of them losing its guard fails.
         */
        const files = execSync(
            "grep -rl 'alt={' src/app src/components --include=*.tsx",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean);

        const unprotected: string[] = [];
        for (const f of files) {
            /*
             *   COMMENTS STRIPPED FIRST, and the first draft of this sweep did
             *   not do that — so it reported ThumbnailImage.tsx itself, whose
             *   header quotes the broken markup in order to EXPLAIN it. That is
             *   the #741 shape for the eighth time in this audit, and this time
             *   it was the finding's own sweep that fell for it.
             */
            const lines = stripComments(read(f)).split('\n');
            lines.forEach((line, i) => {
                if (!/alt=\{/.test(line)) return;
                const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
                const above = lines.slice(Math.max(0, i - 8), i).join('\n');
                const below = lines.slice(i, i + 25).join('\n');

                const isFill = /\bfill\b/.test(near);
                const inRelativeBox = /className="[^"]*relative[^"]*"/.test(above);
                const hasOverlay = /className="absolute/.test(below);
                if (!(isFill && inRelativeBox && hasOverlay)) return;

                const guarded = /onError=/.test(lines.slice(Math.max(0, i - 8), i + 8).join('\n'))
                    || /<ThumbnailImage/.test(lines.slice(Math.max(0, i - 8), i + 2).join('\n'));
                if (!guarded) unprotected.push(`${f}:${i + 1}`);
            });
        }

        expect(unprotected).toEqual([]);
    });

    it('VACUITY GUARD: the platform really does have this many of them', () => {
        /*
         *   An empty "unprotected" list means nothing if the detector matches
         *   nothing. Fourteen sites had this shape when the finding was written.
         *
         *   COUNTED AS PROTECTED SITES, not by re-running the raw detector:
         *   converting a card REMOVES the `fill` attribute from the JSX — the
         *   component supplies it — so the raw shape count drops as the fix
         *   lands, and a threshold on it would fall as the work succeeded. What
         *   must not fall is the number of card images that are guarded.
         */
        const files = execSync(
            "grep -rl 'alt={' src/app src/components --include=*.tsx",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean);

        let protectedSites = 0;
        for (const f of files) {
            const src = stripComments(read(f));
            protectedSites += (src.match(/<ThumbnailImage/g) ?? []).length;
            protectedSites += (src.match(/onError=/g) ?? []).length;
        }
        expect(protectedSites).toBeGreaterThanOrEqual(14);
    });
});
