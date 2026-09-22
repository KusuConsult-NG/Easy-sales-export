/**
 * @jest-environment node
 */

/**
 *   THE SELLER WAS APPROVED, SO THE LISTING WAS PUBLISHED.
 *
 *   THE OWNER: "When a user applies to any of the modules that they list
 *   products, when they get approved as users, their content is also supposed
 *   to be approved through the content approval tab on the admin dashboard. How
 *   do we blend this 2 logic together. All the content that are currently being
 *   displayed on marketplace and farm nation were displayed after the user got
 *   approved and not his content being approved."
 *
 *   There are two gates in the design and marketplace ran one of them:
 *
 *       gate 1  MAY THIS PERSON SELL?    lib/seller-approval.ts. Asked by both
 *                                        product creators. Live and working.
 *       gate 2  MAY THIS ITEM BE SHOWN?  the content-approval console. Live for
 *                                        land and for export. Bypassed here.
 *
 *   Measured across the three collections the console decides:
 *
 *       land       created `pending_verification`   waits for gate 2
 *       export     created `pending`                waits for gate 2
 *       products   created `active`                 published immediately
 *
 *   So the owner's sentence is a precise description of the code. A marketplace
 *   listing went live the moment its seller was approved, and gate 1 is about
 *   the PERSON — it says nothing about what they listed.
 *
 *   ── AND THE CONSOLE REPORTED THE RESULT AS VERIFIED ────────────────────────
 *
 *   The approved tab's panel read "This content has been fully verified and
 *   approved" for every purchasable row, including the ones no administrator
 *   had ever opened. That sentence is the defect rendered as copy: an admin
 *   looking for exactly the problem the owner describes was told it did not
 *   exist.
 *
 *   Every decision path stamps its reviewer — approvedBy on products and
 *   export, verifiedBy on land, reviewedBy from the moderation screen — so the
 *   absence of all of them IS the fact, recorded at the time rather than
 *   guessed at later.
 *
 *   ── WHAT THIS DELIBERATELY DOES NOT ASSERT ─────────────────────────────────
 *
 *   That stored rows changed. They did not, and must not: pulling live
 *   inventory off a running marketplace is the owner's call, not a side effect
 *   of a constant. Everything already `active` stays visible and buyable, and
 *   is now visibly unreviewed.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    PRODUCT_INITIAL_STATUS,
    PRODUCT_CREATED_MESSAGE,
    isVisibleProductStatus,
    isSellableProductStatus,
} from '@/lib/product-status';
import { wasReviewed } from '@/lib/content-review-stamp';

const CONSOLE_PAGE = 'src/app/admin/content-approval/page.tsx';
const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

describe('a new marketplace listing waits for the content gate', () => {
    it('IT IS NOT PUBLISHED ON CREATION', () => {
        expect({
            initial: PRODUCT_INITIAL_STATUS,
            visibleToBuyers: isVisibleProductStatus(PRODUCT_INITIAL_STATUS),
            buyableByBuyers: isSellableProductStatus(PRODUCT_INITIAL_STATUS),
        }).toEqual({ initial: 'pending', visibleToBuyers: false, buyableByBuyers: false });
    });

    it('AND THE THREE MODULES NOW AGREE — land and export always did', () => {
        /*
         *   The other two creators, read from source. This is the "blend": one
         *   answer to "may this item be shown", asked by all three.
         */
        const land = code('src/app/actions/farm-nation/_fn_listings.ts');
        const exportCatalog = code('src/app/actions/export-products.ts');

        expect(land).toContain('status: "pending_verification"');
        expect(exportCatalog).toContain('status: "pending"');
    });

    it('AND THE SELLER IS TOLD THE TRUTH ABOUT WHAT HAPPENED', () => {
        /*
         *   Three screens said "Product listed successfully". A seller told
         *   their listing is live, who then cannot find it, is the complaint
         *   product-status.ts's own header records from the first time the two
         *   creators disagreed — reproduced by copy instead of by code.
         */
        expect(PRODUCT_CREATED_MESSAGE).toMatch(/review/i);
        expect(PRODUCT_CREATED_MESSAGE).not.toMatch(/listed successfully/i);
    });

    it('AND NO SCREEN KEEPS ITS OWN COPY OF THAT SENTENCE', () => {
        //   The N-doors half: the message is derived, so flipping the constant
        //   back carries the wording with it.
        for (const rel of [
            'src/app/marketplace/products/add/page.tsx',
            'src/app/marketplace/sell/create/page.tsx',
            'src/app/api/marketplace/create-product/route.ts',
        ]) {
            const src = code(rel);
            expect({ file: rel, derives: src.includes('PRODUCT_CREATED_MESSAGE') })
                .toEqual({ file: rel, derives: true });
            expect(src).not.toMatch(/Product listed successfully/);
            expect(src).not.toMatch(/Product created successfully/);
        }
    });
});

describe('live content that nobody decided says so', () => {
    it('A ROW WITH NO REVIEWER READS AS UNREVIEWED', () => {
        expect(wasReviewed({ status: 'active', sellerId: 's1' })).toBe(false);
        expect(wasReviewed({})).toBe(false);
        expect(wasReviewed(null)).toBe(false);
        //   An empty string is what a blank admin id would leave behind, and it
        //   is not a decision.
        expect(wasReviewed({ approvedBy: '   ' })).toBe(false);
    });

    it('AND EVERY SPELLING A DECISION WRITES COUNTS — the control', () => {
        /*
         *   Four paths decide these three collections and they do not share a
         *   field name. Reading only `approvedBy` would report every land
         *   listing an admin verified as never reviewed, which is a worse lie
         *   than the one being fixed.
         */
        expect({
            products: wasReviewed({ approvedBy: 'admin-1' }),
            land: wasReviewed({ verifiedBy: 'admin-1' }),
            moderation: wasReviewed({ reviewedBy: 'admin-1' }),
            rejection: wasReviewed({ rejectedBy: 'admin-1' }),
        }).toEqual({ products: true, land: true, moderation: true, rejection: true });
    });

    it('AND THE THREE APPROVAL PATHS REALLY WRITE THOSE FIELDS', () => {
        /*
         *   THE vacuity guard on the test above: it runs against field names
         *   typed in this file. If approveContentAction stamped something else,
         *   every genuinely-reviewed row would read as unreviewed and the
         *   console would flag the entire catalogue.
         */
        const src = code('src/app/actions/admin-content.ts');

        expect(src).toContain('approvedBy: adminId');
        expect(src).toContain('verifiedBy: adminId');
    });

    it('AND THE CONSOLE STOPS CALLING IT VERIFIED', () => {
        /*
         *   The copy that told an administrator the problem did not exist. It
         *   is kept for genuinely reviewed rows — that sentence is true of them
         *   — and an unreviewed one gets its own panel.
         */
        const src = code(CONSOLE_PAGE);

        expect(src).toContain('!item.reviewed');
        expect(src).toContain('Live, but never reviewed');

        //   And the true sentence is still reachable, so this was not fixed by
        //   deleting the good case.
        expect(src).toContain('fully verified and approved');
    });

    it('AND THE QUEUE REPORTS IT PER ITEM, for all three content types', () => {
        //   One flag computed at three push sites. A type left out would render
        //   `undefined`, which is falsy — so every row of it would be flagged.
        const src = code('src/app/actions/admin-content.ts');
        const occurrences = src.split('reviewed: wasReviewed(data)').length - 1;

        expect({ pushSitesSettingIt: occurrences }).toEqual({ pushSitesSettingIt: 3 });
    });
});
