/**
 * @jest-environment node
 */

/**
 *   #968 A BUYER WHO NEVER CAME BACK LEFT THE SELLER'S MONEY IN ESCROW FOR EVER,
 *        AND THE LOOP THAT WAS SUPPOSED TO PAY THEM HAD NEVER RUN ONCE.
 *
 *   api/cron/release-escrow had a loop for exactly this: release a "funded"
 *   escrow seven days after `releaseRequestedAt`. The only writer of that field
 *   was requestEscrowReleaseAction, and nothing called it — measured, and pinned
 *   by a test that walked the tree. So the loop selected nothing, every run,
 *   since it was written.
 *
 *   What that MEANT is the finding. A seller shipped real goods; the buyer never
 *   pressed Confirm; and no path existed that would ever move that money. Not a
 *   slow payout — no payout, unless an admin noticed and released by hand.
 *
 *   THE OWNER'S RULE, 2026-09-28: "on confirmation of the delivery, payout
 *   should be effected after 24hrs but if no confirmation and goods were sent
 *   out, payment should be done after 5days when goods were sent out."
 *
 *   So the trigger moves from a request nobody could make to the event that
 *   already happens — DISPATCH. This suite covers the half of that which had no
 *   test at all: the WRITE. api/cron/release-escrow's side is covered by
 *   auto-release-pays-the-net.test.ts, which executes the route.
 *
 * ── WHY THE WRITE IS THE DANGEROUS HALF ─────────────────────────────────────
 *
 *   The cron queries ESCROW_TRANSACTIONS and cannot join to the order, so
 *   `shippedAt` is denormalised onto the escrow rows when the seller marks the
 *   order shipped. The obvious way to write it is the way the SIBLING branch in
 *   the same function writes "delivered":
 *
 *       for (const escrowDoc of escrowDocs) {
 *           await escrowDoc.ref.update({ status: "delivered", ... });
 *       }
 *
 *   — every row the query returned, whatever state it is in. Copied for the
 *   dispatch stamp, that puts a live five-day payout deadline on a DISPUTED
 *   escrow, and on rows already released, refunded or cancelled. The dispute
 *   freeze would still refuse the claim, so the money would not actually move;
 *   but the row would carry a deadline it is not subject to, and the next person
 *   to widen ESCROW_DISPATCH_RELEASABLE_FROM would arm it.
 *
 *   So the stamp is SCOPED to ESCROW_DISPATCH_RELEASABLE_FROM, and that is what
 *   these tests measure — one per status, because a loop that checks the wrong
 *   set passes any test that only ever shows it a funded row.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     stamp every row, sibling-style (drop the status check)   KILLED ×4
 *     stamp only "funded", dropping in_transit                 KILLED ×2
 *     widen the shared set to include "disputed"               KILLED
 *     fetch the rows on every status AND stamp unconditionally KILLED
 *     stamp on every status change, keeping the fetch guard    SURVIVED, equivalent
 *     reword this header                                       SURVIVED, intended
 *
 *   THE SURVIVOR IS WORTH THE LINE IT TAKES. Replacing `if (newStatus ===
 *   "shipped")` with `if (true)` around the stamp changes nothing observable,
 *   because the rows are only FETCHED on "shipped" or "delivered" — so on any
 *   other status the loop iterates an empty array whatever its guard says. The
 *   two conditions are one rule spelled in two places.
 *
 *   I had written the last test believing it pinned the stamp guard. It does not;
 *   it pins the pair, and it passed the first mutant for a reason that had
 *   nothing to do with what its name claims. The mutant that DOES change
 *   behaviour has to break both (KILLED, above), and that is the one recorded.
 *   Noted rather than quietly relabelled, because "the test passed" and "the
 *   test would have caught it" are different facts, and this suite is the only
 *   thing standing between a dispute freeze and a payout deadline.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { updateOrderStatusAction } from '@/app/actions/order-management';
import { ESCROW_DISPATCH_RELEASABLE_FROM } from '@/lib/escrow-status';
import { ESCROW_STATUSES } from '@/lib/escrow-status';

jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderShipped: jest.fn(async () => undefined),
    notifyOrderDelivered: jest.fn(async () => undefined),
}));

const CARRIER = { method: "carrier", carrier: "GIG Logistics", trackingNumber: "TRK-968" };

/** Every escrow row the fake query hands back, with a spy on its update. */
type Row = { id: string; status: string; updates: Array<Record<string, unknown>> };

function seedOrderWithEscrows(orderId: string, statuses: string[]): Row[] {
    const rows: Row[] = statuses.map((status, i) => ({
        id: `esc-${i}-${status}`, status, updates: [],
    }));

    const order = {
        id: orderId,
        sellerId: "seller-1",
        sellerIds: ["seller-1"],
        buyerId: "buyer-1",
        status: "processing",
    };

    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: "seller-1", roles: ["seller"] } },
        error: null,
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, data: () => order,
    }));
    //   One handle answering as BOTH a document (the order) and a query result
    //   (its escrow rows) — the shape this harness has used since #389.
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => order,
        empty: rows.length === 0,
        docs: rows.map((row) => ({
            id: row.id,
            data: () => ({ status: row.status }),
            ref: { update: async (patch: Record<string, unknown>) => { row.updates.push(patch); } },
        })),
    }));

    return rows;
}

const stamped = (rows: Row[]) =>
    rows.filter((r) => r.updates.some((u) => 'shippedAt' in u)).map((r) => r.status).sort();

describe('#968 — dispatch stamps the payout clock, on the right rows only', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('THE test: marking an order shipped stamps shippedAt on its funded escrow', async () => {
        //   The feature. Without this the cron selects nothing and the money
        //   goes back to sitting there for ever.
        const rows = seedOrderWithEscrows("order-968-a", ["funded"]);

        const result = await updateOrderStatusAction("order-968-a", "shipped", undefined, CARRIER as any);

        expect(result.success).toBe(true);
        expect(stamped(rows)).toEqual(["funded"]);
    });

    it('and an in_transit escrow too, because the cron claims from that as well', async () => {
        //   A row the seller had already moved to in_transit is just as
        //   unconfirmed. Stamping only "funded" would leave it with no deadline
        //   while the query still selected it — so the cron would return it and
        //   the claim would find nothing to release.
        const rows = seedOrderWithEscrows("order-968-b", ["in_transit"]);

        await updateOrderStatusAction("order-968-b", "shipped", undefined, CARRIER as any);

        expect(stamped(rows)).toEqual(["in_transit"]);
    });

    it('AND A DISPUTED ESCROW IS NOT STAMPED — a frozen row gets no deadline', async () => {
        /*
         *   The sibling branch's shape, applied here, would have written this.
         *   A disputed escrow is frozen: the point of the freeze is that no
         *   automatic path moves the money while a person is deciding. Giving it
         *   a payout deadline does not move money today, because the claim
         *   refuses from "disputed" — it leaves a live clock on a row whose
         *   whole state means "no clock", for the next person to arm.
         */
        const rows = seedOrderWithEscrows("order-968-c", ["disputed"]);

        await updateOrderStatusAction("order-968-c", "shipped", undefined, CARRIER as any);

        expect(stamped(rows)).toEqual([]);
    });

    it('AND A SETTLED ESCROW IS NOT STAMPED — released, refunded or cancelled', async () => {
        //   The money has already gone somewhere. A dispatch stamp on a
        //   released row is a second payout deadline on a paid order.
        const rows = seedOrderWithEscrows("order-968-d", ["released", "refunded", "cancelled"]);

        await updateOrderStatusAction("order-968-d", "shipped", undefined, CARRIER as any);

        expect(stamped(rows)).toEqual([]);
    });

    it('AND A DELIVERED ESCROW IS NOT STAMPED — the buyer keeps their full 24 hours', async () => {
        /*
         *   The two clocks must not race. A buyer who confirms moves the row to
         *   "delivered" and is promised 24 hours to raise a dispute, in
         *   CONFIRM_RECEIPT_PROMPT. If dispatch had also stamped this row, a
         *   confirmation on day four hour twenty-three would be overtaken by the
         *   five-day deadline and the buyer would lose most of the window the
         *   dialog had just promised them.
         */
        const rows = seedOrderWithEscrows("order-968-e", ["delivered"]);

        await updateOrderStatusAction("order-968-e", "shipped", undefined, CARRIER as any);

        expect(stamped(rows)).toEqual([]);
    });

    it('AND THE SET IT STAMPS IS EXACTLY ESCROW_DISPATCH_RELEASABLE_FROM', async () => {
        /*
         *   Shown EVERY status at once, rather than one per test, so the
         *   assertion is about the set and not about the examples I happened to
         *   choose. A writer that checked a hand-written list would pass the
         *   cases above and fail here the moment the two lists drifted, which is
         *   the whole reason the set is a shared constant.
         */
        const rows = seedOrderWithEscrows("order-968-f", [...ESCROW_STATUSES]);

        await updateOrderStatusAction("order-968-f", "shipped", undefined, CARRIER as any);

        expect(stamped(rows)).toEqual([...ESCROW_DISPATCH_RELEASABLE_FROM].sort());
    });

    it('AND NOTHING IS STAMPED WHEN THE ORDER IS NOT BEING DISPATCHED', async () => {
        //   "processing" is a fulfilment state with no shipment behind it. A
        //   stamp here would start a payout clock before the goods had moved —
        //   which is the same defect as a creation site writing the field, and
        //   collection-field-drift carries that entry for the same reason.
        const rows = seedOrderWithEscrows("order-968-g", ["funded"]);

        await updateOrderStatusAction("order-968-g", "processing");

        expect(stamped(rows)).toEqual([]);
    });
});
