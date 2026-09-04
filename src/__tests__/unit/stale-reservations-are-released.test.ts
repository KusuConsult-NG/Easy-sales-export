/**
 * @jest-environment node
 */

/**
 *   #140 A PROPERTY RESERVATION NEVER EXPIRED, AND `pendingSince` WAS WRITTEN
 *        FOR EXACTLY THAT AND READ BY NOTHING.
 *
 *        Two paths take a parcel off the market for one buyer, and both stamp
 *        the moment they do it:
 *
 *          _fn_purchases.ts        PURCHASABLE → "pending"
 *          farm-nation-payment.ts  PURCHASABLE → "pending_escrow"
 *
 *        Both release on their own write failure (#136, #139), and the buyer
 *        can cancel (#138). NOTHING RELEASED A HOLD THE BUYER ABANDONED. A scan
 *        for a reader of `pendingSince` returned one hit: the sentence in
 *        land-listing-status.ts recording that it had none.
 *
 *        So closing the checkout tab took the parcel off the market for good:
 *
 *          the owner cannot relist it;
 *          no other buyer can claim it, because a claim starts from
 *            PURCHASABLE_STATUSES and the listing is not in one;
 *          no admin can free it, because #137 deliberately removed "pending"
 *            from the statuses an approval may overwrite — so that an approval
 *            could not seize a parcel somebody was paying for.
 *
 *        Every one of those guards is correct. Together they left the abandoned
 *        case with no exit at all.
 *
 *   WHY AN EXPIRY IS RIGHT HERE AND WAS REFUSED FOR #196
 *
 *        #196 declined to expire export bookings because nothing recorded an
 *        agreed deadline and an expiry would have had to invent one. Here the
 *        fact exists, is written by both paths, and was written for this.
 *
 *   WHAT MAKES IT SAFE IS TWO GUARDS, NOT THE CLOCK
 *
 *        Releasing a hold while money is in flight would rebuild #135 — two
 *        buyers, two escrows, one parcel.
 *
 *        The CAS claim is the first: the sweep moves a listing only out of the
 *        exact hold status it read, so a payment that has landed and been
 *        processed makes the claim refuse.
 *
 *        The PAYMENT CHECK is the second, and writing this suite is what showed
 *        it was needed. The draft asserted that no hold status appears in
 *        #137's DECISION_LOCKED_STATUSES — the statuses meaning "a buyer has
 *        committed" — and the assertion failed: `pending_escrow` is one of
 *        them. It is written BEFORE Paystack is called, so a buyer can pay
 *        while the listing still reads `pending_escrow`, and it stays that way
 *        until the callback runs claimPaymentOnce. A late or lost callback
 *        would leave a PAID-FOR parcel in a hold the clock alone would release
 *        onto the open market.
 *
 *        So the sweep reads the property's transaction rows first, and a hold
 *        with money against it is reported as `paidButHeld` and never released.
 *        That is a stuck fulfilment for cron/reconcile-fulfilment and a human.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    RESERVATION_HOLD_HOURS,
    RESERVATION_HOLD_STATUSES,
    reservationHasLapsed,
    reservationStartedAt,
    releasedReservationFields,
    isReservationHold,
} from '@/lib/land-reservation-expiry';
import { PURCHASABLE_STATUSES, DECISION_LOCKED_STATUSES } from '@/lib/land-listing-status';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaim(...a),
}));

const mockNotify = jest.fn() as jest.Mock<any>;
jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...a: any[]) => mockNotify(...a),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const EXPIRY_LIB = 'src/lib/land-reservation-expiry.ts';
const CRON = 'src/app/api/cron/release-stale-reservations/route.ts';
const PURCHASES = 'src/app/actions/farm-nation/_fn_purchases.ts';
const PAYMENT = 'src/app/actions/farm-nation-payment.ts';

const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const SECRET = 'cron-secret-for-tests';
const BUYER = 'buyer-1';

let store: FakeDbHandle;

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

/** Hours ago, as the ISO string both reservation paths write. */
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

function seedHold(id: string, over: Record<string, unknown> = {}): void {
    store.seed(LISTINGS, id, {
        name: 'Ikorodu Farmland', price: 4_500_000, ownerId: 'owner-1',
        status: 'pending_escrow',
        pendingBuyerId: BUYER,
        pendingSince: hoursAgo(48),
        previousStatus: 'verified',
        ...over,
    });
}

const cron = async (auth: string | null = `Bearer ${SECRET}`) => {
    const { GET } = await import('@/app/api/cron/release-stale-reservations/route');
    const req = { headers: { get: (k: string) => (k === 'authorization' ? auth : null) } };
    const res = await GET(req as any);
    return { status: res.status, body: await res.json() };
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.CRON_SECRET = SECRET;
    mockClaim.mockResolvedValue({ claimed: true, status: 'pending_escrow' });
    mockNotify.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#140 — the rule for when a hold has lapsed', () => {
    it('the two hold statuses are the two the reservation paths actually write', () => {
        // Measured against the writers, not remembered. A third hold status
        // added later without a window here would never be swept.
        expect([...RESERVATION_HOLD_STATUSES].sort()).toEqual(['pending', 'pending_escrow']);
        expect(source(PURCHASES)).toContain('to: "pending",');
        expect(source(PAYMENT)).toContain('to: "pending_escrow",');
    });

    it('and NEITHER of them is a purchasable status — a hold is off the market', () => {
        // The premise of the whole finding: while held, no other buyer can
        // claim it, because every claim starts from PURCHASABLE_STATUSES.
        for (const held of RESERVATION_HOLD_STATUSES) {
            expect({ held, purchasable: (PURCHASABLE_STATUSES as readonly string[]).includes(held) })
                .toEqual({ held, purchasable: false });
        }
    });

    it('THE PAYSTACK HOLD IS THE SHORT ONE — the buyer is on the payment page', () => {
        expect(RESERVATION_HOLD_HOURS.pending_escrow).toBe(2);
        // And the request hold is days, because payment is arranged between
        // people. Asserted as an ordering as well as values, so a later edit
        // cannot make the checkout hold outlive the request hold.
        expect(RESERVATION_HOLD_HOURS.pending).toBe(24 * 7);
        expect(RESERVATION_HOLD_HOURS.pending_escrow)
            .toBeLessThan(RESERVATION_HOLD_HOURS.pending);
    });

    it('a hold inside its window has NOT lapsed', () => {
        expect(reservationHasLapsed({ status: 'pending_escrow', pendingSince: hoursAgo(1) }))
            .toEqual({ lapsed: false, reason: 'still_within_window' });
        expect(reservationHasLapsed({ status: 'pending', pendingSince: hoursAgo(24 * 6) }))
            .toEqual({ lapsed: false, reason: 'still_within_window' });
    });

    it('and one past it HAS', () => {
        const v = reservationHasLapsed({ status: 'pending_escrow', pendingSince: hoursAgo(3) });

        expect(v.lapsed).toBe(true);
        expect((v as any).allowedHours).toBe(2);
        expect((v as any).heldForHours).toBeGreaterThan(2);
    });

    it('exactly AT the threshold is not lapsed — the boundary is inclusive of the hold', () => {
        // A hold released at exactly its limit is released a moment early; the
        // asymmetry of the costs (an early release rebuilds #135) says to wait.
        const exactly = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

        expect(reservationHasLapsed(
            { status: 'pending_escrow', pendingSince: exactly },
            new Date(new Date(exactly).getTime() + 2 * 60 * 60 * 1000),
        ).lapsed).toBe(false);
    });

    it('A STATUS THAT IS NOT A HOLD IS NEVER SWEPT, however old', () => {
        for (const settled of ['sold', 'leased', 'verified', 'available', 'pending_payment', 'pending_transfer']) {
            expect({ settled, verdict: reservationHasLapsed({ status: settled, pendingSince: hoursAgo(10_000) }) })
                .toEqual({ settled, verdict: { lapsed: false, reason: 'not_a_hold' } });
        }
        expect(isReservationHold('sold')).toBe(false);
        expect(isReservationHold('verified')).toBe(false);
    });

    it('AND pending_escrow IS A DECISION-LOCKED STATUS — which is why the clock is not enough', () => {
        // My first draft asserted the opposite: that no hold status appears in
        // #137's list of statuses meaning "a buyer has committed". It does.
        //
        // pending_escrow is written BEFORE Paystack is called, so a buyer can
        // pay while the listing still reads pending_escrow, and it stays that
        // way until the callback runs claimPaymentOnce. A late or lost callback
        // therefore leaves a PAID-FOR parcel in a hold. Releasing on the clock
        // alone would put it back on the open market — #135 rebuilt.
        //
        // Recorded here rather than quietly patched away, because it is the
        // reason the sweep reads the payment record before it releases
        // anything. The behaviour is pinned in "THE SWEEP" below.
        expect(DECISION_LOCKED_STATUSES).toContain('pending_escrow');

        const stillHoldStatuses = RESERVATION_HOLD_STATUSES
            .filter((s) => (DECISION_LOCKED_STATUSES as readonly string[]).includes(s));
        expect(stillHoldStatuses).toEqual(['pending_escrow']);
    });

    it('and a hold with NO timestamp is left alone, reported rather than guessed at', () => {
        for (const pendingSince of [undefined, null, '', 'soon', NaN]) {
            expect(reservationHasLapsed({ status: 'pending_escrow', pendingSince }))
                .toEqual({ lapsed: false, reason: 'no_timestamp' });
        }
    });

    it('the timestamp is read as a Firestore Timestamp as readily as an ISO string', () => {
        const iso = hoursAgo(5);
        const asTimestamp = { toDate: () => new Date(iso) };

        expect(reservationStartedAt(asTimestamp)?.toISOString()).toBe(iso);
        expect(reservationHasLapsed({ status: 'pending_escrow', pendingSince: asTimestamp }).lapsed)
            .toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#140 — `pendingSince` no longer outlives the hold it dates', () => {
    it('ONE DEFINITION of what leaving a hold clears', () => {
        expect(releasedReservationFields())
            .toEqual({ pendingBuyerId: null, pendingSince: null, previousStatus: null });
    });

    it('and all four release paths use it, rather than each listing the fields', () => {
        // The three that existed cleared pendingBuyerId and previousStatus and
        // LEFT THE TIMESTAMP BEHIND, so a released listing carried the date of
        // a hold it no longer had — the field a sweep keys on.
        const users = sourceFiles().filter((f) => source(f).includes('releasedReservationFields()'));

        expect(users).toEqual([CRON, PAYMENT, PURCHASES, EXPIRY_LIB].sort());
    });

    it('and none of them still writes the old hand-listed pair', () => {
        for (const file of [PURCHASES, PAYMENT]) {
            const src = source(file);
            expect({ file, handListed: /pendingBuyerId: null,\s*\n\s*previousStatus: null,/.test(src) })
                .toEqual({ file, handListed: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#140 — THE SWEEP', () => {
    it('refuses without the shared secret, and without one configured', async () => {
        seedHold('p1');

        expect((await cron(null)).status).toBe(401);
        expect((await cron('Bearer wrong')).status).toBe(401);

        delete process.env.CRON_SECRET;
        expect((await cron('Bearer anything')).status).toBe(500);

        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('RELEASES AN ABANDONED HOLD — the whole finding, as one assertion', async () => {
        seedHold('p1', { pendingSince: hoursAgo(48) });

        const { body } = await cron();

        expect(body.released).toBe(1);
        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args).toMatchObject({ collection: LISTINGS, id: 'p1' });
        // Restored to what it was reserved FROM, not to a guessed status.
        expect(args.to).toBe('verified');
        expect(args.patch).toMatchObject(releasedReservationFields());
        expect(typeof args.patch.reservationLapsedAt).toBe('string');
    });

    it('ONLY OUT OF THE STATUS IT READ — a payment that landed makes the claim refuse', async () => {
        // THE safety property, at the sweep level. `fromAny` is the single
        // status this row was actually in, so anything that moved on is safe.
        seedHold('p1', { status: 'pending_escrow' });

        await cron();

        expect((mockClaim.mock.calls[0] as [any])[0].fromAny).toEqual(['pending_escrow']);
    });

    it('and a refused claim is a skip, not a release and not a failure', async () => {
        seedHold('p1');
        mockClaim.mockResolvedValue({ claimed: false, status: 'sold' });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(body.skipped).toBe(1);
        expect(body.failed).toBe(0);
        expect(body.success).toBe(true);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('WILL NOT RELEASE A PARCEL THAT WAS PAID FOR — the second guard', async () => {
        // THE test for the hazard above. The listing still reads
        // pending_escrow because the callback has not run; the transaction row
        // says the money arrived. Releasing here puts a paid-for parcel back on
        // the market.
        seedHold('paid');
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-1', {
            propertyId: 'paid', buyerId: BUYER, status: 'completed',
            paymentReference: 'ref-1',
        });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(body.paidButHeld).toBe(1);
        expect(body.paidButHeldIds[0].id).toBe('paid');
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('nor one whose reference Paystack has already settled', async () => {
        // The narrower window: the transaction row has NOT been moved on, but
        // claimPaymentOnce wrote its processedPayments entry.
        seedHold('paid');
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-1', {
            propertyId: 'paid', buyerId: BUYER, status: 'pending_payment',
            paymentReference: 'ref-1',
        });
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'ref-1', { amount: 4_500_000 });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(body.paidButHeld).toBe(1);
        expect(body.paidButHeldIds[0].because).toContain('ref-1');
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('and a payment check that CANNOT RUN is treated as evidence of payment', async () => {
        // The direction a failing check must fail in. Releasing a parcel
        // because we could not tell whether it was paid for is the one outcome
        // worse than holding an abandoned one another cycle — so an unreadable
        // transaction table keeps the hold, and says so.
        seedHold('unknown');

        const { supabaseDb } = await import('@/lib/supabase-db');
        const real = supabaseDb.collection.bind(supabaseDb);
        const spy = jest
            .spyOn(supabaseDb, 'collection')
            .mockImplementation(((name: string) => {
                if (name === COLLECTIONS.FARM_NATION_TRANSACTIONS) {
                    throw new Error('transactions table unreachable');
                }
                return real(name);
            }) as any);

        try {
            const { body } = await cron();

            expect(body.released).toBe(0);
            expect(body.paidButHeld).toBe(1);
            expect(body.paidButHeldIds[0].because).toContain('could not be completed');
            expect(mockClaim).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it('but DOES release one whose only transaction is still unpaid', async () => {
        // Vacuity guard on the two above: a check that refused everything would
        // pass them both and make the whole sweep inert.
        seedHold('abandoned');
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-1', {
            propertyId: 'abandoned', buyerId: BUYER, status: 'pending_payment',
            paymentReference: 'ref-unpaid',
        });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(body.paidButHeld).toBe(0);
    });

    it('and a CANCELLED transaction is not evidence of payment', async () => {
        seedHold('abandoned');
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-1', {
            propertyId: 'abandoned', buyerId: BUYER, status: 'cancelled',
        });

        expect((await cron()).body.released).toBe(1);
    });

    it('LEAVES A HOLD INSIDE ITS WINDOW ALONE', async () => {
        seedHold('fresh', { pendingSince: hoursAgo(1) });

        const { body } = await cron();

        expect(body.released).toBe(0);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('applies the RIGHT window to each status, not one window to both', async () => {
        // A 48-hour-old checkout hold has lapsed; a 48-hour-old request hold
        // has not. One threshold for both would get one of them wrong.
        seedHold('checkout', { status: 'pending_escrow', pendingSince: hoursAgo(48) });
        seedHold('request', { status: 'pending', pendingSince: hoursAgo(48) });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect((mockClaim.mock.calls[0] as [any])[0].id).toBe('checkout');
    });

    it('restores a listing reserved from "available" to "available"', async () => {
        // statusAfterCancellation's rule, shared with the buyer's own cancel: a
        // farm-nation listing must not come back as "verified" and a land
        // listing must not come back as "available" and vanish from its view.
        seedHold('p1', { previousStatus: 'available' });

        await cron();

        expect((mockClaim.mock.calls[0] as [any])[0].to).toBe('available');
    });

    it('and one with an unusable previousStatus falls back rather than throwing', async () => {
        seedHold('p1', { previousStatus: 'nonsense' });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect((mockClaim.mock.calls[0] as [any])[0].to).toBe('available');
    });

    it('TELLS THE BUYER, and links to a route that exists', async () => {
        seedHold('p1');

        await cron();

        const [args] = mockNotify.mock.calls[0] as [any];
        expect(args.userId).toBe(BUYER);
        expect(args.title).toMatch(/Expired/i);
        expect(args.link).toBe('/farm-nation/property/p1');
    });

    it('and a failed notification does not undo a release that landed', async () => {
        seedHold('p1');
        mockNotify.mockRejectedValue(new Error('notifications down'));

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(body.success).toBe(true);
    });

    it('REPORTS A HOLD IT CANNOT DATE rather than passing over it in silence', async () => {
        // Both writers stamp pendingSince, so there should be none. One
        // appearing means a row nothing can ever sweep.
        seedHold('undatable', { pendingSince: null });

        const { body } = await cron();

        expect(body.undatable).toBe(1);
        expect(body.undatableIds).toEqual(['undatable']);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('one stuck listing does not stop the rest, and is named', async () => {
        seedHold('a');
        seedHold('b');
        mockClaim
            .mockRejectedValueOnce(new Error('row locked'))
            .mockResolvedValue({ claimed: true, status: 'pending_escrow' });

        const { body } = await cron();

        expect(body.released).toBe(1);
        expect(body.failed).toBe(1);
        expect(body.success).toBe(false);
        expect(body.failures[0]).toMatchObject({ id: 'a' });
        expect(body.failures[0].reason).toContain('row locked');
    });

    it('DELETES NOTHING and MOVES NO MONEY', async () => {
        seedHold('p1');

        await cron();

        const src = source(CRON);
        expect(src).not.toMatch(/\.delete\(|FieldValue\.delete|batch\.delete/);
        for (const forbidden of [
            'creditWalletOnce', 'debitJsonbBalance', 'claimPaymentOnce',
            'compensateJsonbDebit', 'initializePaystackPayment',
        ]) {
            expect({ forbidden, present: src.includes(forbidden) })
                .toEqual({ forbidden, present: false });
        }
        // And the listing keeps its fields.
        expect(store.get(LISTINGS, 'p1')).toMatchObject({ name: 'Ikorodu Farmland' });
    });

    it('caps its own run and says when there may be more', async () => {
        const src = source(CRON);

        expect(src).toContain('.limit(MAX_PER_RUN)');
        expect(src).toContain('mayHaveMore: snapshot.docs.length >= MAX_PER_RUN');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#140 — the premise, re-measured', () => {
    it('`pendingSince` HAS READERS NOW', () => {
        // #137's write-up recorded that it had none. The same sweep, inverted.
        const readers = sourceFiles().filter((f) =>
            /pendingSince/.test(source(f)) && f !== PURCHASES && f !== PAYMENT);

        expect(readers).toEqual([CRON, EXPIRY_LIB].sort());
    });

    it('and the rule module imports nothing, so a database mock cannot break it', () => {
        // #381's lesson, applied at the point of writing rather than after.
        expect(source(EXPIRY_LIB)).not.toMatch(/^import /m);
    });

    it('the sweeps read CODE, not the prose above it', () => {
        // The tombstone trap, guarded in both directions.
        const raw = readFileSync(join(ROOT, CRON), 'utf-8');

        expect(raw).toContain('A RESERVATION NEVER EXPIRED');
        expect(source(CRON)).not.toContain('A RESERVATION NEVER EXPIRED');
    });

    it('and the admin guard that made this unfixable by hand is still in place', () => {
        // #137: "pending" is deliberately NOT an approvable-from status, so an
        // approval cannot seize a parcel a buyer is paying for. This finding
        // must not have quietly relaxed that to make the sweep unnecessary.
        const { APPROVABLE_FROM_STATUSES, REJECTABLE_FROM_STATUSES } =
            jest.requireActual('@/lib/land-listing-status') as Record<string, readonly string[]>;

        for (const held of RESERVATION_HOLD_STATUSES) {
            expect({ held, approvable: APPROVABLE_FROM_STATUSES.includes(held) })
                .toEqual({ held, approvable: false });
            expect({ held, rejectable: REJECTABLE_FROM_STATUSES.includes(held) })
                .toEqual({ held, rejectable: false });
        }
    });
});
