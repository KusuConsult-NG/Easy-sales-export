"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

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
export async function submitQuoteRequestAction(data: QuoteRequestData) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // 1. Create the quote record
        const quoteRef = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).add({
            ...data,
            buyerId: session.user.id,
            buyerName: session.user.name || "Unknown Buyer",
            buyerEmail: session.user.email,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Notify the seller
        await db.collection(COLLECTIONS.NOTIFICATIONS).add({
            userId: data.sellerId,
            type: "marketplace",
            title: "New Quote Request",
            message: `You have received a new quote request for "${data.productName}" from ${session.user.name || "a buyer"}.`,
            link: `/marketplace/seller/quotes/${quoteRef.id}`,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
        });

        revalidatePath("/marketplace/buyer/quotes");
        revalidatePath(`/marketplace/products/${data.productId}`);

        return { 
            success: true, 
            data: { quoteId: quoteRef.id },
            message: "Quote request submitted successfully. The seller has been notified."
        };
    } catch (error: any) {
        logger.error("Submit quote request error:", error);
        return { success: false, error: "Failed to submit quote request. Please try again later." };
    }
}

/**
 * Fetch quotes for the current user (either as buyer or seller)
 */
export async function getMyQuotesAction(role: "buyer" | "seller") {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error.error };
        const { session } = sessionResult;

        const field = role === "buyer" ? "buyerId" : "sellerId";
        
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES)
            .where(field, "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        const quotes = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate()?.toISOString(),
            updatedAt: doc.data().updatedAt?.toDate()?.toISOString(),
        }));

        return { success: true, data: quotes };
    } catch (error: any) {
        logger.error("Get my quotes error:", error);
        return { success: false, error: "Failed to fetch quotes" };
    }
}
