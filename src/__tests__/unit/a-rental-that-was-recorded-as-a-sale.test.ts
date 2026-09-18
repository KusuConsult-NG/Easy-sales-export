/**
 * @jest-environment node
 */

/**
 *   #876 A RENTAL WAS FINALISED AS A SALE, AND THE TENANT BECAME THE OWNER.
 *
 *   THE OWNER: "when a property is either for rent or for sell and its listed
 *   separately, when a buyer pays for either, the property is supposed to be
 *   off."
 *
 *   MEASURED FIRST, and the half that was reported turned out to be working:
 *   payment moves the listing to `pending_escrow` and the release moves it to
 *   `sold`/`leased`, none of which are in PURCHASABLE_STATUSES — and the browse
 *   query filters `status in PURCHASABLE_STATUSES` before any other filter. So
 *   a parcel offered both ways DOES come off both ways when either offer is
 *   paid for.
 *
 *   What was wrong is WHICH WAY it came off, and what that did to the title.
 *
 * ── THE LABEL DECIDED, AND THE LABEL CANNOT KNOW ────────────────────────────
 *
 *       const isLease = propertyDoc.data()?.type === "lease";
 *
 *   `type` is a single legacy string, and #869's own submit writes it as
 *
 *       type: data.type || ((availableForRent && !availableForSale)
 *                            ? "lease" : "sale")
 *
 *   so a parcel offered BOTH ways is labelled "sale", always. A buyer who took
 *   the RENTAL offer had the parcel marked `sold`.
 *
 *   And older than #869: the form's own label for a rental is "rent". This
 *   compared against "lease" alone, so a pure rental listing was finalised as a
 *   sale too — which is the case that has been live longest.
 *
 *   `offerMode` is what the buyer actually paid for. farm-nation-payment.ts
 *   resolves it against the LISTING's flags and writes it onto the transaction,
 *   so it cannot be named by a caller, and it is the only record of which of
 *   two offers was taken.
 *
 * ── AND THE PART THAT MOVES LAND ────────────────────────────────────────────
 *
 *   `ownerId: txData.buyerId` ran for BOTH branches. Renting a parcel made the
 *   tenant its owner — not a bookkeeping nicety, because `ownerId` is what this
 *   platform means by whose land it is: /farm-nation/my-properties queries it,
 *   _fn_listings gates EDITING on it, and every offer and inquiry door reads it
 *   to find the counterparty. The landowner's parcel left their dashboard and
 *   the tenant could edit the listing.
 *
 *   EXECUTED, not scanned — a source check cannot tell whether a branch is
 *   reached, and the whole finding is about which branch runs.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));
//   BOTH exports this action reaches. audit-log-mock-is-complete requires a
//   local override to cover every name its own suite calls, and my first draft
//   named one of two — so `createAdminAuditLog` would have been undefined and
//   the failure would have read as a fault in the action.
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: async () => undefined,
    createAdminAuditLog: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

//   The money primitive. Not the subject here, and it reaches a wallet ledger
//   with its own suites; stubbed so this file is about the title and the status.
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: async () => ({ credited: true }),
}));

/**
 *   The CAS claim, against the fake store.
 *
 *   `claimStatusTransition` is a Supabase RPC, so unmocked it answers "fetch
 *   failed" here and the action never reaches the branch under test. The same
 *   shape an-inspection-nobody-had-to-do already uses — it performs the claim
 *   rather than asserting it, so the `from` guard is still real and a
 *   transaction in the wrong state is still refused.
 */
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: async (args: any) => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const ref = supabaseDb.collection(args.collection).doc(args.id);
        const snap = await ref.get();
        if (!snap.exists) return { claimed: false, status: null, exists: false };

        const status = (snap.data() ?? {}).status ?? null;
        if (status !== args.from) return { claimed: false, status, exists: true };

        await ref.update({ ...(args.patch ?? {}), status: args.to });
        return { claimed: true, status, exists: true };
    },
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const BUYER = 'buyer-1';
const LISTING = 'listing-1';
const TX = 'tx-1';

const asAdmin = () =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com', name: 'A' } },
        error: null,
    });

const seedListing = (over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.LAND_LISTINGS, LISTING, {
        id: LISTING,
        title: '2 hectares at Ugwuoba',
        ownerId: OWNER,
        ownerEmail: `${OWNER}@e.com`,
        status: 'pending_escrow',
        price: 5_000_000,
        rentPrice: 200_000,
        //   Offered BOTH ways, which is the owner's scenario — and the reason
        //   `type` is "sale" even when the rental is the offer taken.
        availableForSale: true,
        availableForRent: true,
        type: 'sale',
        ...over,
    });

const seedTransaction = (over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, TX, {
        id: TX,
        propertyId: LISTING,
        buyerId: BUYER,
        buyerEmail: `${BUYER}@e.com`,
        sellerId: OWNER,
        escrowAmount: 200_000,
        status: 'payment_confirmed',
        escrowStatus: 'held',
        ...over,
    });

const listing = () => store.get(COLLECTIONS.LAND_LISTINGS, LISTING) as Record<string, any>;

const release = async () => {
    const { releaseFarmNationEscrowAction } =
        await import('@/app/actions/farm-nation-admin/_fna_finance');
    return await releaseFarmNationEscrowAction(TX) as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    asAdmin();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#876 — the offer the buyer paid for is the offer that is recorded', () => {
    it('THE REPORTED CASE: a RENTAL on a parcel offered both ways is leased, not sold', async () => {
        /*
         *   The listing's own label is "sale" — #869's rule makes it so for any
         *   parcel that offers a sale at all. Only the transaction knows the
         *   buyer took the rental.
         */
        seedListing();
        seedTransaction({ offerMode: 'rent' });

        const res = await release();

        expect(res.success).toBe(true);
        expect(listing().status).toBe('leased');
    });

    it('AND A PURCHASE ON THE SAME LISTING IS SOLD — the control', async () => {
        //   Without this, "always leased" would satisfy the test above.
        seedListing();
        seedTransaction({ offerMode: 'buy' });

        await release();

        expect(listing().status).toBe('sold');
    });

    it('AND A PURE RENTAL LISTING IS LEASED, which the label alone never managed', async () => {
        /*
         *   Older than #869 and live longest: the form writes "rent", the check
         *   compared against "lease", so every rental was finalised as a sale.
         *   Both spellings are accepted now.
         */
        seedListing({ availableForSale: false, type: 'rent' });
        seedTransaction();   //   no offerMode — a transaction written before #869

        await release();

        expect(listing().status).toBe('leased');
    });

    it('AND A LEGACY "lease" LABEL STILL WORKS', async () => {
        seedListing({ availableForSale: false, type: 'lease' });
        seedTransaction();

        await release();

        expect(listing().status).toBe('leased');
    });

    it('AND A LEGACY SALE WITH NO offerMode IS STILL A SALE', async () => {
        //   The fallback must not turn old purchases into leases.
        seedListing({ availableForRent: false, type: 'sale' });
        seedTransaction();

        await release();

        expect(listing().status).toBe('sold');
    });

    it('AND THE TRANSACTION WINS OVER THE LABEL, not the other way round', async () => {
        /*
         *   The precedence, stated as a test: a listing labelled "sale" whose
         *   transaction says "rent" is a lease. This is the whole finding, and a
         *   fallback written the other way round would pass every test above
         *   except this one.
         */
        seedListing({ type: 'sale' });
        seedTransaction({ offerMode: 'rent' });

        await release();

        expect(listing().status).toBe('leased');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#876 — and renting a parcel does not hand over the title', () => {
    it('THE OWNER KEEPS THEIR LAND', async () => {
        /*
         *   `ownerId` is what /farm-nation/my-properties queries and what
         *   _fn_listings gates editing on. Transferring it on a lease took the
         *   parcel out of the owner's dashboard and let the TENANT edit the
         *   listing.
         */
        seedListing();
        seedTransaction({ offerMode: 'rent' });

        await release();

        expect(listing().ownerId).toBe(OWNER);
        expect(listing().ownerEmail).toBe(`${OWNER}@e.com`);
        expect(listing().previousOwnerId).toBeUndefined();
    });

    it('AND THE TENANCY IS STILL RECORDED, so who holds it is answerable', async () => {
        //   Not transferring is only right if the lease is written down.
        seedListing();
        seedTransaction({ offerMode: 'rent' });

        await release();

        expect(listing().leasedToId).toBe(BUYER);
        expect(listing().leasedToEmail).toBe(`${BUYER}@e.com`);
        expect(listing().leasedAt).toBeDefined();
    });

    it('AND A SALE STILL TRANSFERS IT — the control', async () => {
        /*
         *   The other half. A fix that simply stopped writing ownerId would pass
         *   the two tests above and break every purchase on the platform.
         */
        seedListing();
        seedTransaction({ offerMode: 'buy' });

        await release();

        expect(listing().ownerId).toBe(BUYER);
        expect(listing().previousOwnerId).toBe(OWNER);
        expect(listing().soldAt).toBeDefined();
        expect(listing().leasedToId).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#876 — and either way the parcel is off the market', () => {
    it('A LEASED PARCEL IS NEITHER PURCHASABLE NOR BROWSABLE', async () => {
        /*
         *   The owner's sentence, checked against the sets the queries actually
         *   use rather than against a screen. BROWSABLE_STATUSES is
         *   PURCHASABLE_STATUSES, and searchLandListingsAction filters
         *   `status in PURCHASABLE_STATUSES` before any flag filter — so the
         *   flags being left alone cannot put it back on sale.
         */
        const { PURCHASABLE_STATUSES, BROWSABLE_STATUSES, isPurchasable } =
            await import('@/lib/land-listing-status');

        seedListing();
        seedTransaction({ offerMode: 'rent' });
        await release();

        expect(isPurchasable(listing().status)).toBe(false);
        expect([...PURCHASABLE_STATUSES]).not.toContain('leased');
        expect([...BROWSABLE_STATUSES]).not.toContain('leased');
    });

    it('AND SO IS A SOLD ONE', async () => {
        const { isPurchasable } = await import('@/lib/land-listing-status');

        seedListing();
        seedTransaction({ offerMode: 'buy' });
        await release();

        expect(isPurchasable(listing().status)).toBe(false);
    });

    it('AND THE OTHER OFFER GOES WITH IT — one parcel, one outcome', async () => {
        /*
         *   THE POINT OF THE REPORT. The parcel was offered for sale AND for
         *   rent; the rental was taken; the SALE must not still be available.
         *
         *   It is the STATUS that achieves this, not the flags, and the flags
         *   are deliberately left alone: they are the owner's configuration of
         *   what this parcel may be offered as, and a lease that ends should not
         *   require them to be set up again.
         */
        seedListing();
        seedTransaction({ offerMode: 'rent' });
        await release();

        const after = listing();
        expect(after.availableForSale).toBe(true);        //   configuration kept
        expect(after.status).toBe('leased');              //   and no longer for sale
        const { isPurchasable } = await import('@/lib/land-listing-status');
        expect(isPurchasable(after.status)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#876 — and a tenancy freezes the terms it was agreed on', () => {
    it('`leased` IS IN BOTH TERMS-LOCKED LISTS', async () => {
        /*
         *   The list means "terms nobody may move now", and a tenant is paying
         *   against a size, a price and a category that were agreed. Only "sold"
         *   was named — and until the fix above a rental reached `sold` anyway,
         *   which is what hid the omission.
         *
         *   Both copies, because there are two editors of one set of terms and
         *   the files say so themselves.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments');

        for (const rel of [
            'src/app/actions/farm-nation/_fn_listings.ts',
            'src/app/actions/farm-nation-admin/_fna_verifications.ts',
        ]) {
            const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });
            const at = src.indexOf('TERMS_LOCKED_IN');
            const block = src.slice(at, at + 400);

            expect({ rel, sold: block.includes('"sold"') }).toEqual({ rel, sold: true });
            expect({ rel, leased: block.includes('"leased"') }).toEqual({ rel, leased: true });
        }
    });
});
