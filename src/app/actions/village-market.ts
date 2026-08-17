/**
 * Village Market (Flash Sales) — Server Actions
 *
 * The Village Market is a timed marketplace event where:
 * - Platform sellers can join and list flash-sale products
 * - Admin can add external merchants (off-platform) as display cards
 * - Events can be one-off or recurring (e.g., every Saturday)
 */

"use server";

import { ActionResponse } from "@/lib/safe-action";

import { supabaseDb as db } from "@/lib/supabase-db";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import type {
    VillageMarketEvent,
    FlashSaleProduct,
    ExternalMerchant,
} from "@/lib/types/marketplace";
import { notifyVillageMarketCreated } from "@/lib/marketplace-notifications";
import { isAdmin } from "@/lib/admin-permissions";
import { hydrateSellerTrust } from "@/lib/seller-trust";

// ---------------------------------------------------------------------------
// Admin: Create a Village Market Event
// ---------------------------------------------------------------------------

export async function createVillageMarketEventAction(data: {
    title: string;
    description?: string;
    location: string;
    state: string;
    lga?: string;
    startTime: string; // ISO string
    endTime: string;   // ISO string
    isRecurring?: boolean;
    recurringDay?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        // Admins only
        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized: admin role required" , data: null };
        }

        const startTime = new Date(data.startTime);
        const endTime = new Date(data.endTime);

        if (endTime <= startTime) {
            return { success: false as const, error: "End time must be after start time" , data: null };
        }

        const eventDoc = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).add({
            title: data.title,
            description: data.description || null,
            location: data.location,
            state: data.state,
            lga: data.lga || null,
            startTime,
            endTime,
            isRecurring: data.isRecurring || false,
            recurringDay: data.recurringDay || null,
            status: startTime > new Date() ? "upcoming" : "active",
            participantSellerIds: [],
            externalMerchants: [],
            createdBy: userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Notify all approved sellers about the new event
        const sellersSnap = await db.collection(COLLECTIONS.USERS)
            .where("sellerVerificationStatus", "==", "approved")
            .select()
            .get();
        const sellerIds = sellersSnap.docs.map((d) => d.id);

        await notifyVillageMarketCreated({
            eventId: eventDoc.id,
            eventTitle: data.title,
            sellerIds,
            startTime,
        });

        return { error: null, success: true as const, eventId: eventDoc.id , data: null };
    } catch (err: any) {
        logger.error("createVillageMarketEventAction error:", err);
        return { success: false as const, error: err.message || "Failed to create event" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Public: Get Active / Upcoming Village Market Events
// ---------------------------------------------------------------------------

export async function getActiveVillageMarketEventsAction(): Promise<VillageMarketEvent[]> {
    try {
        const now = new Date();
        const snap = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS)
            .where("status", "in", ["upcoming", "active"])
            .where("endTime", ">", now)
            .orderBy("endTime", "asc")
            .limit(20)
            .get();

        return serializeDocs(snap.docs) as unknown as VillageMarketEvent[];
    } catch (err) {
        logger.error("getActiveVillageMarketEventsAction error:", err);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Public: Get a single Village Market Event (with its flash-sale products)
// ---------------------------------------------------------------------------

export async function getVillageMarketEventAction(eventId: string): Promise<{
    event: VillageMarketEvent | null;
    products: FlashSaleProduct[];
}> {
    try {
        const eventDoc = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).get();
        if (!eventDoc.exists) return { event: null, products: [] };
        const event = serializeDoc(eventDoc.id, eventDoc.data()) as unknown as VillageMarketEvent;

        let productsSnap;
        try {
            productsSnap = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS)
                .where("eventId", "==", eventId)
                .where("status", "==", "active")
                .orderBy("createdAt", "desc")
                .get();
        } catch (err: any) {
            if (err?.message && err.message.includes("requires an index")) {
                logger.warn("getVillageMarketEventAction products query failed due to missing index. Falling back.", { error: err.message });
                productsSnap = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS)
                    .where("eventId", "==", eventId)
                    .where("status", "==", "active")
                    .get();

                const products = serializeDocs(productsSnap.docs) as unknown as FlashSaleProduct[];
                products.sort((a, b) => {
                    const timeA = (a.createdAt as any)?.toDate ? (a.createdAt as any).toDate().getTime() : new Date((a.createdAt as any) || 0).getTime();
                    const timeB = (b.createdAt as any)?.toDate ? (b.createdAt as any).toDate().getTime() : new Date((b.createdAt as any) || 0).getTime();
                    return timeB - timeA;
                });
                return { event, products };
            }
            throw err;
        }

        const products = serializeDocs(productsSnap.docs) as unknown as FlashSaleProduct[];
        return { event, products };
    } catch (err) {
        logger.error("getVillageMarketEventAction error:", err);
        return { event: null, products: [] };
    }
}

// ---------------------------------------------------------------------------
// Seller: Join a Village Market Event
// ---------------------------------------------------------------------------

export async function joinVillageMarketEventAction(
    eventId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        // Must be an approved seller
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (userDoc.data()?.sellerVerificationStatus !== "approved") {
            return { success: false as const, error: "Your seller account must be approved to join Village Market events" , data: null };
        }

        const eventRef = db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) return { success: false as const, error: "Event not found" , data: null };

        const eventData = eventDoc.data()!;
        if (!["upcoming", "active"].includes(eventData.status)) {
            return { success: false as const, error: "This event is no longer accepting participants" , data: null };
        }

        await eventRef.update({
            participantSellerIds: FieldValue.arrayUnion(userId),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const , data: null };
    } catch (err: any) {
        logger.error("joinVillageMarketEventAction error:", err);
        return { success: false as const, error: err.message || "Failed to join event" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Seller: Add a Flash Sale Product to an Event
// ---------------------------------------------------------------------------

export async function addFlashSaleProductAction(data: {
    eventId: string;
    title: string;
    description?: string;
    price: number;
    flashPrice?: number;
    unit?: string;
    availableQuantity?: number;
    imageUrl?: string;
    productId?: string; // Reference to existing marketplace product
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        // Check event exists and is accepting products
        const eventDoc = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(data.eventId).get();
        if (!eventDoc.exists) return { success: false as const, error: "Event not found" , data: null };

        const eventData = eventDoc.data()!;
        const participantIds: string[] = eventData.participantSellerIds || [];
        if (!participantIds.includes(userId)) {
            return { success: false as const, error: "You must join the event before listing products" , data: null };
        }

        // The listed price has to be a real one.
        //
        // `price` and `flashPrice` were written straight through from the
        // caller, and marketplace/_payment.ts multiplies the stored price by the
        // quantity to build the order. A negative price there is not caught by
        // anything downstream — the quantity stays positive so the stock
        // decrement succeeds and the order completes — leaving that seller's
        // escrow with a negative grossAmount while a co-seller's is whole, and
        // the platform owing money it never collected.
        //
        // Checkout now refuses a non-positive stored price as well. This is the
        // source; that is the boundary. Both, because this is not the only way a
        // price gets written: PricingTierSchema is `z.number().default(0)`.
        const price = Number(data.price);
        if (!Number.isFinite(price) || price <= 0) {
            return { success: false as const, error: "Price must be greater than zero", data: null };
        }

        const flashPrice = data.flashPrice === undefined || data.flashPrice === null
            ? null
            : Number(data.flashPrice);
        if (flashPrice !== null && (!Number.isFinite(flashPrice) || flashPrice <= 0)) {
            return { success: false as const, error: "Flash price must be greater than zero", data: null };
        }
        if (flashPrice !== null && flashPrice > price) {
            return { success: false as const, error: "Flash price cannot be higher than the normal price", data: null };
        }

        const availableQuantity = data.availableQuantity === undefined || data.availableQuantity === null
            ? null
            : Number(data.availableQuantity);
        if (availableQuantity !== null && (!Number.isInteger(availableQuantity) || availableQuantity < 0)) {
            return { success: false as const, error: "Available quantity must be a whole number", data: null };
        }

        const docRef = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS).add({
            eventId: data.eventId,
            sellerId: userId,
            title: data.title,
            description: data.description || null,
            price,
            flashPrice,
            unit: data.unit || null,
            availableQuantity,
            imageUrl: data.imageUrl || null,
            productId: data.productId || null,
            externalMerchantId: null,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const, flashProductId: docRef.id , data: null };
    } catch (err: any) {
        logger.error("addFlashSaleProductAction error:", err);
        return { success: false as const, error: err.message || "Failed to add product" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Admin: Add an External (Off-Platform) Merchant to an Event
// ---------------------------------------------------------------------------

export async function addExternalMerchantAction(
    eventId: string,
    merchant: Omit<ExternalMerchant, "id">
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized: admin role required" , data: null };
        }

        const merchantId = `ext_${Date.now()}`;
        const newMerchant: ExternalMerchant = { id: merchantId, ...merchant };

        await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).update({
            externalMerchants: FieldValue.arrayUnion(newMerchant),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const, merchantId , data: null };
    } catch (err: any) {
        logger.error("addExternalMerchantAction error:", err);
        return { success: false as const, error: err.message || "Failed to add merchant" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Admin: Update Event Status (manual override: active / ended / cancelled)
// ---------------------------------------------------------------------------

export async function updateVillageMarketEventStatusAction(
    eventId: string,
    status: "active" | "ended" | "cancelled"
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).update({
            status,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const , data: null };
    } catch (err: any) {
        logger.error("updateVillageMarketEventStatusAction error:", err);
        return { success: false as const, error: err.message || "Failed to update event status" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Seller: Remove own flash-sale product
// ---------------------------------------------------------------------------

export async function removeFlashSaleProductAction(
    flashProductId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        const docRef = db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS).doc(flashProductId);
        const doc = await docRef.get();
        if (!doc.exists) return { success: false as const, error: "Product not found" , data: null };
        if (doc.data()?.sellerId !== userId) return { success: false as const, error: "Unauthorized" , data: null };

        await docRef.update({ status: "removed", updatedAt: FieldValue.serverTimestamp() });
        return { error: null, success: true as const , data: null };
    } catch (err: any) {
        logger.error("removeFlashSaleProductAction error:", err);
        return { success: false as const, error: err.message || "Failed to remove product" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Admin: Get Paginated Village Market Events
// ---------------------------------------------------------------------------

export async function getAdminVillageMarketEventsAction(options: {
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , data: null };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const fetchLimit = options.limit || 25;
        const sortDirection = options.sortOrder || "desc";
        let query = db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).orderBy("createdAt", sortDirection);

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snap = await query.limit(fetchLimit + 1).get();
        const hasMore = snap.docs.length > fetchLimit;
        const docs = hasMore ? snap.docs.slice(0, fetchLimit) : snap.docs;

        const events = serializeDocs(docs) as unknown as VillageMarketEvent[];
        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            error: null, success: true as const, 
            data: events,
            lastDocId: nextCursor,
            hasMore
        };
    } catch (err: any) {
        logger.error("getAdminVillageMarketEventsAction error:", err);
        return { success: false as const, error: err.message || "Failed to fetch market events" , data: null };
    }
}

// ---------------------------------------------------------------------------
// Public: Get All Active Flash Sale Products (across all events)
// ---------------------------------------------------------------------------
export async function getActiveFlashSaleProductsAction(): Promise<FlashSaleProduct[]> {
    try {
        const snap = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS)
            .where("status", "==", "active")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();

        const products = serializeDocs(snap.docs) as unknown as FlashSaleProduct[];
        
        // Seller name AND badge, one read per unique seller.
        //
        // This already batched by unique sellerId — the pattern is unchanged. Two
        // things are different. The fallback name was "Verified Seller", so a
        // seller with no name recorded was labelled verified in the name field
        // itself. And the badge was not resolved at all: the buyer products page
        // mapped these rows into a Product with `sellerVerified: true` hardcoded,
        // so every Village Market listing showed the verified shield. Returning
        // the real value here is what lets that page stop inventing one.
        return hydrateSellerTrust(products as any[], async (id) => {
            const snap = await db.collection(COLLECTIONS.USERS).doc(id).get();
            return snap.exists ? (snap.data() ?? null) : null;
        });
    } catch (err) {
        logger.error("getActiveFlashSaleProductsAction error:", err);
        return [];
    }
}

