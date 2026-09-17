/**
 * Holding a paid property in escrow — one copy, for both doors.
 *
 *   #721 THE SECOND OF #695's THREE MISSING PROCESSORS.
 *
 *   `property_purchase` is a type the platform charges money under and the
 *   dispatch table could not route. Its fulfilment lived only in
 *   _verifyPropertyPaymentAction — the page the buyer is redirected back to —
 *   so a buyer who paid for a property and closed the tab, lost signal or
 *   switched apps had the money taken and the property left sitting in
 *   `pending_escrow` with nothing recording that it had been bought.
 *
 *   #719 wrote the first of the three, for export orders, and this follows the
 *   same shape for the same reason: the delivery lives here once, and the two
 *   doors call it. That is #272's pattern, and it exists because marketplace
 *   orders once had TWO fulfilment paths that answered the same payment
 *   differently depending on which arrived first.
 *
 *       the callback   claims as `client_verify`, renders the verdict
 *       the processor  claims as `webhook`, lets the throw reach the
 *                      dispatcher so the webhook answers 500 and Paystack
 *                      retries
 *
 * ── WHAT A REFUSAL COSTS, AND WHY IT IS MARKED HERE ─────────────────────────
 *
 *   Everything below runs AFTER the caller's claim, so a throw means the money
 *   was taken and nothing was delivered. claim_payment_once has already written
 *   status 'completed' — its default — and reconcilePendingFulfillments only
 *   looks for 'pending_fulfilment'. Without markFulfilmentFailed a failure here
 *   leaves a payment that looks settled, delivered nothing, and is invisible to
 *   reconciliation.
 *
 *   The callback did that in its own try/catch. Doing it HERE rather than in
 *   both doors is the point of the extraction: it is the safety behaviour most
 *   worth having exactly once, and a second copy in the processor is a second
 *   chance to write it slightly differently.
 *
 * ── THE PRICE IS CHECKED AGAINST THE QUOTE, NOT THE LISTING ─────────────────
 *
 *   Carried over unchanged, and the reason is worth keeping: `freshData.price`
 *   is the listing's CURRENT price, which the owner can change. An owner who
 *   repriced between a buyer's initialisation and their return made the
 *   buyer's payment look like an underpayment — and this throws AFTER the
 *   claim, so the buyer had paid and received nothing.
 *
 *   The purchase record written at initialisation holds `propertyPrice`, which
 *   IS the figure Paystack was asked to collect. That is the contract, so that
 *   is what the payment is checked against. It falls back to the listing price
 *   only when no purchase record exists — a reference arriving from outside the
 *   normal flow, which is the case the original check was added for.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { markFulfilmentFailed } from "@/lib/wallet-ledger";
import { notifyPropertyPaid } from "@/lib/farm-nation-notifications";
import { logger } from "@/lib/logger";

/** ₦1 of tolerance, matching confirmWalletFundingAction and the cooperative contribution path. */
export const PROPERTY_PRICE_TOLERANCE = 1;

export interface PropertyPurchaseArgs {
    reference: string;
    amountInNaira: number;
    buyerId: string;
    propertyId: string;
    /** For the ledger description. Falls back to the listing's own title. */
    propertyTitle?: string;
    /** The webhook has none; it is read from the purchase record instead. */
    buyerEmail?: string;
    /** From the payment metadata, used only when the listing has no ownerId. */
    sellerIdFromMetadata?: string;
}

/**
 * Record a paid property as held in escrow.
 *
 * THE CALLER MUST HAVE CLAIMED THE REFERENCE ALREADY — everything below writes,
 * and claim_payment_once is what makes it happen once. Both doors claim
 * immediately before calling.
 *
 * Throws on refusal, after marking the payment unfulfilled.
 */
export async function fulfilPropertyPurchase(args: PropertyPurchaseArgs): Promise<{ propertyId: string }> {
    const {
        reference, amountInNaira, buyerId, propertyId,
        propertyTitle, buyerEmail, sellerIdFromMetadata,
    } = args;

    try {
        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const freshPropertyDoc = await propertyRef.get();

        if (!freshPropertyDoc.exists) {
            throw new Error("Property not found");
        }

        const freshData = freshPropertyDoc.data()!;

        if (freshData.status !== "pending_escrow") {
            throw new Error(`Property is not in pending escrow state (status: ${freshData.status}).`);
        }

        //   The purchase record carries BOTH the quoted price and the buyer's
        //   address, so the one read serves the price check below and the
        //   payments row further down. The webhook has no session to take an
        //   email from; this is where it comes from.
        const quotedSnap = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        const purchase = quotedSnap.empty ? null : quotedSnap.docs[0];
        const purchaseData = purchase?.data() ?? {};

        const quotedPrice = purchase === null
            ? Number(freshData.price || 0)
            : Number(purchaseData.propertyPrice ?? freshData.price ?? 0);

        if (
            Number.isFinite(quotedPrice) && quotedPrice > 0
            && amountInNaira + PROPERTY_PRICE_TOLERANCE < quotedPrice
        ) {
            logger.error("[PropertyPurchaseFulfilment] Underpayment for property", {
                propertyId,
                paid: amountInNaira,
                quoted: quotedPrice,
                listedNow: Number(freshData.price || 0),
                quoteSource: purchase === null ? "listing (no purchase record)" : "purchase record",
                reference,
            });
            throw new Error(
                `Payment of ₦${amountInNaira.toLocaleString()} does not cover the property price `
                + `of ₦${quotedPrice.toLocaleString()}.`
            );
        }

        // Transfer ownership later, just lock it in escrow.
        await propertyRef.update({
            status: "pending_escrow", // Wait for admin to release C of O
            escrowHeldAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // (The processed_payments row is written by the caller's claim.)

        const title = propertyTitle || freshData.title || propertyId;

        // Global Ledger Record
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
            id: reference,
            userId: buyerId,
            type: "property_purchase",
            module: "farm_nation",
            amount: amountInNaira,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference,
            description: `Property Purchase - ${title}`,
        });

        // Log direct Paystack payment in the payments collection
        const paymentId = `PAY-${reference}`;
        const sellerId = String(freshData.ownerId || sellerIdFromMetadata || "");
        await db.collection(COLLECTIONS.PAYMENTS).doc(paymentId).set({
            id: paymentId,
            userId: buyerId,
            //   The session's address when a person is here, the purchase
            //   record's when the webhook is. Both are the buyer's; neither is
            //   invented, and "" is what this row already fell back to.
            userEmail: buyerEmail || String(purchaseData.buyerEmail || ""),
            amount: amountInNaira,
            currency: "NGN",
            paymentReference: reference,
            status: "success",
            paymentMethod: "paystack",
            purpose: "escrow_payment",
            relatedId: propertyId,
            initiatedAt: freshData.createdAt || FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
            sellerId,
            participants: [buyerId, sellerId].filter(Boolean),
        });

        // Update purchase record
        if (purchase !== null) {
            await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchase.id).update({
                status: "payment_confirmed",
                escrowStatus: "held",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        /*
         *   #863 AND TELL BOTH PARTIES, which nothing did.
         *
         *   THE OWNER: "After listing notification email to be sent and also
         *   after a transaction."
         *
         *   Everything above is a state change: a status, a ledger row, a
         *   payments row, an escrow flag. Money moved and a parcel went into
         *   escrow, and neither the buyer nor the seller was sent anything.
         *
         *   THE SELLER HAD NOTHING AT ALL. The buyer at least sees the callback
         *   page when the callback door runs. The seller has no page in this
         *   flow — her land is sold, the money is held, and the only record is a
         *   status on a row she would have to go looking for. When the WEBHOOK
         *   door runs, which is the case this module exists for (a buyer who
         *   closed the tab), nobody saw anything.
         *
         *   AFTER EVERY WRITE, and never able to throw. A throw from here would
         *   reach the catch below, call markFulfilmentFailed on a payment that
         *   WAS fulfilled, and make the webhook answer 500 so Paystack retries —
         *   turning "we could not send an email" into a payment recorded as
         *   undelivered. The notifier swallows its own failures; the belt here
         *   is for anything it cannot, such as an import that throws.
         */
        try {
            await notifyPropertyPaid({
                buyerId,
                buyerEmail: buyerEmail || String(purchaseData.buyerEmail || ""),
                sellerId,
                propertyId,
                propertyTitle: title,
                amount: amountInNaira,
                reference,
            });
        } catch (noticeError) {
            logger.error("[PropertyPurchaseFulfilment] the purchase notices failed", {
                propertyId, reference, error: noticeError,
            });
        }

        return { propertyId };
    } catch (fulfilmentError: any) {
        // Marked, then rethrown unchanged. The caller decides what it means —
        // the callback turns it into "contact support with reference", the
        // webhook answers 500 — and this only makes the payment findable so
        // somebody can act on it.
        await markFulfilmentFailed(
            reference,
            fulfilmentError?.message ?? String(fulfilmentError)
        );
        throw fulfilmentError;
    }
}
