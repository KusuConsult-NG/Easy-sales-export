/**
 * @jest-environment node
 */

/**
 * #115 closed the land verification queue on the actions path. The public API
 * route was never covered, and it spread the stored document.
 *
 * That change — "Stop the land verification queue being a public feed" — added
 * PUBLIC_LAND_STATUSES and stripInternalLandFields to
 * src/app/actions/land-actions.ts, with the reasoning written out:
 *
 *     A land listing is public once it has been verified — browsing farmland
 *     for sale is the point of the module. Everything else is a review queue:
 *     pending_verification, rejected, deleted. Those documents carry the
 *     admin's verificationNotes and rejectionReason, the owner's id and email,
 *     and they belong to people who have not agreed to be listed anywhere yet.
 *
 * land-listing-visibility.test.ts covers that path and still does.
 *
 * /api/farm-nation/listings has no authentication and feeds /land and
 * /farm-nation/map. It did:
 *
 *     const data = doc.data();
 *     return { id: doc.id, ...data, ... };
 *
 * So an unauthenticated visitor received verifiedBy — the user id of the admin
 * who approved the listing — plus rejectionReason and verificationNotes for any
 * listing that had been rejected and later approved. #179 made that last case
 * more likely by carrying the earlier decision forward instead of erasing it,
 * which is the right thing to do and the reason this endpoint had to be looked
 * at again.
 *
 * The fourth instance of one shape in this audit: the export catalogue
 * publishing the stored document, the quiz answer key reaching the browser,
 * seller approvals bypassing the audited path. Each time the correct
 * implementation existed and one path did not reach it — and here the correct
 * implementation was written specifically to stop this, one file away.
 *
 * THE TWO DEFINITIONS ALSO DISAGREED
 * ----------------------------------
 * The action treats "verified" and "approved" as publicly visible; the route
 * queried "verified" alone. A listing an admin marked approved was public to
 * one half of the platform and invisible to the other.
 *
 * Both read one module now, which is the only version of this that cannot
 * drift again.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    PUBLIC_LAND_STATUSES,
    INTERNAL_LAND_FIELDS,
    stripInternalLandFields,
} from '@/lib/land-visibility';

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

/**
 *   #562 The route's BODY moved to lib/land-listings-reader, so that /land and
 *   /farm-nation/map could read it on the server instead of fetching the route
 *   from the browser after the page had already been rendered.
 *
 *   The checks below read the reader, not the handler, and that is not a
 *   weakening: it is the same code, and it now has three callers instead of
 *   one, so an assertion on it covers more than it did. The route is still read
 *   separately, to prove it did not keep a second copy of the query.
 */
const route = source('src/lib/land-listings-reader.ts');
const handler = source('src/app/api/farm-nation/listings/route.ts');
const actions = source('src/app/actions/land-actions.ts');

const LISTING = {
    id: 'l1',
    title: 'Five hectares near Ibadan',
    price: 4_000_000,
    ownerId: 'user-123',
    status: 'verified',
    verificationNotes: 'Called the surveyor, documents check out',
    rejectionReason: 'Title deed was illegible',
    verifiedBy: 'admin-999',
    ownerEmail: 'owner@example.com',
    previousOwnerId: 'user-000',
    verificationStatus: {
        verified: true,
        verifiedBy: 'admin-999',
        rejectionReason: 'Title deed was illegible',
    },
};

describe('the review fields do not reach an unauthenticated visitor', () => {
    it('removes every internal field', () => {
        const stripped: any = stripInternalLandFields(LISTING);

        for (const field of INTERNAL_LAND_FIELDS) {
            expect(`${field} present: ${field in stripped}`).toBe(`${field} present: false`);
        }
    });

    it('removes them from the nested decision object too', () => {
        // approve-land and reject-land write the decision under
        // verificationStatus, so clearing only the top level leaves the same
        // information one level down. #179 is what put it there.
        const stripped: any = stripInternalLandFields(LISTING);

        expect(stripped.verificationStatus.verifiedBy).toBeUndefined();
        expect(stripped.verificationStatus.rejectionReason).toBeUndefined();
        expect(stripped.verificationStatus.verified).toBe(true);
    });

    it('keeps what the listing is for', () => {
        // Vacuity guard: returning an empty object strips the review fields and
        // the listing.
        const stripped: any = stripInternalLandFields(LISTING);

        expect(stripped.title).toBe('Five hectares near Ibadan');
        expect(stripped.price).toBe(4_000_000);
        expect(stripped.status).toBe('verified');
    });

    it('does not mutate the document it was given', () => {
        // The admin views are built from the same object and need these.
        stripInternalLandFields(LISTING);

        expect(LISTING.verifiedBy).toBe('admin-999');
        expect(LISTING.verificationStatus.verifiedBy).toBe('admin-999');
    });

    it('the public route applies it', () => {
        // THE test.
        expect(route).toContain('stripInternalLandFields(doc.data() ?? {})');
        expect(codeOnly(route)).not.toContain('const data = doc.data();');
    });

    it('the route still has no authentication, which is why this is the protection', () => {
        // Correct — browsing farmland is the point of the module — and the
        // reason the field list is the whole of the defence here.
        expect(codeOnly(route)).not.toContain('requireSession');
    });
});

describe('one definition of publicly visible', () => {
    it('the route queries the shared status list', () => {
        expect(route).toContain('.where("status", "in", [...PUBLIC_LAND_STATUSES])');
        expect(codeOnly(route)).not.toContain('.where("status", "==", "verified")');
    });

    it('approved is public, which the route used to miss', () => {
        expect(PUBLIC_LAND_STATUSES).toContain('verified');
        expect(PUBLIC_LAND_STATUSES).toContain('approved');
    });

    it('the review statuses are not public', () => {
        // Vacuity guard: a list containing everything satisfies the assertion
        // above and republishes the queue #115 closed.
        for (const status of ['pending_verification', 'rejected', 'deleted']) {
            expect(`${status} public: ${PUBLIC_LAND_STATUSES.includes(status)}`)
                .toBe(`${status} public: false`);
        }
    });

    it('the action reads the shared module rather than its own copy', () => {
        expect(actions).toContain('from "@/lib/land-visibility"');
        expect(codeOnly(actions)).not.toContain('const PUBLIC_LAND_STATUSES');
        expect(codeOnly(actions)).not.toContain('const INTERNAL_LAND_FIELDS');
    });

    it('the reasoning travelled with the list', () => {
        // A bare array in a new file is how the next person deletes an entry.
        const lib = source('src/lib/land-visibility.ts');

        expect(lib).toContain('review queue');
        expect(lib).toContain("admin's user id");
    });

    it('the behaviour suite from #115 still covers the actions path', () => {
        // These are separate files on purpose: that one mocks the session and
        // exercises the actions, this one reads the route. Neither replaces the
        // other.
        expect(source('src/__tests__/unit/land-listing-visibility.test.ts'))
            .toContain('The land verification queue was a public feed');
    });
});

describe('what the public pages still get', () => {
    it('both pages get exactly what this reader produces', () => {
        // The premise. If either page found another way to the listings, the
        // exposure would change and so would the argument above.
        //
        //   #562 Each page is now a server half that calls the shared reader
        //   and a client half that still falls back to the HTTP route. Both
        //   paths end at the same function, which is a stronger premise than
        //   "both call the route" was — there is no longer a second copy of the
        //   query for one of them to drift onto.
        for (const server of ['src/app/land/page.tsx', 'src/app/farm-nation/map/page.tsx']) {
            expect({ server, reads: source(server).includes('readPublicLandListings') })
                .toEqual({ server, reads: true });
        }
        for (const client of [
            'src/app/land/LandMapClient.tsx',
            'src/app/farm-nation/map/FarmNationMapClient.tsx',
        ]) {
            expect({ client, fallsBack: source(client).includes('/api/farm-nation/listings') })
                .toEqual({ client, fallsBack: true });
        }
    });

    it('and the route kept no second copy of the query', () => {
        //   The whole point of the extraction. A handler that still built its
        //   own listing objects would be the two-copies-of-one-contract defect
        //   this audit keeps finding, with the stripping rule in one of them.
        expect(handler).toContain('readPublicLandListings');
        expect(handler).not.toContain('stripInternalLandFields');
        expect(handler).not.toContain('PUBLIC_LAND_STATUSES');
    });

    it('price normalisation is unchanged', () => {
        // Both spellings exist in stored documents; the route reconciles them
        // and that is not part of this change.
        expect(route).toContain('totalPrice: data.totalPrice ?? data.price ?? 0');
        expect(route).toContain('price: data.price ?? data.totalPrice ?? 0');
    });
});
