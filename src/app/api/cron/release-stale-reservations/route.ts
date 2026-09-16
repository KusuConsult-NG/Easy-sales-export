export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { statusAfterCancellation } from "@/lib/land-listing-status";
import {
    RESERVATION_HOLD_STATUSES,
    reservationHasLapsed,
    releasedReservationFields,
} from "@/lib/land-reservation-expiry";
import { createNotification } from "@/infrastructure/notifications/service";
import { refuseUnauthorisedCron } from "@/lib/cron-auth";

/**
 * Give back a property reservation the buyer walked away from.
 *
 *   #140 A RESERVATION NEVER EXPIRED.
 *
 *        Two paths take a parcel off the market for one buyer, and both stamp
 *        `pendingSince` at the moment they do it. Both release the hold if
 *        their own next write fails (#136, #139), and the buyer can cancel
 *        (#138). Nothing released a hold the buyer simply abandoned, and a scan
 *        for a reader of `pendingSince` found exactly one hit: the sentence
 *        recording that it had none.
 *
 *        So closing the checkout tab took the parcel off the market for good.
 *        The owner could not relist it. No other buyer could claim it, because
 *        a claim starts from PURCHASABLE_STATUSES and the listing was not in
 *        one. An admin could not free it either — #137 removed "pending" from
 *        the statuses an approval may overwrite, so that an approval could not
 *        seize a parcel somebody was paying for. Each of those guards is right;
 *        together they left the abandoned case with no exit.
 *
 *   TWO GUARDS, BECAUSE THE CLOCK IS NOT ONE
 *
 *        Releasing a hold while money is in flight would rebuild #135 — two
 *        buyers, two escrows, one parcel.
 *
 *        THE CAS CLAIM is the first: this moves a listing only OUT OF the exact
 *        hold status it read, so a payment that has landed AND been processed —
 *        moving the listing to pending_payment, pending_transfer, sold or
 *        leased — makes the claim refuse.
 *
 *        THE PAYMENT CHECK is the second, and it exists because the first is
 *        not sufficient. `pending_escrow` is itself one of
 *        DECISION_LOCKED_STATUSES — #137's list of statuses that mean a buyer
 *        has committed — and it is written BEFORE Paystack is called. So a
 *        buyer can pay while the listing still reads `pending_escrow`, and it
 *        stays that way until the callback runs claimPaymentOnce. A callback
 *        that is late, lost, or failed leaves a PAID-FOR parcel in a hold this
 *        sweep would otherwise release onto the open market. My own test caught
 *        that: the first draft of this job asserted no hold status was in
 *        DECISION_LOCKED_STATUSES, and pending_escrow is.
 *
 *        So before releasing anything, this reads the property's transaction
 *        rows: a row that has moved past `pending_payment`, or one whose
 *        reference has a processedPayments entry, means money arrived. Those
 *        are REPORTED as `paidButHeld` and never released — they are a stuck
 *        fulfilment for cron/reconcile-fulfilment and a human, not a parcel to
 *        put back on sale.
 *
 *        The thresholds in lib/land-reservation-expiry decide when it is worth
 *        looking; they are not what makes this safe.
 *
 *   WHAT IT RESTORES
 *
 *        `previousStatus` — recorded by both reservation paths through
 *        recordPreviousAs for exactly this — via statusAfterCancellation, the
 *        same rule the buyer's own cancel uses. A listing reserved from
 *        "verified" comes back "verified" rather than dropping to "available"
 *        and out of the land module's public view.
 *
 *   WHAT IT WILL NOT DO
 *
 *        NOTHING IS DELETED. The listing keeps every field; only the hold is
 *        lifted. No money moves — a lapsed hold by definition never took any,
 *        and any listing that did take money is out of reach of the claim.
 *
 * Authorization: Bearer CRON_SECRET, as with the other cron routes.
 */

/** Listings examined per run. Anything not reached is reached next run. */
const MAX_PER_RUN = 500;

export async function GET(request: NextRequest) {
    //   #659 — one gate, shared. See lib/cron-auth.
    const refusal = refuseUnauthorisedCron(request, "release-stale-reservations");
    if (refusal) return refusal;

    const now = new Date();

    try {
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "in", [...RESERVATION_HOLD_STATUSES])
            .limit(MAX_PER_RUN)
            .get();

        /**
         * Did money arrive for this property, whatever the listing still says?
         *
         * Returns the reason when it did, so the caller can report it rather
         * than merely skipping. Errs towards "yes": a check that cannot run is
         * treated as evidence of payment, because releasing a paid parcel is
         * far worse than holding an abandoned one one cycle longer.
         */
        const moneyArrivedFor = async (propertyId: string): Promise<string | null> => {
            try {
                const txSnap = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                    .where("propertyId", "==", propertyId)
                    .limit(50)
                    .get();

                for (const tx of txSnap.docs) {
                    const row = tx.data() as { status?: unknown; paymentReference?: unknown };

                    // A transaction that has moved past the unpaid state.
                    const txStatus = String(row.status ?? "");
                    if (txStatus && txStatus !== "pending_payment" && txStatus !== "cancelled") {
                        return `transaction ${tx.id} is '${txStatus}'`;
                    }

                    // Or one whose reference Paystack has already settled, even
                    // if the row itself has not been moved on yet.
                    const reference = String(row.paymentReference ?? "");
                    if (reference) {
                        const paid = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                            .doc(reference).get();
                        if (paid.exists) return `payment ${reference} was processed`;
                    }
                }

                return null;
            } catch (error: any) {
                logger.error(
                    `[cron/release-stale-reservations] could not check payments for ${propertyId}; `
                    + `treating it as paid and leaving the hold in place.`, error,
                );
                return "the payment check could not be completed";
            }
        };

        const released: string[] = [];
        /** Held, lapsed, and paid for. Never released; always reported. */
        const paidButHeld: Array<{ id: string; because: string }> = [];
        const skipped: Array<{ id: string; status: string | null }> = [];
        const failed: Array<{ id: string; reason: string }> = [];
        /**
         * Holds that arrived with no `pendingSince`.
         *
         * Both reservation paths stamp it, so there should be none; one
         * appearing means a row was written by something that does not.
         *
         *   #831 — this used to say "that row can never be swept", and that was
         *   true: the job reported the id and moved on, every run, for ever.
         *   The owner's production log carried the same line for
         *   `sample-land-listing-e2e`. Such a row is given a clock now and
         *   lapses on the ordinary schedule; see the stamp below.
         */
        const undatable: string[] = [];
        /** #831 — the undatable holds this run gave a clock to. */
        const dated: string[] = [];

        for (const doc of snapshot.docs) {
            const listing = doc.data() as { status?: unknown; pendingSince?: unknown; pendingBuyerId?: unknown };
            const verdict = reservationHasLapsed(listing, now);

            if (!verdict.lapsed) {
                if (verdict.reason === "no_timestamp") {
                    /*
                     *   #831 AN UNDATABLE HOLD IS NOW DATED INSTEAD OF REPORTED
                     *   FOREVER.
                     *
                     *   From the owner's production log, on a run of this job:
                     *
                     *       1 held listing(s) carry no pendingSince and can
                     *       never be swept: sample-land-listing-e2e
                     *
                     *   The comment above `undatable` says the right thing —
                     *   "that row can never be swept" — and then the code only
                     *   WRITES IT DOWN. So the parcel stays off the market for
                     *   good, the buyer slot stays occupied by nobody, and the
                     *   job reports the same line every run until somebody
                     *   reads a log and edits the database by hand. "Reported
                     *   rather than silently passed over" was an improvement on
                     *   silence; it is not a fix.
                     *
                     *   STAMPED, NOT RELEASED. The hold gets `pendingSince` of
                     *   NOW, which makes it datable — and then the ordinary
                     *   lapse rule sweeps it on a later run, after the same
                     *   window every other hold gets. That matters: the row's
                     *   real age is unknown, so releasing it here would be this
                     *   job inventing a duration it cannot know. Giving it a
                     *   clock costs one more hold period and is the only
                     *   honest reading of a hold with no start time.
                     *
                     *   Self-healing by construction: it needs no operator, it
                     *   fixes the row that exists today and any future one
                     *   written by a path that forgets the stamp, and the
                     *   report below still names what it did.
                     */
                    undatable.push(doc.id);
                    try {
                        await db.collection(COLLECTIONS.LAND_LISTINGS).doc(doc.id).update({
                            pendingSince: now.toISOString(),
                            //   Recorded so the next reader knows this clock was
                            //   started by the sweeper and is not the buyer's
                            //   original reservation time.
                            pendingSinceBackfilledBy: "release-stale-reservations",
                            pendingSinceBackfilledAt: now.toISOString(),
                        });
                        dated.push(doc.id);
                    } catch (err) {
                        failed.push({
                            id: doc.id,
                            reason: `could not stamp pendingSince: ${err instanceof Error ? err.message : String(err)}`,
                        });
                    }
                }
                continue;
            }

            const heldStatus = String(listing.status);

            // THE SECOND GUARD. A hold whose money arrived is a stuck
            // fulfilment, not an abandoned reservation.
            const paidBecause = await moneyArrivedFor(doc.id);
            if (paidBecause) {
                paidButHeld.push({ id: doc.id, because: paidBecause });
                continue;
            }

            try {
                const claim = await claimStatusTransitionFromAny({
                    collection: COLLECTIONS.LAND_LISTINGS,
                    id: doc.id,
                    // ONLY out of the status this row was actually in. A
                    // payment that landed between the read and here moves the
                    // listing on, and this then refuses.
                    fromAny: [heldStatus],
                    to: statusAfterCancellation((listing as { previousStatus?: unknown }).previousStatus),
                    patch: {
                        ...releasedReservationFields(),
                        reservationLapsedAt: now.toISOString(),
                    },
                });

                if (!claim.claimed) {
                    skipped.push({ id: doc.id, status: claim.status ?? null });
                    continue;
                }

                released.push(doc.id);

                // The buyer is told their hold has gone, so a returning visitor
                // is not left wondering why the parcel is back on the market.
                // Linked to the property page, which exists — #51's defect was
                // every escrow notification pointing at a 404.
                const buyerId = String(listing.pendingBuyerId ?? "");
                if (buyerId) {
                    await createNotification({
                        userId: buyerId,
                        type: "land",
                        title: "Property Reservation Expired",
                        message:
                            `Your hold on this property lapsed after ${verdict.allowedHours} hours `
                            + `without payment, and it is available again. You can reserve it once more `
                            + `if it has not been taken.`,
                        link: `/farm-nation/property/${doc.id}`,
                        linkText: "View Property",
                    }).catch((e) =>
                        logger.error(`[cron/release-stale-reservations] notify ${buyerId} failed:`, e));
                }
            } catch (error: any) {
                // One stuck listing must not stop the rest, and a failed write
                // is never counted as a release — #298/#299's rule.
                logger.error(`[cron/release-stale-reservations] ${doc.id} failed:`, error);
                failed.push({ id: doc.id, reason: error?.message ?? "unknown" });
            }
        }

        if (paidButHeld.length > 0) {
            logger.error(
                `[cron/release-stale-reservations] ${paidButHeld.length} lapsed hold(s) have money `
                + `against them and were NOT released: `
                + paidButHeld.map((p) => `${p.id} (${p.because})`).join("; "),
            );
        }

        if (undatable.length > 0) {
            /*
             *   #831 — the same finding, said in the tense that is now true.
             *   "Can never be swept" was accurate and is not any more: the row
             *   has a clock, and the next run applies the ordinary rule to it.
             */
            logger.warn(
                `[cron/release-stale-reservations] ${undatable.length} held listing(s) carried no `
                + `pendingSince; ${dated.length} were stamped with one and will lapse on the normal `
                + `schedule from now: ${undatable.join(", ")}`,
            );
        }

        return NextResponse.json({
            success: failed.length === 0,
            checkedAt: now.toISOString(),
            examined: snapshot.docs.length,
            released: released.length,
            skipped: skipped.length,
            failed: failed.length,
            paidButHeld: paidButHeld.length,
            undatable: undatable.length,
            //   #831 — of those, the ones this run gave a clock to.
            dated: dated.length,
            // Named, not merely counted: each is a row somebody has to look at.
            failures: failed,
            paidButHeldIds: paidButHeld,
            undatableIds: undatable,
            datedIds: dated,
            mayHaveMore: snapshot.docs.length >= MAX_PER_RUN,
        });
    } catch (error: any) {
        logger.error("[cron/release-stale-reservations] run failed:", error);
        return NextResponse.json(
            { success: false, error: "Failed to release stale reservations" },
            { status: 500 },
        );
    }
}
