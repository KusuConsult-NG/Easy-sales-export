/**
 * @jest-environment node
 */

/**
 *   #649 THE JOB THAT GIVES A PARCEL BACK, EXECUTED.
 *
 *   `cron/release-stale-reservations` is 269 lines that run unattended, on a
 *   schedule, over the land listings collection — and no test had ever called
 *   it. It was named in two places (the cron manifest, and a route-count list)
 *   and run by nothing.
 *
 *   That matters more here than it would almost anywhere else, because of what
 *   #140 records: A RESERVATION HOLD HAS NO OTHER EXIT. Two paths take a parcel
 *   off the market for one buyer; both release it if their own next write fails;
 *   the buyer can cancel. Nothing releases a hold the buyer simply abandoned,
 *   and #137 deliberately stopped an admin approval from overwriting `pending`
 *   so that an approval could not seize a parcel somebody was paying for. Every
 *   one of those guards is right, and together they leave this job as the only
 *   way a walked-away hold ever comes back.
 *
 *   So a defect in this file is not a degraded feature. It is a parcel off the
 *   market permanently, an owner who cannot relist, and no buyer able to claim.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS BEHAVIOUR RATHER THAN SHAPE ───────
 *
 *   The route's two guards are the whole of its safety, and neither can be
 *   checked by reading source:
 *
 *     THE CAS CLAIM    it moves a listing only OUT OF the exact status it read,
 *                      so a payment landing between the read and the write makes
 *                      the claim refuse.
 *     THE PAYMENT CHECK  before releasing anything it reads the property's
 *                      transaction rows, because `pending_escrow` is written
 *                      BEFORE Paystack is called — a buyer can pay while the
 *                      listing still reads `pending_escrow`, and a late or lost
 *                      callback would leave a PAID-FOR parcel in a hold this
 *                      sweep would otherwise put back on the open market.
 *
 *   Both are executed here against a stateful store, so the assertions are about
 *   what the collection says afterwards rather than about which functions the
 *   file mentions.
 *
 *   THE PAYMENT CHECK'S FAIL-SAFE DIRECTION IS PINNED TOO. Its catch returns
 *   "the payment check could not be completed" — evidence of payment — so a
 *   database error holds the parcel rather than releasing it. A refactor that
 *   made that `return null` would be invisible in the diff and would release
 *   paid parcels the first time the transactions read failed.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { RESERVATION_HOLD_HOURS } from '@/lib/land-reservation-expiry';

const notify = jest.fn() as jest.Mock<any>;
jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...a: any[]) => notify(...a),
}));

/**
 * ── THE CAS CLAIM IS MODELLED, AND THE FIRST DRAFT OF THIS FILE DID NOT ─────
 *
 *   `claimStatusTransition` is a Postgres function called over HTTP. The fake
 *   database does not intercept that, so every release case in the first run of
 *   this suite failed with
 *
 *       Status transition failed: TypeError: fetch failed
 *
 *   and the job reported `failed: 1` — which reads exactly like a defect and is
 *   not one. Worth recording, because eight failing assertions against an
 *   unexecuted money path is precisely the moment to check the instrument
 *   before believing it. The nine that PASSED were the refusals and the
 *   skip paths, none of which reach the claim; that split is what gave it away.
 *
 *   The stand-in below implements the property the route depends on rather than
 *   a stub that always succeeds: it claims ONLY when the row's current status is
 *   one of `fromAny`, and it filters the target out of the starting set exactly
 *   as the real function does, so `to → to` is not a transition. The real
 *   function's own concurrency guarantees are covered against a live PostgreSQL
 *   in __tests__/db-integration/land-status-transition-guard.test.ts; what is
 *   under test here is the route's use of it.
 */
let mockStoreRef: FakeDbHandle;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: async (params: any) => {
        const { collection, id, fromAny, to, patch } = params;
        const doc = mockStoreRef.get(collection, id);
        if (!doc) return { claimed: false, status: null, exists: false };
        const current = String(doc.status ?? '');
        const startingPoints = (fromAny as string[]).filter((f) => f !== to);
        if (!startingPoints.includes(current)) return { claimed: false, status: current, exists: true };
        mockStoreRef.seed(collection, id, { ...doc, ...(patch ?? {}), status: to });
        return { claimed: true, status: current, exists: true };
    },
}));

const SECRET = 'cron-secret-for-tests';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const TX = COLLECTIONS.FARM_NATION_TRANSACTIONS;
const PROCESSED = COLLECTIONS.PROCESSED_PAYMENTS;

let store: FakeDbHandle;

/** `hours` ago, as an ISO string. */
const agoISO = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

function seedHold(id: string, over: Record<string, unknown> = {}): void {
    store.seed(LISTINGS, id, {
        title: 'Two hectares at Epe',
        ownerId: 'owner-1',
        status: 'pending',
        previousStatus: 'verified',
        pendingBuyerId: 'buyer-1',
        pendingSince: agoISO(RESERVATION_HOLD_HOURS.pending + 24),
        ...over,
    });
}

const cron = async (auth: string | null = `Bearer ${SECRET}`) => {
    const { GET } = await import('@/app/api/cron/release-stale-reservations/route');
    //   #659 — `Headers.get` is CASE-INSENSITIVE and this double was not, so it
    //   answered only the exact spelling the route happened to use. Five doubles
    //   modelled it that way and seven already lowercased; the five were a hidden
    //   coupling to one route's casing rather than a model of the real thing.
    const req = { headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null) } };
    const res = await GET(req as any);
    return { status: res.status, body: await res.json() as any };
};

const listing = (id: string) => store.get(LISTINGS, id) as Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockStoreRef = store;
    process.env.CRON_SECRET = SECRET;
    notify.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#649 — the abandoned hold comes back', () => {
    it('RELEASES A LAPSED HOLD TO THE STATUS IT WAS RESERVED FROM', async () => {
        /*
         *   THE point of the job. And `verified` rather than `available` is the
         *   point of statusAfterCancellation: a listing reserved from the
         *   admin-approved state must go back to it, or an approved parcel
         *   quietly drops out of the land module's public view.
         */
        seedHold('L1');

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(listing('L1').status).toBe('verified');
    });

    it('AND CLEARS EVERY FIELD THAT DESCRIBED THE HOLD', async () => {
        /*
         *   `pendingSince` outliving the hold is how a sweep keyed on it comes
         *   to release the wrong row later — the reason releasedReservationFields
         *   exists and all four release paths share it.
         */
        seedHold('L1');

        await cron();

        const after = listing('L1');
        expect({
            pendingBuyerId: after.pendingBuyerId,
            pendingSince: after.pendingSince,
            previousStatus: after.previousStatus,
        }).toEqual({ pendingBuyerId: null, pendingSince: null, previousStatus: null });
        expect(typeof after.reservationLapsedAt).toBe('string');
    });

    it('AND TELLS THE BUYER, with a link to a page that exists', async () => {
        //   #51's defect was every escrow notification pointing at a 404.
        seedHold('L1');

        await cron();

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toMatchObject({
            userId: 'buyer-1', type: 'land', link: '/farm-nation/property/L1',
        });
    });

    it('AND FALLS BACK TO available WHEN NOTHING RECORDED WHERE IT CAME FROM', async () => {
        //   Rows reserved before previousStatus was recorded. `available` is
        //   purchasable, so the parcel is genuinely back on the market.
        seedHold('L1', { previousStatus: undefined });

        await cron();

        expect(listing('L1').status).toBe('available');
    });

    it('AND SWEEPS THE SHORT HOLD ON ITS OWN, SHORTER CLOCK', async () => {
        /*
         *   Two windows, because a hold is not one thing: `pending_escrow` means
         *   the buyer is on the Paystack page right now (two hours), `pending`
         *   means payment is being arranged between people (seven days). A
         *   single threshold would either release checkout sessions far too late
         *   or purchase requests far too early.
         */
        seedHold('L1', {
            status: 'pending_escrow',
            pendingSince: agoISO(RESERVATION_HOLD_HOURS.pending_escrow + 1),
        });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(listing('L1').status).toBe('verified');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#649 — and everything else is left exactly where it is', () => {
    it('A HOLD STILL INSIDE ITS WINDOW IS UNTOUCHED — the control', async () => {
        //   Every assertion in the block above is satisfied by a job that
        //   releases everything it finds, which is #135 rebuilt: two buyers,
        //   two escrows, one parcel.
        seedHold('L1', { pendingSince: agoISO(1) });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(listing('L1').status).toBe('pending');
        expect(listing('L1').pendingBuyerId).toBe('buyer-1');
        expect(notify).not.toHaveBeenCalled();
    });

    it('AND A SHORT HOLD IS NOT JUDGED BY THE LONG CLOCK', async () => {
        //   The pair of the case above: three hours is lapsed for pending_escrow
         //  and nowhere near it for pending. One threshold for both would be
        //   wrong in one direction or the other.
        seedHold('L1', { status: 'pending', pendingSince: agoISO(3) });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(listing('L1').status).toBe('pending');
    });

    it('AND A LISTING THAT IS NOT HELD AT ALL IS NEVER EXAMINED', async () => {
        store.seed(LISTINGS, 'L1', {
            status: 'verified', ownerId: 'owner-1', pendingSince: agoISO(1000),
        });

        const { body } = await cron();

        expect({ examined: body.examined, released: body.released })
            .toEqual({ examined: 0, released: 0 });
        expect(listing('L1').status).toBe('verified');
    });

    it('AND A HOLD NOBODY CAN DATE IS REPORTED, NOT GUESSED AT', async () => {
        /*
         *   Both writers stamp `pendingSince`, so there should be none. One
         *   appearing means a row was written by something that does not — and
         *   that row can never be swept, which is exactly what an operator needs
         *   told rather than silently passed over.
         */
        seedHold('L1', { pendingSince: undefined });

        const { body } = await cron();

        expect({ undatable: body.undatable, released: body.released })
            .toEqual({ undatable: 1, released: 0 });
        expect(body.undatableIds).toEqual(['L1']);
        expect(listing('L1').status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#649 — a parcel with money against it is never put back on sale', () => {
    it('A TRANSACTION PAST pending_payment HOLDS THE PARCEL', async () => {
        /*
         *   THE guard that the CAS claim cannot provide. `pending_escrow` is
         *   written BEFORE Paystack is called, so a buyer can pay while the
         *   listing still reads `pending_escrow` and it stays that way until the
         *   callback runs. A late, lost or failed callback would otherwise leave
         *   a PAID-FOR parcel for this sweep to put back on the open market.
         */
        seedHold('L1', {
            status: 'pending_escrow',
            pendingSince: agoISO(RESERVATION_HOLD_HOURS.pending_escrow + 5),
        });
        store.seed(TX, 'tx-1', { propertyId: 'L1', buyerId: 'buyer-1', status: 'pending_escrow' });

        const { body } = await cron();

        expect({ released: body.released, paidButHeld: body.paidButHeld })
            .toEqual({ released: 0, paidButHeld: 1 });
        expect(listing('L1').status).toBe('pending_escrow');
        expect(String(body.paidButHeldIds[0].because)).toMatch(/pending_escrow/);
    });

    it('AND SO DOES A REFERENCE PAYSTACK HAS ALREADY SETTLED', async () => {
        //   The second half: a row still reading pending_payment whose reference
        //   is in processed_payments. The money arrived; the row has not caught
        //   up yet.
        seedHold('L1');
        store.seed(TX, 'tx-1', {
            propertyId: 'L1', status: 'pending_payment', paymentReference: 'ref-abc',
        });
        store.seed(PROCESSED, 'ref-abc', { reference: 'ref-abc', amount: 100 });

        const { body } = await cron();

        expect({ released: body.released, paidButHeld: body.paidButHeld })
            .toEqual({ released: 0, paidButHeld: 1 });
        expect(listing('L1').status).toBe('pending');
    });

    it('AND AN UNPAID OR CANCELLED REQUEST DOES NOT — the control', async () => {
        /*
         *   Without this, "never release when a transaction exists" would pass
         *   every assertion above while restoring #140 in full: a buyer who
         *   raises a purchase request and walks away leaves a row behind, and
         *   that row is precisely the abandoned case this job is for.
         */
        seedHold('L1');
        store.seed(TX, 'tx-1', { propertyId: 'L1', status: 'pending_payment' });
        store.seed(TX, 'tx-2', { propertyId: 'L1', status: 'cancelled' });

        const { body } = await cron();

        expect({ released: body.released, paidButHeld: body.paidButHeld })
            .toEqual({ released: 1, paidButHeld: 0 });
        expect(listing('L1').status).toBe('verified');
    });

    it('AND THE CLAIM REFUSES WHEN THE LISTING MOVED UNDER IT', async () => {
        /*
         *   THE FIRST GUARD, and nothing exercised it until a surviving mutant
         *   said so. The route claims `fromAny: [heldStatus]` — the status this
         *   row was ACTUALLY IN when the snapshot was read — rather than "any
         *   hold status". Widening that to the whole set survived every other
         *   assertion in this file.
         *
         *   What it costs is the case the route's own header describes: a
         *   payment landing between the read and the write. The payment check is
         *   the await in between, so that is where the listing is moved here —
         *   from `pending` to `pending_escrow`, both of them hold statuses, so a
         *   claim that accepted either would release a parcel whose buyer had
         *   just committed.
         *
         *   The assertion is self-validating: `skipped` can only be 1 if the
         *   move landed AFTER the lapse verdict and BEFORE the claim. Too early
         *   or too late and the release succeeds, which is the failure this
         *   would otherwise hide.
         */
        seedHold('L1');
        const originalGet = (global as any).mockFirestoreGet.getMockImplementation();
        let calls = 0;
        (global as any).mockFirestoreGet.mockImplementation((...args: any[]) => {
            calls += 1;
            if (calls === 2) {
                store.seed(LISTINGS, 'L1', { ...store.get(LISTINGS, 'L1')!, status: 'pending_escrow' });
            }
            return originalGet(...args);
        });

        const { body } = await cron();

        expect({ released: body.released, skipped: body.skipped })
            .toEqual({ released: 0, skipped: 1 });
        expect(listing('L1').status).toBe('pending_escrow');
        expect(listing('L1').pendingBuyerId).toBe('buyer-1');
    });

    it("AND ANOTHER PROPERTY'S PAYMENT IS NOT THIS PROPERTY'S", async () => {
        //   The query filters on propertyId. A fake that ignored `where` would
        //   make the assertion above pass while the real job held every parcel
        //   the moment any payment existed anywhere.
        seedHold('L1');
        store.seed(TX, 'tx-1', { propertyId: 'OTHER', status: 'payment_confirmed' });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(listing('L1').status).toBe('verified');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#649 — and the run refuses callers and survives bad rows', () => {
    it('REFUSES A REQUEST WITHOUT THE SECRET', async () => {
        seedHold('L1');

        const res = await cron(null);

        expect(res.status).toBe(401);
        expect(listing('L1').status).toBe('pending');
    });

    it('AND REFUSES THE WRONG SECRET', async () => {
        seedHold('L1');

        const res = await cron('Bearer not-the-secret');

        expect(res.status).toBe(401);
        expect(listing('L1').status).toBe('pending');
    });

    it('AND REFUSES TO RUN AT ALL WHEN NO SECRET IS CONFIGURED', async () => {
        //   Fail closed. An unset secret must not mean an open endpoint — the
        //   shape #645 pinned across all four webhook receivers.
        delete process.env.CRON_SECRET;
        seedHold('L1');

        const res = await cron('Bearer anything');

        expect(res.status).toBe(500);
        expect(listing('L1').status).toBe('pending');

        process.env.CRON_SECRET = SECRET;
    });

    it('AND ONE UNREADABLE ROW DOES NOT STOP THE REST', async () => {
        /*
         *   #298/#299's rule. The listings are swept in a loop, and a row that
         *   throws must be reported rather than ending the run — otherwise one
         *   bad parcel freezes every other owner's listing indefinitely.
         *
         *   Provoked through the payment check, whose own catch is the code
         *   under test here: it returns "could not be completed", which counts
         *   as evidence of payment, so the parcel is HELD rather than released.
         *   That direction is the safe one and is the thing being pinned — a
         *   refactor to `return null` would release paid parcels the first time
         *   this read failed.
         */
        seedHold('L1');
        seedHold('L2');
        const real = store.get.bind(store);
        void real;
        const originalGet = (global as any).mockFirestoreGet.getMockImplementation();
        let calls = 0;
        (global as any).mockFirestoreGet.mockImplementation((...args: any[]) => {
            calls += 1;
            //   Fail one transactions read, part-way through, and let the rest
            //   behave normally.
            if (calls === 3) return Promise.reject(new Error('connection reset'));
            return originalGet(...args);
        });

        const { body } = await cron();

        expect(body.examined).toBe(2);
        //   One held because its check could not run, one released normally.
        expect(body.released + body.paidButHeld).toBe(2);
        expect(body.paidButHeld).toBe(1);
        expect(String(body.paidButHeldIds[0].because)).toMatch(/could not be completed/i);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE CLOCK IS IGNORED — every hold is released                   KILLED
 *     the payment check is skipped entirely                           KILLED
 *     a failed payment check reports clean instead of holding         KILLED
 *     a cancelled request now counts as money arriving                KILLED
 *     the payment lookup stops filtering by property                  KILLED
 *     a settled reference no longer holds the parcel                  KILLED
 *     an undatable hold is released instead of reported               KILLED
 *     the CAS claim accepts any hold status, not the one read         KILLED
 *     the restored status ignores where it came from                  KILLED
 *     the cron secret stops being required                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   No defect was found in this route. That is the result, and it is worth
 *   stating plainly rather than dressing up: 269 lines that move land listings
 *   unattended were correct on every axis this suite could reach. What changes
 *   is that they are now held there — the table above is the list of ways this
 *   job could have started quietly putting paid-for parcels back on the market,
 *   and each of them now fails a test instead.
 *
 * ── ONE MUTANT SURVIVED THE FIRST RUN, AND IT WAS THE ROUTE'S OWN FIRST GUARD ─
 *
 *   "The CAS claim accepts any hold status, not the one read" survived
 *   everything. The route claims `fromAny: [heldStatus]` — the status the row
 *   was ACTUALLY IN when the snapshot was taken — and widening that to the whole
 *   hold set passed every assertion here, because no case moved a listing
 *   between the read and the write.
 *
 *   That is the exact scenario the route's header is about, so the test was
 *   silent on the thing the code was most careful about. A case that moves the
 *   listing during the payment check — the one await in between — closes it.
 *
 *   The general lesson, for the third time in this audit: a suite that exercises
 *   every branch can still be silent on the property the code exists to have.
 *   Mutation testing is what tells them apart.
 */
