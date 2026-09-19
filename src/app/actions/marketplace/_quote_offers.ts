/**
 * The seller's half of a quote, and the buyer's answer to a counter.
 *
 *   #873 — see lib/quote-negotiation.ts for the rules and for why they are not
 *   in this file. This module is the doors; that module is the law.
 *
 *   WHY A SEPARATE FILE FROM _quotes.ts. Every export of a "use server" module
 *   is a reachable endpoint, and this file adds two that MOVE A PRICE. Keeping
 *   them beside the read and the submission would have been tidier and would
 *   have put the permission reasoning for four different doors in one 260-line
 *   body. These two are about who may change an agreed figure, and that is the
 *   only thing in here.
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isOwnedBySession } from "@/lib/owned-profile-ids";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { withSafeAction } from "@/lib/safe-action";
import { createNotification } from "@/infrastructure/notifications/service";
import type { ActionResponse } from "@/lib/safe-action";
import {
    positiveNumber,
    responseRefusal,
    type QuoteRecord,
} from "@/lib/quote-negotiation";

export type QuoteDecision = "accept" | "counter" | "decline";

/**
 * Tell the other side, in the bell and in the list.
 *
 *   THROUGH THE SERVICE, not through the collection, and my own first draft got
 *   this wrong in both new files. #687's ledger names five modules that write
 *   `collection(NOTIFICATIONS).add(...)` directly and records rather than
 *   rewires them; adding a sixth and a seventh would have been introducing the
 *   bypass deliberately, which is different from inheriting it.
 *
 *   What the bypass skips is #738: a notice addressed to a SUPERSEDED profile is
 *   redirected to the row the person actually signs in as. Somebody who has
 *   migrated profiles would be recorded as told and see nothing — on a screen
 *   that is the only place an accepted price appears.
 */
async function ringBell(userId: string, title: string, message: string, link: string) {
    if (!userId) return;
    await createNotification({ userId, type: "marketplace", title, message, link });
}

/**
 * The seller answers a quote: accept the buyer's figure, counter it, or decline.
 */
async function _respondToQuoteAction(
    quoteId: string,
    response: { decision: QuoteDecision; price?: number; message?: string },
): Promise<ActionResponse<{ status: string }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const userId = sessionResult.session.user.id;

        const snap = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).doc(String(quoteId)).get();
        if (!snap.exists) return { success: false as const, error: "Quote not found", data: null };

        const quote = (snap.data() ?? {}) as QuoteRecord;

        /*
         *   THE SELLER NAMED ON THE QUOTE, AND NOBODY ELSE.
         *
         *   Not "a seller", and not the product's current seller either: this
         *   row records who the buyer was negotiating with, and that is who may
         *   answer. The quote's own sellerId was written from the PRODUCT by
         *   _submitQuoteRequestAction — the comment there explains why it is not
         *   taken from the request — so it is already a trustworthy value.
         *
         *   Admins are deliberately NOT admitted. Agreeing a price on a seller's
         *   behalf is not moderation; it is trading as them.
         */
        if (!quote.sellerId || quote.sellerId !== userId) {
            return { success: false as const, error: "This quote is not addressed to you", data: null };
        }

        /*
         *   ONLY FROM `pending`.
         *
         *   Answering an already-answered quote is how an accepted price gets
         *   quietly replaced with a worse one after the buyer has seen it. The
         *   buyer is the only one who can move an accepted quote, and only by
         *   spending it.
         */
        if (quote.status !== "pending") {
            return {
                success: false as const,
                error: quote.status === "accepted"
                    ? "This quote has already been agreed."
                    : "This quote has already been answered.",
                data: null,
            };
        }

        const listedPrice = Number(quote.listedPrice ?? 0);
        const counter = positiveNumber(response?.price);
        const refusal = responseRefusal(String(response?.decision), counter, listedPrice, response?.price);
        if (refusal) return { success: false as const, error: refusal, data: null };

        const decision = response.decision;
        const sellerMessage = typeof response?.message === "string"
            ? response.message.trim().slice(0, 2000)
            : "";

        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = {
            sellerMessage,
            respondedAt: nowIso,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (decision === "accept") {
            /*
             *   ACCEPTING MEANS ACCEPTING WHAT SHE ASKED FOR, and she has to
             *   have asked for something. A quote raised with no figure is a
             *   "what would you charge?" — there is nothing to accept, so the
             *   seller has to counter with a price instead. Without this an
             *   "accepted" quote could carry agreedPrice: undefined and the
             *   checkout would refuse it with a message about a missing figure,
             *   which reads like a fault rather than a step nobody took.
             */
            const asked = positiveNumber(quote.offeredPrice);
            if (asked === null) {
                return {
                    success: false as const,
                    error: "This buyer asked for a price rather than offering one. Send them a price instead.",
                    data: null,
                };
            }
            patch.status = "accepted";
            patch.agreedPrice = asked;
            patch.acceptedAt = nowIso;
        } else if (decision === "counter") {
            patch.status = "countered";
            patch.counterPrice = counter;
        } else {
            patch.status = "declined";
        }

        await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).doc(String(quoteId)).update(patch);

        const productName = String((quote as any).productName || "your request");
        await ringBell(
            String(quote.buyerId || ""),
            decision === "accept"
                ? "Your offer was accepted"
                : decision === "counter" ? "The seller sent you a price" : "Your offer was declined",
            decision === "accept"
                ? `The seller accepted your price for "${productName}". You can check out at the agreed price.`
                : decision === "counter"
                    ? `The seller offered ₦${Number(counter).toLocaleString()} for "${productName}".`
                    : `The seller declined your offer for "${productName}".`,
            "/marketplace/buyer/quotes",
        );

        revalidatePath("/marketplace/buyer/quotes");
        revalidatePath("/marketplace/seller/quotes");

        return { error: null, success: true as const, data: { status: String(patch.status) } };
    } catch (error) {
        logger.error("Respond to quote error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to send your response. Please try again.", data: null };
    }
}
export const respondToQuoteAction = withSafeAction("respondToQuoteAction", _respondToQuoteAction);

/**
 * The buyer takes the seller's counter, or walks away from it.
 */
async function _settleQuoteCounterAction(
    quoteId: string,
    decision: "accept" | "decline",
): Promise<ActionResponse<{ status: string }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const userId = sessionResult.session.user.id;

        const snap = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).doc(String(quoteId)).get();
        if (!snap.exists) return { success: false as const, error: "Quote not found", data: null };

        const quote = (snap.data() ?? {}) as QuoteRecord;

        //   The buyer who raised it. Same reasoning as the seller door above.
        //   #904 (BUYER SIDE) — a quote raised from a superseded profile.
        if (!await isOwnedBySession(quote.buyerId, userId)) {
            return { success: false as const, error: "This quote is not yours", data: null };
        }

        if (quote.status !== "countered") {
            return {
                success: false as const,
                error: "There is no counter offer to answer on this quote.",
                data: null,
            };
        }

        if (decision !== "accept" && decision !== "decline") {
            return { success: false as const, error: "Choose whether to accept or decline.", data: null };
        }

        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = {
            settledAt: nowIso,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (decision === "accept") {
            /*
             *   THE PRICE COMES OFF THE ROW, NOT OUT OF THE REQUEST.
             *
             *   This action takes no figure at all. The buyer is agreeing to
             *   the number the SELLER wrote, and the only way to be sure that
             *   is what happens is to never accept one from the caller — the
             *   same reason _payment.ts ignores a caller-supplied `amount`.
             */
            const countered = positiveNumber(quote.counterPrice);
            if (countered === null) {
                return {
                    success: false as const,
                    error: "This counter offer has no usable price. Ask the seller to send it again.",
                    data: null,
                };
            }
            patch.status = "accepted";
            patch.agreedPrice = countered;
            patch.acceptedAt = nowIso;
        } else {
            patch.status = "declined";
        }

        await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).doc(String(quoteId)).update(patch);

        const productName = String((quote as any).productName || "your listing");
        await ringBell(
            String(quote.sellerId || ""),
            decision === "accept" ? "Your price was accepted" : "Your price was declined",
            decision === "accept"
                ? `The buyer accepted your price for "${productName}".`
                : `The buyer declined your price for "${productName}".`,
            "/marketplace/seller/quotes",
        );

        revalidatePath("/marketplace/buyer/quotes");
        revalidatePath("/marketplace/seller/quotes");

        return { error: null, success: true as const, data: { status: String(patch.status) } };
    } catch (error) {
        logger.error("Settle quote counter error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to record your answer. Please try again.", data: null };
    }
}
export const settleQuoteCounterAction = withSafeAction("settleQuoteCounterAction", _settleQuoteCounterAction);
