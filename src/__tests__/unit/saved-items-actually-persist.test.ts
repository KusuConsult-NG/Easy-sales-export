/**
 * @jest-environment node
 */

/**
 *   #105 TWO CONTROLS PERSISTED NOTHING, AND BOTH LOOKED LIKE THEY WORKED.
 *
 *        (a) THE BUYER DASHBOARD'S "SAVED SELLERS" TILE.
 *
 *            _mp_buyer_dashboard.ts read:
 *
 *                const savedSellers = buyerDoc.data()?.savedSellersCount ?? 0;
 *
 *            `savedSellersCount` was read in that one place and written in NONE.
 *            There was no save-a-seller action, no collection, and no control
 *            anywhere in the app that could have produced the number, so the
 *            tile was structurally 0 for every buyer — the shape of #100, where
 *            the Active Orders tile read a field nothing wrote.
 *
 *        (b) THE HEART ON A FARM NATION PROPERTY.
 *
 *            farm-nation/property/[id] had `useState(false)` behind a heart. It
 *            filled on click and the state died with the component. And
 *            `favoriteCount`, which _fn_listings.ts initialises to 0 on every
 *            new listing, was moved by nothing — a second permanently-zero
 *            field, sitting beside the control that should have moved it.
 *
 *   THE DECISION TAKEN
 *
 *        Both are ONE operation — "keep this, I want to find it again" —
 *        differing only in what is pointed at. Two collections, two toggles and
 *        two counts would be the shape this codebase keeps having to unpick, so
 *        there is one collection, one toggle, one rule module, and one control
 *        component. Both controls write; both lists exist; both lists are
 *        reachable from a screen a person is already on.
 *
 *   WHAT THIS SUITE HOLDS
 *
 *        The behaviour (with a real store), and the SHAPE: that no second
 *        implementation of any of it can appear without failing here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { installFakeDb, FAKE_DEFAULT_LIMIT, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    SAVED_ITEM_TYPES,
    SAVED_ITEM_ID_SEPARATOR,
    SAVED_ITEMS_PER_USER_CAP,
    isSavedItemType,
    isSavedRow,
    savedItemDocId,
    savedItemHref,
} from '@/lib/saved-items';
import { publicSellerSummary } from '@/lib/public-seller-summary';

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

const RULE = 'src/lib/saved-items.ts';
const STORE = 'src/lib/saved-items-store.ts';
const ACTIONS = 'src/app/actions/saved-items.ts';
const BUTTON = 'src/components/saved/SaveItemButton.tsx';
const PROJECTION = 'src/lib/public-seller-summary.ts';
const PROPERTY_PAGE = 'src/app/farm-nation/property/[id]/page.tsx';
const STOREFRONT = 'src/app/marketplace/sellers/[sellerId]/page.tsx';
const BUYER_DASHBOARD = 'src/app/marketplace/buyer/dashboard/page.tsx';
const BUYER_STATS = 'src/app/actions/marketplace/_mp_buyer_dashboard.ts';
const SELLER_API = 'src/app/api/marketplace/sellers/[sellerId]/route.ts';
const PROPERTIES_PAGE = 'src/app/farm-nation/properties/page.tsx';
const SAVED_SELLERS_PAGE = 'src/app/marketplace/buyer/saved/page.tsx';
const SAVED_PROPERTIES_PAGE = 'src/app/farm-nation/saved/page.tsx';

const SAVED = COLLECTIONS.SAVED_ITEMS;
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;

const BUYER = 'buyer-1';

let store: FakeDbHandle;

function source(rel: string): string {
    const full = join(ROOT, rel);
    // A missing file would slice every sweep below to nothing and let each
    // assertion pass vacuously. Fail loudly instead.
    expect(existsSync(full)).toBe(true);
    return stripComments(readFileSync(full, 'utf-8'), { label: rel });
}

/** The slice of a file between two anchors, with the anchors guarded. */
function between(src: string, from: string, to: string): string {
    const a = src.indexOf(from);
    expect(a).toBeGreaterThan(-1);
    const b = src.indexOf(to, a + from.length);
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
}

function signedInAs(userId: string | null): void {
    (global as any).mockRequireSession.mockResolvedValue(
        userId
            ? { session: { user: { id: userId, roles: ['buyer'], email: 'b@example.com' } }, error: null }
            : { session: null, error: { success: false, error: 'expired' } },
    );
}

const actions = async () => await import('@/app/actions/saved-items');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    signedInAs(BUYER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — the rule module', () => {
    it('names exactly the two things this platform lets somebody save', () => {
        expect([...SAVED_ITEM_TYPES].sort()).toEqual(['land_listing', 'marketplace_seller']);
    });

    it('refuses anything not in that set', () => {
        for (const bad of ['', 'product', 'user', 'LAND_LISTING', null, undefined, 7]) {
            expect(isSavedItemType(bad)).toBe(false);
        }
        for (const good of SAVED_ITEM_TYPES) expect(isSavedItemType(good)).toBe(true);
    });

    it('THE DOCUMENT ID IS ONE-TO-ONE — two different saves cannot collide', () => {
        // #104's defect in another collection: an id built from two parts that
        // could run together, so two rows became one. The separator refusal is
        // what makes this injective, so this is the assertion that matters.
        const a = savedItemDocId('a', 'land_listing', 'b');
        const b = savedItemDocId('b', 'land_listing', 'a');
        expect(a).not.toBe(b);

        // A part carrying the separator is REFUSED rather than allowed to
        // create the collision.
        expect(savedItemDocId(`a${SAVED_ITEM_ID_SEPARATOR}b`, 'land_listing', 'x')).toBeNull();
        expect(savedItemDocId('a', 'land_listing', `b${SAVED_ITEM_ID_SEPARATOR}x`)).toBeNull();
    });

    it('the same person saving the same thing is always the same id', () => {
        expect(savedItemDocId('u1', 'marketplace_seller', 's1'))
            .toBe(savedItemDocId('u1', 'marketplace_seller', 's1'));
        // ...and differs by type, so saving a seller does not un-save a listing
        // that happens to share the id.
        expect(savedItemDocId('u1', 'marketplace_seller', 'x'))
            .not.toBe(savedItemDocId('u1', 'land_listing', 'x'));
    });

    it('refuses an empty or unusable part instead of guessing an id', () => {
        expect(savedItemDocId('', 'land_listing', 'x')).toBeNull();
        expect(savedItemDocId('u1', 'land_listing', '')).toBeNull();
        expect(savedItemDocId('u1', 'land_listing', '   ')).toBeNull();
        expect(savedItemDocId('u1', 'nonsense', 'x')).toBeNull();
        expect(savedItemDocId(null, 'land_listing', 'x')).toBeNull();
    });

    it('a row with no `saved` key counts as saved; only an explicit false does not', () => {
        expect(isSavedRow({})).toBe(true);
        expect(isSavedRow({ saved: true })).toBe(true);
        expect(isSavedRow({ saved: false })).toBe(false);
        // The JSONB round-trip can hand back the string. Both are unsaves.
        expect(isSavedRow({ saved: 'false' })).toBe(false);
        expect(isSavedRow(null)).toBe(true);
    });

    it('every saved type has a route, and the link is built from it', () => {
        for (const t of SAVED_ITEM_TYPES) {
            expect(savedItemHref(t, 'abc')).toMatch(/^\/[a-z-]+\/[a-z-/]+\/abc$/);
        }
        expect(savedItemHref('land_listing', 'p1')).toBe('/farm-nation/property/p1');
        expect(savedItemHref('marketplace_seller', 's1')).toBe('/marketplace/sellers/s1');
    });

    it('THE CAP SITS UNDER THE ADAPTER\'S SILENT CEILING', () => {
        // A query with no .limit() returns at most FAKE_DEFAULT_LIMIT rows from
        // this adapter and says NOTHING about having stopped — a cap at or
        // above that is not a cap, it is the silent truncation with a number
        // written next to it.
        expect(SAVED_ITEMS_PER_USER_CAP).toBeGreaterThan(0);
        expect(SAVED_ITEMS_PER_USER_CAP).toBeLessThan(FAKE_DEFAULT_LIMIT);
    });

    it('the rule module imports NOTHING, so mocking a database cannot break it', () => {
        // #381's lesson: a shared rule that reached into a database-backed
        // module took three unrelated suites down with it.
        expect(source(RULE)).not.toMatch(/^\s*import\s/m);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — saving a property actually persists', () => {
    it('THE TOGGLE WRITES A ROW, where the old control wrote nothing at all', async () => {
        store.seed(LISTINGS, 'p1', { title: 'Ten hectares', status: 'verified', favoriteCount: 0 });

        const result = await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ saved: true });

        const id = savedItemDocId(BUYER, 'land_listing', 'p1')!;
        const row = store.get(SAVED, id)!;
        expect(row).toBeTruthy();
        expect(row.userId).toBe(BUYER);
        expect(row.itemType).toBe('land_listing');
        expect(row.targetId).toBe('p1');
        expect(row.saved).toBe(true);
    });

    it('saving the same thing twice produces ONE row, not two', async () => {
        store.seed(LISTINGS, 'p1', { status: 'verified', favoriteCount: 0 });

        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        expect(store.size(SAVED)).toBe(1);
    });

    it('UN-SAVING RETIRES THE ROW — it is not destroyed', async () => {
        // The standing rule for this codebase (#300–#304 converted four delete
        // doors to exactly this). A deleted-and-recreated row loses the only
        // fact it carries.
        store.seed(LISTINGS, 'p1', { status: 'verified', favoriteCount: 0 });

        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        const second = await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        expect(second.data).toEqual({ saved: false });

        const id = savedItemDocId(BUYER, 'land_listing', 'p1')!;
        const row = store.get(SAVED, id);
        expect(row).toBeTruthy();
        expect(row!.saved).toBe(false);
        expect(row!.unsavedAt).toBeTruthy();
    });

    it('THE COUNTER MOVES, where favoriteCount had been initialised to 0 and left', async () => {
        store.seed(LISTINGS, 'p1', { status: 'verified', favoriteCount: 0 });

        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        expect(store.get(LISTINGS, 'p1')!.favoriteCount).toBe(1);

        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        expect(store.get(LISTINGS, 'p1')!.favoriteCount).toBe(0);
    });

    it('a listing that cannot be counted does not fail the save', async () => {
        // The saved_items row is the source of truth; favoriteCount is a
        // display total. Refusing the save over a display total would be the
        // tail wagging the dog.
        const result = await (await actions()).toggleSavedItemAction('land_listing', 'ghost');

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ saved: true });
        expect(store.get(SAVED, savedItemDocId(BUYER, 'land_listing', 'ghost')!)).toBeTruthy();
    });

    it('an unknown item type is refused BY THE TYPE GUARD, not written under a guessed shape', async () => {
        // The message matters: savedItemDocId would also refuse this, so an
        // assertion on `success` alone cannot tell whether the type guard is
        // still here. Two guards is defence in depth; ONE guard pretending to
        // be two is how the remaining one gets removed next.
        const result = await (await actions()).toggleSavedItemAction('product', 'x');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown item type');
        expect(store.size(SAVED)).toBe(0);
    });

    it('AN ID THAT CANNOT BE FORMED IS REFUSED — never written under a guessed one', async () => {
        // A valid type, so the type guard passes; the separator makes the id
        // unformable. This is the only path that reaches the id guard.
        const result = await (await actions())
            .toggleSavedItemAction('land_listing', `a${SAVED_ITEM_ID_SEPARATOR}b`);
        expect(result.success).toBe(false);
        expect(result.error).toBe('That item cannot be saved');
        expect(store.size(SAVED)).toBe(0);
    });

    it('a signed-out caller writes nothing, AND IS TOLD WHY', async () => {
        // Without the session guard the action still fails — session.user.id
        // throws and the catch answers — so `success: false` alone does not
        // prove the guard is there. The message does.
        signedInAs(null);
        const result = await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unauthorized');
        expect(store.size(SAVED)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — reading back what was saved', () => {
    it('the state read reports the row, and is per person', async () => {
        store.seed(LISTINGS, 'p1', { status: 'verified' });
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        expect((await (await actions()).getSavedItemStateAction('land_listing', 'p1')).data)
            .toEqual({ saved: true });

        signedInAs('someone-else');
        expect((await (await actions()).getSavedItemStateAction('land_listing', 'p1')).data)
            .toEqual({ saved: false });
    });

    it('A RETIRED ROW READS AS NOT SAVED', async () => {
        // The row survives an un-save, so "the document exists" is not the
        // question the control is asking.
        store.seed(LISTINGS, 'p1', { status: 'verified' });
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        expect(store.get(SAVED, savedItemDocId(BUYER, 'land_listing', 'p1')!)).toBeTruthy();
        expect((await (await actions()).getSavedItemStateAction('land_listing', 'p1')).data)
            .toEqual({ saved: false });
    });

    it('A FAILED CHECK IS REPORTED AS A FAILURE, not as "not saved"', async () => {
        // #313's lesson: a control that answers "off" when it could not check
        // is indistinguishable from one that checked and found nothing.
        (global as any).mockFirestoreGet.mockRejectedValue(new Error('database unreachable'));

        const result = await (await actions()).getSavedItemStateAction('land_listing', 'p1');
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
    });

    it('the count includes saved rows and EXCLUDES retired ones', async () => {
        store.seed(LISTINGS, 'p1', { status: 'verified' });
        store.seed(LISTINGS, 'p2', { status: 'verified' });

        await (await actions()).toggleSavedItemAction('land_listing', 'p1');
        await (await actions()).toggleSavedItemAction('land_listing', 'p2');
        await (await actions()).toggleSavedItemAction('land_listing', 'p2'); // un-saved

        const result = await (await actions()).getSavedItemCountAction('land_listing');
        expect(result.data).toEqual({ count: 1 });
    });

    it('one person never counts another person\'s saves', async () => {
        store.seed(LISTINGS, 'p1', { status: 'verified' });
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        signedInAs('stranger');
        expect((await (await actions()).getSavedItemCountAction('land_listing')).data)
            .toEqual({ count: 0 });
    });

    it('saving a seller does not appear in the property count', async () => {
        await (await actions()).toggleSavedItemAction('marketplace_seller', 's1');

        expect((await (await actions()).getSavedItemCountAction('land_listing')).data)
            .toEqual({ count: 0 });
        expect((await (await actions()).getSavedItemCountAction('marketplace_seller')).data)
            .toEqual({ count: 1 });
    });

    it('a row with no target id is not listed — it points at nothing', async () => {
        store.seed(SAVED, 'malformed', { userId: BUYER, itemType: 'land_listing', saved: true });

        expect((await (await actions()).getSavedItemCountAction('land_listing')).data)
            .toEqual({ count: 0 });
    });

    it('THE LIST IS NEWEST FIRST', async () => {
        store.seed(SAVED, savedItemDocId(BUYER, 'land_listing', 'older')!, {
            userId: BUYER, itemType: 'land_listing', targetId: 'older', saved: true,
            savedAt: '2026-01-01T00:00:00.000Z',
        });
        store.seed(SAVED, savedItemDocId(BUYER, 'land_listing', 'newer')!, {
            userId: BUYER, itemType: 'land_listing', targetId: 'newer', saved: true,
            savedAt: '2026-06-01T00:00:00.000Z',
        });

        const rows = (await (await actions()).getSavedPropertiesAction()).data!.properties;
        expect(rows.map((r) => r.targetId)).toEqual(['newer', 'older']);
    });

    it('a saved property that is no longer viewable is LISTED as unavailable, not dropped', async () => {
        // #307's lesson: a list that lost a row must not look like one that
        // never had it. The row is still the member's and it still un-saves.
        store.seed(LISTINGS, 'p1', { title: 'Withdrawn', status: 'pending_verification' });
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        const result = await (await actions()).getSavedPropertiesAction();
        expect(result.success).toBe(true);
        expect(result.data!.properties).toHaveLength(1);
        expect(result.data!.properties[0].targetId).toBe('p1');
        expect(result.data!.properties[0].listing).toBeNull();
    });

    it('a viewable saved property comes back with its display fields', async () => {
        store.seed(LISTINGS, 'p1', {
            title: 'Ten hectares', price: 4_500_000, size: 10, status: 'verified',
            images: ['https://example.com/a.jpg'],
            location: { address: '1 Farm Road', lga: 'Ikeja', state: 'Lagos' },
            ownerEmail: 'owner@example.com',
            verificationNotes: 'internal only',
        });
        await (await actions()).toggleSavedItemAction('land_listing', 'p1');

        const listing = (await (await actions()).getSavedPropertiesAction()).data!.properties[0].listing!;
        expect(listing.title).toBe('Ten hectares');
        expect(listing.price).toBe(4_500_000);
        expect(listing.location).toBe('1 Farm Road, Ikeja, Lagos');

        // AND NOTHING ELSE. The projection is an allow-list: a land listing
        // carries the owner's email and the admin's notes, which
        // lib/land-visibility.ts names as internal.
        expect(Object.keys(listing).sort()).toEqual(
            ['id', 'image', 'location', 'price', 'size', 'status', 'title'],
        );
    });

    it('a saved seller comes back through the shared public projection', async () => {
        store.seed(VERIFICATIONS, 'v1', {
            userId: 's1', status: 'approved',
            businessName: 'Okonkwo Farms', state: 'Enugu', isVerifiedBadge: true,
            bankAccountNumber: '0123456789', bvn: '22222222222',
        });
        await (await actions()).toggleSavedItemAction('marketplace_seller', 's1');

        const row = (await (await actions()).getSavedSellersAction()).data!.sellers[0];
        expect(row.targetId).toBe('s1');
        expect(row.seller!.businessName).toBe('Okonkwo Farms');
        expect(row.seller!.isVerifiedBadge).toBe(true);
        // The verification document holds the seller's bank details. None of
        // them reach the buyer's list.
        expect(JSON.stringify(row.seller)).not.toContain('0123456789');
        expect(JSON.stringify(row.seller)).not.toContain('22222222222');
    });

    it('A VERIFICATION STILL IN THE REVIEW QUEUE IS NOT PUBLISHED', async () => {
        // The seller has a row; it has not been approved. Publishing it would
        // put an unreviewed business name and logo in front of a buyer.
        store.seed(VERIFICATIONS, 'v-pending', {
            userId: 's-pending', status: 'pending',
            businessName: 'Not Reviewed Yet', state: 'Kano',
        });
        await (await actions()).toggleSavedItemAction('marketplace_seller', 's-pending');

        const rows = (await (await actions()).getSavedSellersAction()).data!.sellers;
        expect(rows).toHaveLength(1);
        expect(rows[0].seller).toBeNull();
    });

    it('a saved seller with no approved verification is listed as unavailable, not dropped', async () => {
        await (await actions()).toggleSavedItemAction('marketplace_seller', 'gone');

        const rows = (await (await actions()).getSavedSellersAction()).data!.sellers;
        expect(rows).toHaveLength(1);
        expect(rows[0].seller).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — the public seller projection has ONE definition', () => {
    it('it is an allow-list of nine named fields, never a spread', () => {
        const summary = publicSellerSummary('v1', 's1', {
            businessName: 'Okonkwo Farms',
            bankAccountNumber: '0123456789',
            bvn: '22222222222',
            reviewNotes: 'admin only',
            identityDocumentUrl: 'https://res.cloudinary.com/x/id.png',
        });

        expect(Object.keys(summary).sort()).toEqual([
            'approvedAt', 'businessDescription', 'businessName', 'businessType',
            'id', 'isVerifiedBadge', 'logoUrl', 'state', 'userId',
        ]);
        expect(JSON.stringify(summary)).not.toContain('0123456789');
        expect(JSON.stringify(summary)).not.toContain('admin only');
        expect(JSON.stringify(summary)).not.toContain('cloudinary');
    });

    it('the projection module never spreads the source document', () => {
        // `{ id, ...verData }` is #338 and #341 exactly: the whole verification
        // record published because the projection was a spread rather than a
        // list. (The module does use a rest PARAMETER — `...candidates` in the
        // fallback helper — which is why this names the document instead of
        // banning the three dots outright.)
        const src = source(PROJECTION);
        expect(src).not.toMatch(/\.\.\.\s*(data|verData)\b/);
    });

    it('the badge survives both shapes the JSONB round-trip produces', () => {
        expect(publicSellerSummary('v', 's', { isVerifiedBadge: true }).isVerifiedBadge).toBe(true);
        expect(publicSellerSummary('v', 's', { isVerifiedBadge: 'true' }).isVerifiedBadge).toBe(true);
        expect(publicSellerSummary('v', 's', { isVerifiedBadge: false }).isVerifiedBadge).toBe(false);
        expect(publicSellerSummary('v', 's', {}).isVerifiedBadge).toBe(false);
    });

    it('THE PUBLIC ROUTE CALLS IT rather than restating the projection', () => {
        const src = source(SELLER_API);
        expect(src).toContain('publicSellerSummary(');
        // The literal it used to build. If any of these come back the route has
        // a second projection again.
        expect(src).not.toContain('businessDescription:');
        expect(src).not.toContain('isVerifiedBadge:');
        expect(src).not.toContain('logoUrl:');
    });

    it('the saved-sellers list calls the same function', () => {
        expect(source(ACTIONS)).toContain('publicSellerSummary(');
    });

    it('it accepts both timestamp shapes this codebase writes', () => {
        const iso = publicSellerSummary('v', 's', { approvedAt: '2026-01-02T03:04:05.000Z' });
        expect(iso.approvedAt).toBe('2026-01-02T03:04:05.000Z');

        const stamp = publicSellerSummary('v', 's', {
            approvedAt: { toDate: () => new Date('2026-01-02T03:04:05.000Z') },
        });
        expect(stamp.approvedAt).toBe('2026-01-02T03:04:05.000Z');

        expect(publicSellerSummary('v', 's', {}).approvedAt).toBeNull();
        expect(publicSellerSummary('v', 's', { approvedAt: 'not a date' }).approvedAt).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — the dead field is gone and the count is real', () => {
    it('`savedSellersCount` is read NOWHERE in the source tree', () => {
        // It was read in exactly one place and written in none. If it comes
        // back, so does the permanently-zero tile.
        const readers = [BUYER_STATS, BUYER_DASHBOARD, ACTIONS, STORE, RULE]
            .filter((f) => source(f).includes('savedSellersCount'));
        expect(readers).toEqual([]);
    });

    it('THE TILE COUNTS ROWS, through the shared store', () => {
        const src = source(BUYER_STATS);
        expect(src).toContain('countSavedItems(session.user.id, "marketplace_seller")');
        expect(src).toContain('from "@/lib/saved-items-store"');
    });

    it('the tile links to the list, so the number goes somewhere', () => {
        // #362's shape: a screen announcing something with no way through to it.
        const src = source(BUYER_DASHBOARD);
        expect(src).toContain('href="/marketplace/buyer/saved"');
        expect(src).toContain('Saved Sellers');
    });

    it('the browse screen links to the saved-properties list', () => {
        expect(source(PROPERTIES_PAGE)).toContain('href="/farm-nation/saved"');
    });

    it('both lists exist as real screens', () => {
        expect(existsSync(join(ROOT, SAVED_SELLERS_PAGE))).toBe(true);
        expect(existsSync(join(ROOT, SAVED_PROPERTIES_PAGE))).toBe(true);
    });

    it('the saved-properties screen is a protected path, so a callbackUrl is attached', () => {
        expect(source('src/lib/route-manifest.ts')).toContain('"/farm-nation/saved"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — the controls are wired to the server, not to component state', () => {
    it('THE PROPERTY PAGE NO LONGER KEEPS THE HEART IN useState', () => {
        const src = source(PROPERTY_PAGE);
        expect(src).not.toContain('setIsFavorite');
        expect(src).not.toContain('isFavorite');
        expect(src).toContain('<SaveItemButton itemType="land_listing"');
    });

    it('THE SELLER STOREFRONT HAS A SAVE CONTROL — there had been none anywhere', () => {
        const src = source(STOREFRONT);
        expect(src).toContain('SaveItemButton');
        expect(src).toContain('itemType="marketplace_seller"');
    });

    it('there is exactly ONE save control component in the tree', () => {
        // Two would drift, and the drift would be which one persists.
        const users = [PROPERTY_PAGE, STOREFRONT, SAVED_SELLERS_PAGE, SAVED_PROPERTIES_PAGE]
            .filter((f) => source(f).includes('SaveItemButton'));
        expect(users.sort()).toEqual(
            [PROPERTY_PAGE, STOREFRONT, SAVED_SELLERS_PAGE, SAVED_PROPERTIES_PAGE].sort(),
        );
        for (const f of users) {
            expect(source(f)).toContain('from "@/components/saved/SaveItemButton"');
        }
    });

    it('THE BUTTON RENDERS THE SERVER\'S ANSWER, not its own assumption', () => {
        // #310's lesson, and #382's: asserting the answer is COMPUTED is not
        // asserting it is USED. Both halves are checked in their own slice,
        // because a mutant that flips only the click handler leaves the mount
        // effect intact and a whole-file match passes anyway.
        const src = source(BUTTON);
        expect(src).toContain('getSavedItemStateAction(');
        expect(src).toMatch(/if \(result\.success && result\.data\) setSaved\(result\.data\.saved\)/);

        const click = between(src, 'const onClick', 'const label');
        expect(click).toContain('setSaved(result.data.saved);');
        // Anything derived from the browser's own previous state is the defect.
        expect(click).not.toMatch(/setSaved\(\s*!/);
    });

    it('a refusal is SHOWN rather than swallowed', () => {
        const src = source(BUTTON);
        const click = between(src, 'const onClick', 'const label');
        expect(click).toContain('} else {');
        expect(click).toContain('showToast(result.error');
    });

    it('a signed-out visitor is sent to sign in, with a way back', () => {
        const click = between(source(BUTTON), 'const onClick', 'const label');
        expect(click).toContain('status === "unauthenticated"');
        expect(click).toContain('callbackUrl=');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#105 — the shape holds', () => {
    it('every action here is scoped to the session — none takes a userId', () => {
        // The guarantee is that there is no ARGUMENT through which another
        // person's id could arrive, rather than a check that a second door
        // could forget.
        const src = source(ACTIONS);
        const signatures = src.match(/async function _\w+Action\(([^)]*)\)/g) ?? [];
        expect(signatures.length).toBe(5);
        for (const sig of signatures) {
            expect(sig).not.toMatch(/userId/);
        }
        expect(src.split('session.user.id').length - 1).toBeGreaterThanOrEqual(5);
    });

    it('the toggle uses set with merge, because update() on a missing row is a silent no-op', () => {
        const src = source(ACTIONS);
        expect(src).toContain('{ merge: true }');
        // The FIRST save of anything writes a document that does not exist yet.
        const toggle = between(src, 'async function _toggleSavedItemAction', 'export const toggleSavedItemAction');
        expect(toggle).toContain('.set(');
        expect(toggle).toContain('{ merge: true }');
    });

    it('NOTHING IN THIS FEATURE DELETES A ROW', () => {
        for (const f of [ACTIONS, STORE, RULE, BUTTON]) {
            expect(source(f)).not.toContain('.delete(');
        }
    });

    it('the store caps what it reads, so a list cannot silently become partial', () => {
        const src = source(STORE);
        expect(src).toContain('.limit(SAVED_ITEMS_PER_USER_CAP)');
    });

    it('THE SAVED/UNSAVED SPLIT IS DONE IN CODE, never as a JSONB where', () => {
        // `.where("saved", "==", false)` compares a boolean against TEXT in
        // this adapter, and its outcome depends on which writer produced the
        // row — the #78 hazard.
        const src = source(STORE);
        expect(src).not.toMatch(/\.where\(\s*["']saved["']/);
        expect(src).toContain('isSavedRow(data)');
    });

    it('there is exactly ONE query against the saved-items collection', () => {
        // Two would be two definitions of "which rows count", which is the
        // shape this codebase keeps producing.
        const queries = source(STORE).match(/collection\(COLLECTIONS\.SAVED_ITEMS\)\s*\n?\s*\.where/g) ?? [];
        expect(queries.length).toBe(1);
        // The actions file addresses documents BY ID only; it never queries.
        expect(source(ACTIONS)).not.toMatch(/COLLECTIONS\.SAVED_ITEMS\)\s*\n?\s*\.where/);
    });

    it('the shared store is a plain module, not a registered server action surface', () => {
        // #374/#379's lesson: an export from a "use server" module is reachable
        // over the wire whether or not a screen calls it.
        expect(source(STORE)).not.toContain('use server');
    });

    it('A FAILED COUNTER STEP ONLY LOGS — it never fails the save', () => {
        // The saved_items row is the source of truth; favoriteCount is a
        // display total derived from it. Refusing the save over a display
        // total would be the tail wagging the dog. (The fake store never
        // fails a call, so this is asserted on the shape of the handler.)
        const src = source(ACTIONS);
        const step = between(src, 'if (itemType === "land_listing")', 'return { error: null');
        const handler = between(step, '} catch (error) {', '}');
        expect(handler).toContain('logger.error');
        expect(handler).not.toContain('return');
    });

    it('the counter is stepped atomically, in one place', () => {
        const src = source(ACTIONS);
        const steps = src.match(/favoriteCount: FieldValue\.increment\(/g) ?? [];
        expect(steps.length).toBe(1);
        expect(src).toContain('FieldValue.increment(nowSaved ? 1 : -1)');
    });

    it('the collection is declared once and referenced by the constant', () => {
        for (const f of [ACTIONS, STORE]) {
            expect(source(f)).not.toContain('"saved_items"');
            expect(source(f)).toContain('COLLECTIONS.SAVED_ITEMS');
        }
    });
});
