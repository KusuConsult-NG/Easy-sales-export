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
        // Both values come from the product now, and the product has to exist —
        // which it never had to before, so a quote could be raised against a
        // productId that was never a product.
        const productSnap = await db.collection(COLLECTIONS.PRODUCTS).doc(data.productId).get();
        if (!productSnap.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }
        const product = productSnap.data() ?? {};

        const sellerId = String(product.sellerId ?? "");
        if (!sellerId) {
            return { success: false as const, error: "This product has no seller to contact", data: null };
        }
        const productName = String(product.title ?? product.name ?? "this product");

        // A quote for zero or minus one is not a quote. The field is a number in
        // the interface and that is a TypeScript claim, erased before the request
        // arrives.
        const quantity = Number(data.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return { success: false as const, error: "Quantity must be a positive number", data: null };
        }

        const quoteRef = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).add({ 
            ...data,
            // After the spread, so the caller's copies are recorded nowhere.
            sellerId,
            productName,
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
            // The product's seller, not the caller's nominee.
            userId: sellerId,
            type: "marketplace",
            title: "New Quote Request",
            message: `You have received a new quote request for "${productName}" from ${session.user.name || "a buyer"}.`,
            link: `/marketplace/seller/quotes/${quoteRef.id}`,
            read: false,
            createdAt: FieldValue.serverTimestamp() 
        });

        revalidatePath("/marketplace/buyer/quotes");
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

