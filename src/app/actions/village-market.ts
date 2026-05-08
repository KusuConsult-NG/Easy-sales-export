/**
 * Village Market (Flash Sales) — Server Actions
 *
 * The Village Market is a timed marketplace event where:
 * - Platform sellers can join and list flash-sale products
 * - Admin can add external merchants (off-platform) as display cards
 * - Events can be one-off or recurring (e.g., every Saturday)
 */

"use server";

import { db } from "@/lib/firebase-admin";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { FieldValue } from "firebase-admin/firestore";
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
}): Promise<{ error: null, success: true | false; eventId?: string; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        // Admins only
        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized: admin role required" };
        }

        const startTime = new Date(data.startTime);
        const endTime = new Date(data.endTime);

        if (endTime <= startTime) {
            return { success: false as const, error: "End time must be after start time" };
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

        return { error: null, success: true as const, eventId: eventDoc.id };
    } catch (err: any) {
        logger.error("createVillageMarketEventAction error:", err);
        return { success: false as const, error: err.message || "Failed to create event" };
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
        const [eventDoc, productsSnap] = await Promise.all([
            db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).get(),
            db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS)
                .where("eventId", "==", eventId)
                .where("status", "==", "active")
                .orderBy("createdAt", "desc")
                .get(),
        ]);

        if (!eventDoc.exists) return { event: null, products: [] };

        const event = serializeDoc(eventDoc.id, eventDoc.data()) as unknown as VillageMarketEvent;
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
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        // Must be an approved seller
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (userDoc.data()?.sellerVerificationStatus !== "approved") {
            return { success: false as const, error: "Your seller account must be approved to join Village Market events" };
        }

        const eventRef = db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) return { success: false as const, error: "Event not found" };

        const eventData = eventDoc.data()!;
        if (!["upcoming", "active"].includes(eventData.status)) {
            return { success: false as const, error: "This event is no longer accepting participants" };
        }

        await eventRef.update({
            participantSellerIds: FieldValue.arrayUnion(userId),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true };
    } catch (err: any) {
        logger.error("joinVillageMarketEventAction error:", err);
        return { success: false as const, error: err.message || "Failed to join event" };
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
}): Promise<{ error: null, success: true | false; flashProductId?: string; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        // Check event exists and is accepting products
        const eventDoc = await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(data.eventId).get();
        if (!eventDoc.exists) return { success: false as const, error: "Event not found" };

        const eventData = eventDoc.data()!;
        const participantIds: string[] = eventData.participantSellerIds || [];
        if (!participantIds.includes(userId)) {
            return { success: false as const, error: "You must join the event before listing products" };
        }

        const docRef = await db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS).add({
            eventId: data.eventId,
            sellerId: userId,
            title: data.title,
            description: data.description || null,
            price: data.price,
            flashPrice: data.flashPrice || null,
            unit: data.unit || null,
            availableQuantity: data.availableQuantity || null,
            imageUrl: data.imageUrl || null,
            productId: data.productId || null,
            externalMerchantId: null,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const, flashProductId: docRef.id };
    } catch (err: any) {
        logger.error("addFlashSaleProductAction error:", err);
        return { success: false as const, error: err.message || "Failed to add product" };
    }
}

// ---------------------------------------------------------------------------
// Admin: Add an External (Off-Platform) Merchant to an Event
// ---------------------------------------------------------------------------

export async function addExternalMerchantAction(
    eventId: string,
    merchant: Omit<ExternalMerchant, "id">
): Promise<{ error: null, success: true | false; merchantId?: string; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized: admin role required" };
        }

        const merchantId = `ext_${Date.now()}`;
        const newMerchant: ExternalMerchant = { id: merchantId, ...merchant };

        await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).update({
            externalMerchants: FieldValue.arrayUnion(newMerchant),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true as const, merchantId };
    } catch (err: any) {
        logger.error("addExternalMerchantAction error:", err);
        return { success: false as const, error: err.message || "Failed to add merchant" };
    }
}

// ---------------------------------------------------------------------------
// Admin: Update Event Status (manual override: active / ended / cancelled)
// ---------------------------------------------------------------------------

export async function updateVillageMarketEventStatusAction(
    eventId: string,
    status: "active" | "ended" | "cancelled"
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).doc(eventId).update({
            status,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true };
    } catch (err: any) {
        logger.error("updateVillageMarketEventStatusAction error:", err);
        return { success: false as const, error: err.message || "Failed to update event status" };
    }
}

// ---------------------------------------------------------------------------
// Seller: Remove own flash-sale product
// ---------------------------------------------------------------------------

export async function removeFlashSaleProductAction(
    flashProductId: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        const docRef = db.collection(COLLECTIONS.FLASH_SALE_PRODUCTS).doc(flashProductId);
        const doc = await docRef.get();
        if (!doc.exists) return { success: false as const, error: "Product not found" };
        if (doc.data()?.sellerId !== userId) return { success: false as const, error: "Unauthorized" };

        await docRef.update({ status: "removed", updatedAt: FieldValue.serverTimestamp() });
        return { error: null, success: true };
    } catch (err: any) {
        logger.error("removeFlashSaleProductAction error:", err);
        return { success: false as const, error: err.message || "Failed to remove product" };
    }
}

// ---------------------------------------------------------------------------
// Admin: Get Paginated Village Market Events
// ---------------------------------------------------------------------------

export async function getAdminVillageMarketEventsAction(options: {
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}): Promise<{
    error: null, success: true | false;
    data?: VillageMarketEvent[];
    error?: string;
    lastDocId?: string;
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" };
        const userId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
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
        return { success: false as const, error: err.message || "Failed to fetch market events" };
    }
}
