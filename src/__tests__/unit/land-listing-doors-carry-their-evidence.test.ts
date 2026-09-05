/**
 * @jest-environment node
 */

/**
 *   #432 THREE WRITERS OF LAND LISTINGS, AND BOTH DOORS NO SCREEN USES BYPASSED
 *   THE EVIDENCE.
 *
 *   Found by the sweep I should have run before committing #431 rather than
 *   after it. #431 fixed a route that demanded three KYC documents and stored
 *   `placeholder_<filename>` for each. The obvious next question — is there
 *   another one? — took one grep, and there was, in the module that sells land.
 *   That is this finding's own lesson repeating: the fix reaches one of the
 *   copies (#425, #426, #429, #430, #431).
 *
 *   THE THREE DOORS
 *
 *     submitLandListingAction          THE LIVE ONE, and it is correct.
 *     (actions/land-listings.ts)       /farm-nation/list-land uploads every
 *                                      image and document to storage itself and
 *                                      passes the URLs; this stores them and
 *                                      writes `pending_verification`.
 *
 *     POST /api/farm-nation/           RECEIVED the files and dropped them. It
 *     create-listing                   refuses a submission without a land title
 *                                      and survey plan:
 *
 *                                          if (!documents.landTitle ||
 *                                              !documents.surveyPlan) -> 400
 *
 *                                      then wrote `placeholder_${file.name}` for
 *                                      eight images, the video and all three
 *                                      documents. Nothing was uploaded — the
 *                                      comment above it said so: "placeholder
 *                                      for cloud storage upload". The listing
 *                                      went to `pending_verification`, and
 *                                      /admin/farm-nation/land-verification
 *                                      renders those values as links. So the
 *                                      admin approving a LAND SALE was shown
 *                                      `placeholder_title.pdf` pointing at
 *                                      nothing. #431's shape, on title deeds.
 *
 *     listPropertyAction               TOOK NO FILES AT ALL, and wrote:
 *     (actions/farm-nation/
 *      _fn_listings.ts)                    status: "available"
 *                                          verified: false
 *                                          documents: {}
 *                                          images: []   // "uploaded separately"
 *
 *                                      isPurchasable("available") is TRUE and
 *                                      the Farm Nation card renders "Verified
 *                                      Land" for any purchasable status — while
 *                                      the row itself recorded verified:false.
 *                                      And `available` is not what the review
 *                                      queue reads (`pending_verification` is),
 *                                      so no admin would ever have seen it. A
 *                                      listing on sale, labelled verified, with
 *                                      no title deed and no route to review.
 *
 *   REACHABILITY, STATED PRECISELY. No screen calls either. That is not the same
 *   as unreachable: an API route answers on its URL, and listPropertyAction is
 *   exported through the module's "use server" barrel, which makes it an
 *   independently addressable endpoint — the property that made
 *   autoEnrollPaidUser a paid-content bypass. Neither is harmlessly dead.
 *
 *   RETIRED RATHER THAN COMPLETED. Both are kept and refuse by default. Giving
 *   either its own upload path would put a second copy of the rule beside the
 *   form's, which is the root defect this whole audit keeps finding. One door.
 *
 *   AND THEIR LATENT DEFECTS ARE FIXED ANYWAY, because a retirement is one
 *   environment variable from being live: the API route uploads and refuses a
 *   listing whose files it cannot store, and the action writes the status the
 *   review queue reads instead of putting unverified land on sale.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the route stores placeholders again        KILLED
 *     the route stops refusing                   KILLED
 *     a failed upload is recorded as a listing   KILLED
 *     the action goes back to "available"        KILLED
 *     the action stops refusing                  KILLED
 *     the flag is read at module load            KILLED
 *     reword the header prose                    SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isPurchasable } from '@/lib/land-listing-status';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });


/**
 * Every name a Next App Router route.ts exports.
 *
 * Next allows ONLY the HTTP method handlers and a fixed set of config keys; any
 * other export fails the type it generates for the route, and `npx tsc
 * --noEmit` cannot see that because the constraint lives in the .next/types
 * tree a build produces. Asserting the allowed SET rather than blacklisting one
 * name is what makes this catch the next one too.
 */
const NEXT_ROUTE_EXPORTS = new Set([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
    'preferredRegion', 'maxDuration', 'generateStaticParams',
]);

function exportedNames(rel: string): string[] {
    return [...code(rel).matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/g)]
        .map((m) => m[1]);
}

const ROUTE = 'src/app/api/farm-nation/create-listing/route.ts';
const ACTION = 'src/app/actions/farm-nation/_fn_listings.ts';
const LIVE = 'src/app/actions/land-listings.ts';
const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#432 — the live door stores what it was given', () => {
    it('THE FORM UPLOADS, AND THE ACTION STORES WHAT IT UPLOADED', () => {
        /**
         * The premise the retirements rest on: there IS a complete path. If this
         * ever stops being true, retiring the other two leaves no way to list
         * land at all, and that must fail here rather than in production.
         */
        const form = code(FORM);
        expect(form).toMatch(/uploadFile\(image, path\)/);
        expect(form).toMatch(/uploadFile\(documents\.landTitle, path\)/);
        expect(form).toMatch(/submitLandListingAction\(/);

        const live = code(LIVE);
        expect(live).toMatch(/images: data\.imageUrls/);
        expect(live).toMatch(/documents: data\.documentUrls/);
        expect(live).toMatch(/status: "pending_verification"/);
    });

    it('and pending_verification really is what the review queue reads', () => {
        // The reason both retired doors are corrected to it rather than to
        // "available".
        expect(isPurchasable('pending_verification')).toBe(false);
        expect(isPurchasable('available')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#432 — the API route no longer records a deed it did not store', () => {
    it('THE PLACEHOLDER WRITES ARE GONE', () => {
        const src = code(ROUTE);
        expect(src).not.toMatch(/`placeholder_\$\{/);
    });

    it('and every file it accepts is uploaded', () => {
        const src = code(ROUTE);
        expect(src).toMatch(/uploadFileToStorage\(file, `farm-nation\/\$\{userId\}\//);
        for (const label of ['"title"', '"survey"', '"tax"', '"video"']) {
            expect({ label, stored: src.includes(`store(`) && src.includes(label) })
                .toEqual({ label, stored: true });
        }
    });

    it('A FAILED UPLOAD REFUSES THE LISTING — it is not recorded without evidence', () => {
        const src = code(ROUTE);
        const failure = src.indexOf('catch (uploadError)');
        // Anchored on the WRITE, not the first mention of the collection.
        const write = src.indexOf('listingRef.set(');
        expect(failure).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(-1);
        expect(failure).toBeLessThan(write);
        expect(src).toMatch(/status: 502/);
    });

    it('and it REFUSES BY DEFAULT, after the session check', () => {
        const src = code(ROUTE);
        const session = src.indexOf('if (!session?.user)');
        const retired = src.indexOf('if (!legacyLandListingApiEnabled())');
        expect(session).toBeGreaterThan(-1);
        expect(retired).toBeGreaterThan(session);
        expect(src).toMatch(/status: 410/);
    });

    it('and the flag is read at CALL time, from lib rather than the route', () => {
        /**
         * A route.ts may export only its handlers and Next's config keys. The
         * first draft declared the flag beside the handler; that does not
         * compile, and only the post-build typecheck can see it. See
         * lib/retired-endpoints.
         */
        expect(code('src/lib/retired-endpoints.ts')).toMatch(
            /export function legacyLandListingApiEnabled\(\): boolean \{\s*return process\.env\.LEGACY_LAND_LISTING_API === ENABLED;/);
        expect(code(ROUTE)).toMatch(/from "@\/lib\/retired-endpoints"/);
        const disallowed = exportedNames(ROUTE).filter((n) => !NEXT_ROUTE_EXPORTS.has(n));
        expect({ disallowed }).toEqual({ disallowed: [] });
    });

    it('and the refusal names the path that works', () => {
        expect(code('src/lib/retired-endpoints.ts')).toMatch(/\/farm-nation\/list-land/);
    });

    it('and it still demands the title and survey plan', () => {
        // The check that made the placeholder write so much worse: it refused
        // without the documents, then stored their names.
        expect(code(ROUTE)).toMatch(/if \(!documents\.landTitle \|\| !documents\.surveyPlan\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#432 — the action no longer puts unverified land on sale', () => {
    it('IT NO LONGER WRITES "available"', () => {
        /**
         * The compound defect: purchasable status, verified:false beside it, no
         * documents, and a status the review queue does not read — so nothing
         * would ever have corrected it.
         */
        const src = code(ACTION);
        const fn = src.slice(src.indexOf('_listPropertyAction'));
        const write = fn.slice(0, fn.indexOf('LAND_LISTINGS).add('));
        expect(write).not.toMatch(/status: "available"/);
        expect(write).toMatch(/status: "pending_verification"/);
    });

    it('and it REFUSES BY DEFAULT, resolving rather than throwing — #406', () => {
        const src = code(ACTION);
        expect(src).toMatch(/if \(!legacyFarmNationListingEnabled\(\)\)/);
        expect(src).toMatch(/return \{ success: false as const, error: LEGACY_LISTING_RETIRED_MESSAGE/);
    });

    it('and the refusal comes BEFORE any write', () => {
        const src = code(ACTION);
        const refusal = src.indexOf('if (!legacyFarmNationListingEnabled())');
        const write = src.indexOf('LAND_LISTINGS).add(');
        expect(refusal).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(refusal);
    });

    it('and the flag is read at CALL time, not module load', () => {
        // Read inside the function body, so a test can set it per case and
        // reviving it needs no redeploy.
        expect(code(ACTION)).toMatch(
            /function legacyFarmNationListingEnabled\(\): boolean \{\s*return process\.env\.LEGACY_FARM_NATION_LISTING === "enabled";/);
    });

    it('and the refusal names the path that works', () => {
        expect(code(ACTION)).toMatch(/\/farm-nation\/list-land/);
    });

    it('and the retirement is a REFUSAL, not a deletion — the implementation stays', () => {
        // #379/#386/#426's treatment: the code is preserved so reviving it is a
        // flag rather than an archaeology exercise.
        const src = code(ACTION);
        expect(src).toMatch(/farmNationListingSchema/);
        expect(src).toMatch(/LAND_LISTINGS\)\.add\(property\)/);
    });
});
