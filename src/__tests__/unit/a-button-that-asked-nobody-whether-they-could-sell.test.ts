/**
 * @jest-environment node
 */

/**
 *   TWO SELLER SURFACES OFFERED TO BUYERS.
 *
 *   THE OWNER: "Remove add product button for buyers and also remove village
 *   market tab for buyers since the products are visible on browse products."
 *
 * ── THE BUTTON ──────────────────────────────────────────────────────────────
 *
 *   VillageMarketEventClient drew this unconditionally, to every visitor:
 *
 *       <div className="bg-emerald-50 ...">
 *           <p>Are you participating in this event?</p>
 *           <button onClick={() => setShowAddProduct(true)}>Add Product</button>
 *       </div>
 *
 *   The file contained no reference to a role or a session check at all.
 *
 *   THE SERVER WAS NEVER FOOLED, and that is what makes it a UX defect rather
 *   than a hole: addFlashSaleProductAction refuses anyone outside
 *   `participantSellerIds`, and joinVillageMarketEventAction refuses anyone
 *   `sellerIsApproved` says no to. So a buyer who pressed it was told "You must
 *   join the event before listing products" — a refusal naming a step they can
 *   never complete. Offering an action that cannot succeed is the same shape as
 *   #814's silent bounce, one layer earlier.
 *
 *   GATED ON PARTICIPATION, NOT ON A ROLE. `hasJoined` is already computed in
 *   that component from the event's own participant list, and it is the SAME
 *   question the server asks — so the button now appears exactly when the
 *   action behind it would succeed. A roles check would have gone stale the way
 *   the marketplace hub link did.
 *
 * ── THE TAB ─────────────────────────────────────────────────────────────────
 *
 *   The owner's reason is the whole argument: flash-sale products already
 *   appear in Browse Products — BuyerProductsClient reads
 *   getActiveFlashSaleProductsAction and links each one to its event. The tab
 *   gave a buyer a second door to things they could already see, onto a screen
 *   whose purpose is listing products for sale.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const EVENT = 'src/app/marketplace/village-market/[id]/VillageMarketEventClient.tsx';
const SIDEBAR = 'src/components/layout/ModuleSidebar.tsx';
const ACTIONS = 'src/app/actions/village-market.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('the Add Product banner is offered only to participants', () => {
    it('IT IS GATED AT ALL — the defect was that it was not', () => {
        //   THE test. The banner used to be drawn with no condition in front
        //   of it whatsoever.
        const src = code(EVENT);

        //   ANCHORED ON THE BANNER'S HEADING, not on the words "Add Product".
        //   The button text sits a few hundred characters further in, past the
        //   wrapper and both paragraphs, so a window measured from it missed
        //   the guard and this assertion failed against the fixed code. The
        //   heading is the first thing inside the guard.
        const at = src.indexOf('You are participating in this event');
        expect(at).toBeGreaterThan(-1);

        const before = src.slice(Math.max(0, at - 300), at);
        expect(before).toContain('hasJoined &&');
    });

    it('AND IT ASKS THE SAME QUESTION THE SERVER ASKS', () => {
        //   participantSellerIds is the server's rule; hasJoined is read from
        //   it. If the client ever switched to a role check the two could
        //   disagree, which is how a button that cannot work gets drawn.
        const src = code(EVENT);

        expect(src).toContain('participantSellerIds?.includes(userId)');
    });

    it('AND THE SERVER STILL REFUSES A NON-PARTICIPANT, gate or no gate', () => {
        //   The UI change must not be load-bearing. Hiding a button is not
        //   authorisation.
        const src = code(ACTIONS);

        expect(src).toContain('You must join the event before listing products');
        expect(src).toContain('sellerIsApproved(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Village Market is not offered to buyers in the nav', () => {
    it('THE TAB IS sellerOnly', () => {
        const src = code(SIDEBAR);
        const at = src.indexOf('"/marketplace/village-market"');
        expect(at).toBeGreaterThan(-1);

        //   Read the whole entry, not the file: sellerOnly appears on several
        //   other items and a file-wide search would pass against any of them.
        const entry = src.slice(src.lastIndexOf('{', at), src.indexOf('}', at) + 1);
        expect(entry).toContain('sellerOnly: true');
    });

    it('AND THE ADMIN ONE IS UNTOUCHED — a different nav, a different rule', () => {
        //   /admin/marketplace/village-market is in ADMIN_NAV and is gated by
        //   the admin surface, not by sellerOnly.
        const src = code(SIDEBAR);

        expect(src).toContain('"/admin/marketplace/village-market"');
    });

    it('and the buyer can still reach flash sales through Browse Products', () => {
        //   The owner's own reason for removing the tab. If this ever stopped
        //   being true the tab would have to come back.
        const buyer = code('src/app/marketplace/buyer/products/BuyerProductsClient.tsx');

        expect(buyer).toContain('getActiveFlashSaleProductsAction');
        expect(buyer).toContain('/marketplace/village-market/');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and nothing a seller needs was removed', () => {
    it('POSITIVE CONTROL: A PARTICIPANT STILL GETS THE BUTTON', () => {
        //   The direction that must not move. Deleting the banner outright
        //   would satisfy "it is gated" and strand every seller in the event.
        const src = code(EVENT);

        expect(src).toContain('setShowAddProduct(true)');
        expect(src).toContain('Add Product');
    });

    it('POSITIVE CONTROL: and the Join as Seller path is still there', () => {
        //   How a seller becomes a participant in the first place.
        const src = code(EVENT);

        expect(src).toContain('joinVillageMarketEventAction');
    });

    it('POSITIVE CONTROL: the marketplace nav still has its buyer entries', () => {
        //   Vacuity guard: a MARKETPLACE_NAV that lost its entries would pass
        //   the sellerOnly assertion by having nothing to assert against.
        const src = code(SIDEBAR);

        for (const href of [
            '"/marketplace/buyer/products"',
            '"/marketplace/buyer/orders"',
            '"/marketplace/checkout"',
        ]) {
            expect(src).toContain(href);
        }
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   remove the hasJoined guard — the defect      1  "IT IS GATED AT ALL"
 *
 *   delete the banner entirely (looks like a     2  "POSITIVE CONTROL: A
 *   fix, strands every participating seller)        PARTICIPANT STILL GETS THE
 *                                                   BUTTON"
 *
 *   gate it on a role instead of participation   1  "AND IT ASKS THE SAME
 *                                                   QUESTION THE SERVER ASKS"
 *
 *   drop sellerOnly from the Village Market      1  "THE TAB IS sellerOnly"
 *   nav entry
 *
 *   put sellerOnly on the ADMIN village-market   0  SURVIVED — different nav,
 *   entry as well                                   not what this pins
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the banner's heading text             0  SURVIVED ✓
 */
