"use server";

import { requireSession } from "@/lib/session-guard";
import { releasedReservationFields } from "@/lib/land-reservation-expiry";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { claimPaymentOnce, markFulfilmentFailed } from "@/lib/wallet-ledger";
import { getBaseUrl } from "@/lib/server-utils";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { PURCHASABLE_STATUSES, isPurchasable, statusAfterCancellation } from "@/lib/land-listing-status";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

/**
 * Initialize Paystack Payment for Property Purchase
 * Creates a payment session and returns authorization URL
 */
async function _initializePropertyPaymentAction(
    propertyId: string,
    propertyTitle: string,
    amount: number,
    sellerId: string,
    buyerInfo: { 
        fullName: string; 
        email: string; 
        phone: string; 
        purpose: string; 
        zoningComplianceDeclarationAccepted?: boolean;
    }
): Promise<ActionResponse<{ authorizationUrl: string; reference: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user) { 
            return { success: false, error: "Authentication required", data: null };
        }

        // Strict validation of zoning compliance declaration
        if (!buyerInfo.zoningComplianceDeclarationAccepted) {
            return { success: false, error: "Zoning compliance declaration must be accepted to proceed with property purchase", data: null };
        }

        // WHAT WAS WRONG HERE
        // -------------------
        // `amount` is a caller-supplied parameter and the only check on it was
        // `< 10000`. The property document is loaded a few lines below — its
        // status and its owner are both checked — and `propertyData.price` was
        // never read.
        //
        // So the Paystack charge, `propertyPrice` and `escrowAmount` were all
        // whatever the caller asked for, and verifyPropertyPaymentAction
        // compared the paid sum to nothing. Anyone could buy any verified
        // property for ₦10,000.
        //
        // The listed price is authoritative now. The `amount` parameter is kept
        // so the signature does not change and is deliberately ignored.
        if (amount < 10000) { 
            return { success: false, error: "Minimum property purchase is ₦10,000", data: null };
        }

        // Check if property exists and is available
        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) { 
            return { success: false, error: "Property not found", data: null };
        }

        const propertyData = propertyDoc.data()!;

        // The price the seller listed, not the price the buyer proposed.
        const listedPrice = Number(propertyData.price || 0);

        // The seller and the title come from the LISTING, not the request.
        //
        // `sellerId` and `propertyTitle` were parameters, written into the
        // Paystack metadata and from there into the escrow record — where
        // verifyPropertyPaymentAction reads `metadata.sellerId ||
        // freshData.ownerId`, so the caller's value wins and the real owner is
        // only a fallback.
        //
        // A buyer could therefore name THEMSELVES as the seller of someone
        // else's land and be recorded as the party the escrow is owed to. The
        // "you cannot purchase your own property" check above compares against
        // propertyData.ownerId and does not notice.
        const listingSellerId = String(propertyData.ownerId || "");
        const listingTitle = String(propertyData.title || propertyTitle || "Property");

        if (!listingSellerId) {
            return { success: false, error: "This property has no owner on record and cannot be purchased.", data: null };
        }
        if (!Number.isFinite(listedPrice) || listedPrice <= 0) {
            return { success: false, error: "This property has no price set and cannot be purchased.", data: null };
        }

        /**
         * THE SHARED PURCHASABLE RULE, NOT THE LITERAL "verified".
         *
         * LAND_LISTINGS is written by two modules with different vocabularies.
         * _fn_listings.ts creates a farm-nation property as "available"; the
         * land module's admin approval writes "verified". PURCHASABLE_STATUSES
         * covers both — it exists because requiring one spelling made the other
         * module's listings unbuyable, and BROWSABLE_STATUSES is the same set,
         * so the browse page shows both as for sale.
         *
         * This required "verified" exactly. So EVERY property listed through
         * Farm Nation itself was visible, clickable, and refused at checkout
         * with "Property is no longer available" — the module's own listings
         * could not be bought through the only checkout page the app has.
         * _fn_purchases.ts was widened to the shared rule; this, the path the
         * page actually calls, was not.
         */
        if (!isPurchasable(propertyData.status)) {
            return { success: false, error: "Property is no longer available", data: null };
        }

        // Buyer cannot purchase their own property
        if (propertyData.ownerId === session.user.id) {
            return { success: false, error: "You cannot purchase your own property", data: null };
        }

        /**
         * RESERVE THE PROPERTY BEFORE CHARGING ANYBODY.
         *
         * The status write used to be a bare `update({ status: "pending_escrow" })`
         * AFTER the Paystack session was created. Two buyers reaching checkout
         * on one listing therefore both read "verified", both got an
         * authorization URL, and BOTH WERE CHARGED — the second update simply
         * overwrote the first. One property, two payments, and only one of them
         * can ever be fulfilled.
         *
         * _fn_purchases.ts documents fixing exactly this with a claim, and says
         * why: "exactly one buyer wins, and the loser is told it has gone rather
         * than being taken to payment for something they cannot have". That fix
         * landed on the path with no UI and not on this one.
         *
         * Claiming FIRST means the loser never reaches Paystack.
         * `recordPreviousAs` stores what it was reserved from, so cancelling
         * restores "verified" rather than dropping the listing to "available"
         * — which would take it out of the land module's public view, since
         * getVerifiedLandListings queries that exact status.
         */
        const reservation = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: propertyId,
            fromAny: [...PURCHASABLE_STATUSES],
            to: "pending_escrow",
            patch: { pendingBuyerId: session.user.id, pendingSince: new Date().toISOString() },
            recordPreviousAs: "previousStatus",
        });

        if (!reservation.claimed) {
            return { success: false, error: "Property is no longer available", data: null };
        }

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/farm-nation/payment/callback`;

        /**
         * A reservation that cannot be paid for must be given back.
         *
         * Everything from here on can fail — Paystack can be unreachable, the
         * record write can throw — and the listing is already reserved. Without
         * this the property is off the market permanently: no buyer can claim
         * it, and its would-be buyer has no purchase record to cancel, because
         * the record is written below.
         */
        const releaseReservation = async (why: string) => {
            try {
                // Back to whatever it was reserved FROM — the same rule the
                // cancel path uses, so a listing reserved from "verified" does
                // not come back as "available" and drop out of the land view.
                await propertyRef.update({
                    status: statusAfterCancellation(propertyData.status),
                    // #140 — one definition of what leaving a hold clears.
                    ...releasedReservationFields(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (releaseError) {
                logger.error(
                    `[initializePropertyPayment] property ${propertyId} is reserved and could not be released ` +
                    `after ${why}; it needs to be freed by hand.`,
                    releaseError,
                );
            }
        };

        // Initialize payment with Paystack
        let authorizationUrl: string;
        let reference: string;
        try {
            ({ authorizationUrl, reference } = await initializePaystackPayment(
                session.user.email || "",
                nairaToKobo(listedPrice),
                {
                    userId: session.user.id,
                    propertyId,
                    propertyTitle: listingTitle,
                    sellerId: listingSellerId,
                    type: "property_purchase",
                    callback_url: callbackUrl
                },
                callbackUrl
            ));
        } catch (initError: any) {
            await releaseReservation("the Paystack session could not be created");
            throw initError;
        }

        // Create pending purchase record in FARM_NATION_TRANSACTIONS
        const purchaseId = `${session.user.id}_${propertyId}_${Date.now()}`;
        try {
            await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchaseId).set({ 
            id: purchaseId,
            propertyId,
            propertyName: listingTitle,
            propertyPrice: listedPrice,
            propertyType: propertyData.category || "land",
            buyerId: session.user.id,
            buyerName: buyerInfo.fullName,
            buyerEmail: buyerInfo.email,
            buyerPhone: buyerInfo.phone,
            purpose: buyerInfo.purpose,
            sellerId: listingSellerId,
            sellerName: propertyData.ownerName,
            status: "pending_payment",
            escrowAmount: listedPrice,
            escrowStatus: "pending",
            paymentReference: reference,
            zoningComplianceDeclarationAccepted: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
            });
        } catch (recordError: any) {
            await releaseReservation("the purchase record could not be written");
            throw recordError;
        }

        // The status write that used to sit here — a bare update to
        // "pending_escrow", after Paystack had already been called — is the
        // claim above now. See the comment there for what two simultaneous
        // buyers did to it.

        return { 
            success: true, 
            error: null, 
            data: { authorizationUrl, reference } 
        };
    } catch (error: any) { 
        logger.error("Property payment initialization error:", error);
        return { success: false, error: error.message || "Failed to initialize payment. Please try again.", data: null };
    }
}
export const initializePropertyPaymentAction = withFlexibleSafeAction("initializePropertyPaymentAction", _initializePropertyPaymentAction);

/**
 * Verify Property Purchase Payment
 * Updates ownership after successful payment
 */
async function _verifyPropertyPaymentAction(reference: string): Promise<ActionResponse<{ propertyId: string; message: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user) { 
            return { success: false, error: "Authentication required", data: null };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) { 
            return { success: false, error: "Too many payment verification attempts. Please try again later.", data: null };
        }

        // The "SECURITY FIX #1: Double-payment protection" read that used to
        // sit here returned early when the marker existed, while the marker
        // itself was written after fulfilment — so it caught a webhook that had
        // already FINISHED and nothing else. claimPaymentOnce below is the gate.

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                success: false,
                error: `Payment ${paymentData.data.status}: ${paymentData.data.gateway_response}`,
                data: null
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const propertyId = metadata.propertyId;
        const userId = metadata.userId;

        // Verify user match
        if (userId !== session.user.id) { 
            return { success: false, error: "Payment verification failed: User mismatch", data: null };
        }

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        let amountInNaira = 0;

        // The marker was written "inside the transaction for full atomicity",
        // which the wrapper did not provide: the adapter queues the writes and
        // flushes them afterwards, so two deliveries of this payment both
        // reached the writes and both recorded the purchase, the ledger row and
        // the payment record.
        //
        // Claimed first now. The escrow payment IS money in, so the default
        // "completed" status is the correct one here.
        amountInNaira = paymentData.data.amount / 100;

        const claim = await claimPaymentOnce({
            reference,
            userId: session.user.id,
            amount: amountInNaira,
            type: "farm_nation_escrow",
            source: "client_verify",
            metadata: { propertyId },
        });

        if (!claim.claimed) {
            logger.info(`[verifyFarmNationPayment] Payment ${reference} already claimed — nothing to do.`);
            return {
                success: true,
                error: null,
                data: { propertyId, amount: amountInNaira },
            } as any;
        }

        // Everything below runs AFTER the claim, so a failure here means the
        // money was taken and nothing was delivered. claim_payment_once already
        // wrote status 'completed' (its default), and
        // reconcilePendingFulfillments only looks for 'pending_fulfilment' — so
        // without the catch below, a throw here leaves a payment that looks
        // settled, delivered nothing, and is invisible to reconciliation.
        //
        // Three things in this block throw: property missing, wrong status, and
        // underpayment.
        try {
            const freshPropertyDoc = await propertyRef.get();
            if (!freshPropertyDoc.exists) {
                throw new Error("Property not found");
            }

            const freshData = freshPropertyDoc.data()!;

            if (freshData.status !== "pending_escrow") {
                throw new Error(`Property is not in pending escrow state (status: ${freshData.status}).`);
            }

            // The paid sum must cover the listed price.
            //
            // Nothing compared them before: this route trusted that whatever
            // Paystack collected was the right amount, and the amount had been
            // chosen by the buyer at initialisation. Charging the listed price
            // above fixes the normal flow; this fixes the flow where a payment
            // reference arrives from anywhere else.
            //
            // ₦1 of tolerance, matching confirmWalletFundingAction and the
            // cooperative contribution path.
            //
            // COMPARED AGAINST THE PRICE THE BUYER WAS QUOTED, NOT THE LIVE ONE.
            //
            // This read `freshData.price`, the listing's CURRENT price, which the
            // owner can change. So an owner who repriced between a buyer's
            // initialisation and their return from Paystack made the buyer's
            // payment look like an underpayment, and this threw — after the claim,
            // so the buyer had paid and received nothing.
            //
            // The purchase record written at initialisation holds `propertyPrice`,
            // which IS the figure Paystack was asked to collect. That is the
            // contract, so that is what the payment is checked against.
            // updatePropertyAction now also refuses to move these terms while a
            // purchase is in flight; this is the half that does not depend on
            // winning a race with the status write.
            //
            // Falls back to the listing price when no purchase record exists —
            // a reference arriving from outside the normal flow, which is the case
            // the original check was added for.
            const quotedSnap = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();

            const quotedPrice = quotedSnap.empty
                ? Number(freshData.price || 0)
                : Number(quotedSnap.docs[0].data()?.propertyPrice ?? freshData.price ?? 0);

            if (Number.isFinite(quotedPrice) && quotedPrice > 0 && amountInNaira + 1 < quotedPrice) {
                logger.error("[FarmNationPayment] Underpayment for property", {
                    propertyId,
                    paid: amountInNaira,
                    quoted: quotedPrice,
                    listedNow: Number(freshData.price || 0),
                    quoteSource: quotedSnap.empty ? "listing (no purchase record)" : "purchase record",
                    reference,
                });
                throw new Error(
                    `Payment of ₦${amountInNaira.toLocaleString()} does not cover the property price of ₦${quotedPrice.toLocaleString()}.`
                );
            }

            // Transfer ownership later, just lock it in escrow
            const updatedData = {
                status: "pending_escrow", // Wait for admin to release C of O
                escrowHeldAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            };
            await propertyRef.update(updatedData);

            // (The processed_payments row is written by claimPaymentOnce above.)

            // Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            await globalTxRef.set({
                id: reference,
                userId: session.user.id,
                type: "property_purchase",
                module: "farm_nation",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Property Purchase - ${metadata.propertyTitle}`
            });

            // Log direct Paystack payment in the payments collection
            const paymentId = `PAY-${reference}`;
            const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
            await paymentRef.set({
                id: paymentId,
                userId: session.user.id,
                userEmail: session.user.email || "",
                amount: amountInNaira,
                currency: "NGN",
                paymentReference: reference,
                status: "success",
                paymentMethod: "paystack",
                purpose: "escrow_payment",
                relatedId: propertyId,
                initiatedAt: freshData.createdAt || FieldValue.serverTimestamp(),
                completedAt: FieldValue.serverTimestamp(),
                sellerId: String(freshData.ownerId || metadata.sellerId || ""),
                participants: [session.user.id, String(freshData.ownerId || metadata.sellerId || "")].filter(Boolean)
            });

            // Update purchase record
            const purchaseQuery = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();

            if (!purchaseQuery.empty) { 
                const purchaseRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchaseQuery.docs[0].id);
                await purchaseRef.update({
                    status: "payment_confirmed",
                    escrowStatus: "held",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        } catch (fulfilmentError: any) {
            // Marked, then rethrown unchanged. The outer catch still turns this
            // into the user-facing "contact support with reference" response;
            // this only makes the payment findable so somebody can act on it.
            await markFulfilmentFailed(
                reference,
                fulfilmentError?.message ?? String(fulfilmentError)
            );
            throw fulfilmentError;
        }

        return {
            success: true,
            error: null,
            data: { 
                propertyId,
                message: `Payment successful! Your funds are held securely in escrow for ${metadata.propertyTitle}.`
            }
        };
    } catch (error: any) {
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyProperty',
            reference,
            error: error instanceof Error ? error.message : String(error)
        });

        return {
            success: false,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
            data: null
        };
    }
}
export const verifyPropertyPaymentAction = withFlexibleSafeAction("verifyPropertyPaymentAction", _verifyPropertyPaymentAction);
