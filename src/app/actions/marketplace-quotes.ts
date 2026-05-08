"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { serializeDocs } from "@/lib/firestore-serialize";

export interface QuoteRequestData { productId: string;
    productName: string;
    sellerId: string;
    quantity: number;
    unit?: string;
    notes?: string;
    preferredDeliveryDate?: string; }

/**
 * Submit a Request for Quote (RFQ) to a seller
 */
async function _submitQuoteRequestAction(data: QuoteRequestData) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const quoteRef = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES).add({ ...data,
            buyerId: userId,
            buyerName: session.user.name || "Unknown Buyer",
            buyerEmail: session.user.email,
            status: "pending",
            _version: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        await db.collection(COLLECTIONS.NOTIFICATIONS).add({
            userId: data.sellerId,
            type: "marketplace",
            title: "New Quote Request",
            message: `You have received a new quote request for "${data.productName}" from ${session.user.name || "a buyer"}.`,
            link: `/marketplace/seller/quotes/${quoteRef.id}`,
            read: false,
            createdAt: FieldValue.serverTimestamp() });

        revalidatePath("/marketplace/buyer/quotes");
        revalidatePath(`/marketplace/products/${data.productId}`);

        return { error: null, success: true as const, data: null
        };
    } catch (error) { logger.error("Submit quote request error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to submit quote request. Please try again later.", data: null };
    }
}
export const submitQuoteRequestAction = withFlexibleSafeAction("submitQuoteRequestAction", _submitQuoteRequestAction);

/**
 * Fetch quotes for the current user (either as buyer or seller)
 */
async function _getMyQuotesAction(role: "buyer" | "seller") { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const field = role === "buyer" ? "buyerId" : "sellerId";
        
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_QUOTES)
            .where(field, "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const quotes = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Get my quotes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch quotes", data: null };
    }
}
export const getMyQuotesAction = withFlexibleSafeAction("getMyQuotesAction", _getMyQuotesAction);
