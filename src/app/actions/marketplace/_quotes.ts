"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { withSafeAction } from "@/lib/safe-action";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";

export interface QuoteRequestData { 
    productId: string;
    productName: string;
    sellerId: string;
    quantity: number;
    unit?: string;
    notes?: string;
    preferredDeliveryDate?: string; 
}

/**
 * Submit a Request for Quote (RFQ) to a seller
 */
async function _submitQuoteRequestAction(data: QuoteRequestData): Promise<ActionResponse<{ message: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // `sellerId` and `productName` arrived from the caller and went straight
        // into a notification: the recipient id and the body text were both
        // whatever the request said.
        //
        // So this was an open endpoint for sending a platform notification to
        // ANY user, with an attacker-chosen product name in the message and the
        // marketplace's own branding around it. A phishing primitive.
        //
        // This codebase has fixed the identical shape twice already.
        // _submitLandInquiryAction took listingOwnerId and listingTitle from the
        // request and now reads them from the listing, with a comment saying
        // exactly this; and createReviewAction reads the product to attribute a
        // review to "the ACTUAL seller". This is the third instance.
        //
        // Both values come from the record now, and the record has to exist —
        // which it never had to before, so a quote could be raised against a
        // productId that was never a product.
        //
        // TWO KINDS OF SUBJECT, AND A REGRESSION THIS AUDIT CAUSED
        // --------------------------------------------------------
        // QuoteRequestModal is mounted in TWO places. marketplace/products/[id]
        // passes a marketplace product. export/(app)/opportunities passes an
        // EXPORT WINDOW — `item.id` is a document in `exportWindows`, and
        // `sellerId` is the literal string "admin_export".
        //
        // When #161 added the PRODUCTS lookup above, it looked up an export
        // window id in the products collection, found nothing, and returned
        // "Product not found". Every RFQ raised from the export opportunities
        // page has failed since that commit. The fix that closed a real
        // phishing primitive broke a second caller nobody checked for — the
        // exact shape of "we fix it and it breaks somewhere else".
        //
        // It was not working before either, for a different reason: the
        // notification below was addressed to `sellerId`, so export RFQs were
        // being filed against a user id of "admin_export" that no account has.
        // They were written and delivered to nobody.
        //
        // An export window HAS a real counterparty — `createdBy`, the admin who
        // opened it, written from the session by createExportWindowAction. That
        // is who the quote is with, so that is who it is recorded against and
        // notified.
        let sellerId: string;
        let productName: string;
        let subjectType: "product" | "export_window";

        const productSnap = await db.collection(COLLECTIONS.PRODUCTS).doc(data.productId).get();
        if (productSnap.exists) {
            const product = productSnap.data() ?? {};
            sellerId = String(product.sellerId ?? "");
            if (!sellerId) {
                return { success: false as const, error: "This product has no seller to contact", data: null };
            }
            productName = String(product.title ?? product.name ?? "this product");
            subjectType = "product";
        } else {
            const windowSnap = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.productId).get();
            if (!windowSnap.exists) {
                return { success: false as const, error: "Product not found", data: null };
            }
            const exportWindow = windowSnap.data() ?? {};
            sellerId = String(exportWindow.createdBy ?? "");
            if (!sellerId) {
                // Older windows predate createdBy being written from the
                // session. Refusing is better than filing a quote against "",
                // which _getMyQuotesAction would hand to nobody.
                return {
                    success: false as const,
                    error: "This export window has no contact recorded. Please use the booking form instead.",
                    data: null,
                };
            }
            productName = String(exportWindow.title ?? "this export window");
            subjectType = "export_window";
        }

        // A quote for zero or minus one is not a quote. The field is a number in
        // the interface and that is a TypeScript claim, erased before the request
        // arrives.
        const quantity = Number(data.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return { success: false as const, error: "Quantity must be a positive number", data: null };
        }

        // Fields listed, not spread.
        //
        // `...data` came first and the derived values after it, so the caller's
        // own sellerId and productName were recorded nowhere — which is what the
        // comment above is about. That is the OVERWRITE half. The spread still
        // wrote any field the caller invented, because the declared parameter
        // type is erased before the request arrives, and nothing below mentions
        // the fields a future seller-response flow would add (a quoted price, a
        // response, an accepted-at). Seven fields are wanted from the request;
        // seven are written.
        const quoteRef = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).add({
            productId: data.productId,
            ...(data.unit !== undefined ? { unit: data.unit } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            ...(data.preferredDeliveryDate !== undefined
                ? { preferredDeliveryDate: data.preferredDeliveryDate }
                : {}),
            sellerId,
            productName,
            // Which collection productId points into. Without it a reader
            // cannot tell a marketplace quote from an export-window one, and
            // the two link to different places.
            subjectType,
            quantity,
            buyerId: userId,
            buyerName: session.user.name || "Unknown Buyer",
            buyerEmail: session.user.email,
            status: "pending",
            _version: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        });

        await db.collection(COLLECTIONS.NOTIFICATIONS).add({
            // The record's counterparty, not the caller's nominee.
            userId: sellerId,
            type: "marketplace",
            title: "New Quote Request",
            message: `You have received a new quote request for "${productName}" from ${session.user.name || "a buyer"}.`,
            // The LIST, not a per-quote detail page.
            //
            // This linked to `/marketplace/seller/quotes/${quoteRef.id}`, and
            // no such route exists — nor did `/marketplace/seller/quotes`, nor
            // `/marketplace/buyer/quotes`, which the revalidatePath below
            // named. A seller clicking the notification got a 404, and
            // getMyQuotesAction had no UI caller at all: an RFQ was written,
            // the buyer was told it succeeded, and neither party could ever
            // see it.
            //
            // Both list pages exist now. A per-quote detail page does not, and
            // is not invented here — there is no seller-response flow for it
            // to show.
            link: `/marketplace/seller/quotes`,
            read: false,
            createdAt: FieldValue.serverTimestamp()
        });

        revalidatePath("/marketplace/buyer/quotes");
        revalidatePath("/marketplace/seller/quotes");
        revalidatePath(`/marketplace/products/${data.productId}`);

        return { error: null, success: true as const, data: { message: "Quote request submitted successfully" } };
    } catch (error) { 
        logger.error("Submit quote request error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to submit quote request. Please try again later.", data: null };
    }
}
export const submitQuoteRequestAction = withSafeAction("submitQuoteRequestAction", _submitQuoteRequestAction);

/**
 * Fetch quotes for the current user (either as buyer or seller)
 */
async function _getMyQuotesAction(role: "buyer" | "seller"): Promise<ActionResponse<{ quotes: any[] }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const field = role === "buyer" ? "buyerId" : "sellerId";
        
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES)
            .where(field, "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const quotes = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: { quotes } };
    } catch (error) { 
        logger.error("Get my quotes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch quotes", data: null };
    }
}
export const getMyQuotesAction = withSafeAction("getMyQuotesAction", _getMyQuotesAction);

