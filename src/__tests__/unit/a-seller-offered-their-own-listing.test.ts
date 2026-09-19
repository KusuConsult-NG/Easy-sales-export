/**
 * @jest-environment node
 */

/**
 *   #881 #883 TWO CONTROLS THAT COULD NOT WORK, FOR DIFFERENT REASONS.
 *
 * ── #881 A SELLER WAS OFFERED THEIR OWN LISTING ─────────────────────────────
 *
 *   THE OWNER: "why is there an option for seller to make an offer on when the
 *   listed product belongs to the seller."
 *
 *   MEASURED FIRST, and the money was never at risk — all three doors already
 *   refuse it on the SERVER, each reading the owner from the RECORD rather than
 *   from the request:
 *
 *       makeLandOfferAction        "You cannot make an offer on your own property"
 *       initializePropertyPayment  "You cannot purchase your own property"
 *       submitQuoteRequestAction   "You cannot request a quote on your own listing"
 *
 *   So what shipped was a set of buttons that always fail. That is the class
 *   this audit keeps removing — a control that looks like it does something and
 *   does not — and it is worse here than usual, because the person meeting it is
 *   the one who put the listing there and has every reason to think they have
 *   done something wrong.
 *
 *   The owner gets the door they actually want instead: edit it.
 *
 * ── #883 THE NOTIFICATION MENU OPENED BEHIND THE MAP ────────────────────────
 *
 *   THE OWNER: "the dropdown for notification should overlay on the map."
 *
 *   Leaflet positions its panes and controls with z-index values of its own —
 *   400 to 700 for the panes, up to 1000 for the controls — and they are large
 *   deliberately, because a map is usually alone on its layer. The notification
 *   menu is Tailwind's `z-50`. Not a competitor.
 *
 *   FIXED BY CAPPING THE MAP rather than out-bidding it: a stacking context on
 *   the container confines every Leaflet z-index inside it. Raising the menu
 *   would work until the next component picked a number, and this platform has
 *   three maps that would each have to be remembered.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const PROPERTY = 'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx';
const PRODUCT = 'src/app/marketplace/products/[id]/ProductDetailClient.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#881 — the server refuses it, which is why the button was a lie', () => {
    it('ALL THREE DOORS ALREADY REFUSE A SELF-PURCHASE — the premise', () => {
        /*
         *   If this were false the UI change would be hiding a working feature
         *   rather than a dead control, so it is checked rather than assumed.
         */
        expect(code('src/app/actions/land-offers.ts'))
            .toContain('You cannot make an offer on your own property');
        expect(code('src/app/actions/farm-nation-payment.ts'))
            .toContain('You cannot purchase your own property');
        expect(code('src/app/actions/marketplace/_quotes.ts'))
            .toContain('You cannot request a quote on your own listing');
    });

    it('AND EACH READS THE OWNER FROM THE RECORD, not from the request', () => {
        //   Which is why comparing against the same field on the client is the
        //   right comparison rather than a guess at one.
        //   #904 — still read from the RECORD, which is what this asserts, and
        //   now resolved: two profiles of one person are two ids, so `===` let
        //   exactly the seller this refuses make an offer on their own land.
        expect(code('src/app/actions/land-offers.ts')).toContain('isSamePerson(ownerId, userId)');
        expect(code('src/app/actions/marketplace/_quotes.ts')).toContain('isSamePerson(sellerId, userId)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#881 — so the screens stop offering it', () => {
    it('THE REPORTED DEFECT: the property page asks whose land it is', () => {
        const src = code(PROPERTY);

        expect(src).toContain('const isMine =');
        expect(src).toContain('session.user.id === property?.ownerId');
    });

    it('AND THE OWNER SEES EDIT INSTEAD OF RESERVE AND OFFER', () => {
        const src = code(PROPERTY);
        const at = src.indexOf('{isMine ? (');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 1200);
        expect(block).toContain('Edit this listing');
        expect(block).toContain('/farm-nation/edit-property/');
    });

    it('AND A BUYER STILL GETS THE RESERVE AND OFFER CONTROLS — the control', () => {
        /*
         *   The half that would make this a regression rather than a fix. The
         *   purchase path has to survive for everybody who is not the owner.
         */
        const src = code(PROPERTY);

        expect(src).toContain('Lock Land Reservation');
        expect(src).toContain('Make an offer');
        expect(src).toContain(') : property.status === "verified" ? (');
    });

    it('AND THE PRODUCT PAGE DOES THE SAME', () => {
        const src = code(PRODUCT);

        expect(src).toContain('const isMine =');
        expect(src).toContain('session.user.id === (product as any).sellerId');

        const at = src.indexOf('{isMine ? (');
        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 900)).toContain('/marketplace/seller/products/');
    });

    it('AND A BUYER STILL GETS ADD TO CART AND REQUEST FOR QUOTE', () => {
        const src = code(PRODUCT);

        expect(src).toContain('Add to Cart');
        expect(src).toContain('Request for Quote');
        expect(src).toContain('onClick={handleAddToCart}');
    });

    it('AND A SIGNED-OUT VISITOR IS NEVER "THE OWNER"', () => {
        /*
         *   `undefined === undefined` is true, and a row with no ownerId beside
         *   a session with no id would have hidden the purchase controls from
         *   every anonymous visitor on the page. Both sites require an id first.
         */
        for (const rel of [PROPERTY, PRODUCT]) {
            expect({ rel, guarded: code(rel).includes('!!session?.user?.id &&') })
                .toEqual({ rel, guarded: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#883 — the notification menu opens over the map', () => {
    it('THE REPORTED DEFECT: the map is given its own stacking context', () => {
        const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
        const at = css.indexOf('.leaflet-container');

        expect(at).toBeGreaterThan(-1);
        const rule = css.slice(at, at + 120);
        expect(rule).toContain('position: relative');
        expect(rule).toContain('z-index: 0');
    });

    it('AND THE MENU IS STILL THE ORDINARY z-50, not an escalation', () => {
        /*
         *   The point of capping the map: nothing else had to move. A fix that
         *   raised the menu to some larger number would have started an arms
         *   race with the next component to pick one.
         */
        expect(code('src/components/layout/NotificationCenter.tsx')).toContain('z-50');
    });

    it('and the maps this governs really are Leaflet — the premise', () => {
        //   `.leaflet-container` governs nothing if nothing renders one.
        for (const rel of [
            'src/components/farm-nation/LocationPicker.tsx',
            'src/components/farm-nation/MapView.tsx',
        ]) {
            expect({ rel, leaflet: code(rel).includes('L.map(') })
                .toEqual({ rel, leaflet: true });
        }
    });
});
