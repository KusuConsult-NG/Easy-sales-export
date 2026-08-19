"use server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product, Order, ProductCategory } from "@/lib/types/marketplace";
import { withSafeAction } from "@/lib/safe-action";
import { FieldValue } from "@/lib/firestore-compat";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { isActiveEscrowStatus } from "@/lib/escrow-status";
import { ORDER_CONFIRMABLE_FROM, hasReservedStock } from "@/lib/order-status";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";
import { ProductSchema } from "@/lib/validations/marketplace";
import { notifyOrderCancelled } from "@/lib/marketplace-notifications";

import { runQueryWithRetry } from "@/lib/firestore-utils";
import { hydrateSellerTrust } from "@/lib/seller-trust";

/**
 * Reads a seller's user document, for hydrateSellerTrust.
 *
 * THIS FILE WAS MISSED THE FIRST TIME
 * -----------------------------------
 * The seller-badge fix covered _mp_catalog.ts, village-market.ts and the public
 * products API — and not this file, which is where getProductsAction lives. That
 * is the action /marketplace/buyer/products calls, and that page is the one
 * rendering the verified shield. So the three readers that were fixed are not
 * the reader that feeds the page the defect was reported against, and the badge
 * there was still the create-time snapshot for every non-flash product.
 *
 * Fixing readers by hand from a list is what allowed that. The test now
 * enumerates every action in this directory that returns products and requires
 * each one to hydrate, rather than naming three.
 */
async function readSeller(sellerId: string): Promise<Record<string, any> | null> {
    const snap = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
    return snap.exists ? (snap.data() ?? null) : null;
}

/**
 * The most a single unpaginated product query may return.
 *
 * _getProductsAction's primary query had NO limit — only its index-error
 * fallback did, at 300. So the healthy path was unbounded and the degraded path
 * was capped, which is backwards: every active product was loaded and then
 * filtered in memory for price, search term and LGA.
 */
const PRODUCT_QUERY_CAP = 300;

// ============================================================================
// PRODUCT BROWSING
// ============================================================================

export interface ProductFilters { 
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    state?: string;
    lga?: string;
    bulkAvailable?: boolean;
    exportReady?: boolean;
    searchTerm?: string; 
}

const categoryMapping: Record<string, string[]> = {
    grains: ["grains", "cereal", "cereals"],
    roots: ["roots", "roots_tubers", "roots & tubers", "tuber", "tubers", "yam", "yams", "cassava"],
    vegetables: ["vegetables", "vegetable", "horticultural"],
    fruits: ["fruits", "fruit"],
    nuts: ["nuts", "nut", "seed", "seeds", "sesame", "sesame seeds", "sesame_seeds"],
    spices: ["spices", "spices_herbs_seasonings", "spices & herbs", "spices_herbs", "hibiscus", "zobo"],
    livestock: ["livestock"],
    poultry: ["poultry"],
    dairy: ["dairy", "dairy & eggs", "dairy_eggs"],
    processed: ["processed", "processed foods", "processed_foods", "natural_oils", "beverages"],
    organic: ["organic", "organics"],
    sea_foods: ["sea_foods", "fishery"],
    fishery: ["fishery", "sea_foods"],
};

/**
 * Get products with filtering
 */
async function _getProductsAction(filters?: ProductFilters): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");

        // Apply Firestore-supported filters
        if (filters?.category && filters.category !== "all") { 
            const mapped = categoryMapping[filters.category.toLowerCase()] || [filters.category];
            if (mapped.length > 1) {
                query = query.where("category", "in", mapped);
            } else {
                query = query.where("category", "==", mapped[0]);
            }
        }

        if (filters?.state) { 
            query = query.where("location.state", "==", filters.state);
        }

        if (filters?.bulkAvailable) { 
            query = query.where("bulkAvailable", "==", true);
        }

        if (filters?.exportReady) { 
            query = query.where("exportReady", "==", true);
        }

        let snapshot;
        let indexError = false;
        try {
            snapshot = await runQueryWithRetry(() => query.limit(PRODUCT_QUERY_CAP).get());
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || String(e.code) === "failed_precondition" || errMsg.includes("precondition")) {
                logger.warn("Get products failed due to missing index. Falling back to in-memory filters.", { filters, error: e.message });
                indexError = true;
                
                // Fallback: only filter by status and category at DB level
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");
                if (filters?.category && filters.category !== "all") {
                    const mapped = categoryMapping[filters.category.toLowerCase()] || [filters.category];
                    if (mapped.length > 1) {
                        fallbackQuery = fallbackQuery.where("category", "in", mapped);
                    } else {
                        fallbackQuery = fallbackQuery.where("category", "==", mapped[0]);
                    }
                }
                snapshot = await runQueryWithRetry(() => fallbackQuery.limit(PRODUCT_QUERY_CAP).get());
            } else {
                throw e;
            }
        }

        let products: Product[] = [];
        if (indexError) {
            // DISEASE 5 FIX: serialize first to convert Timestamps before in-memory filtering
            let productsData = serializeDocs(snapshot.docs);
            
            // Apply filtered states in-memory
            if (filters?.state) {
                productsData = productsData.filter((p: any) => p.location?.state === filters.state);
            }
            if (filters?.bulkAvailable) {
                productsData = productsData.filter((p: any) => p.bulkAvailable === true);
            }
            if (filters?.exportReady) {
                productsData = productsData.filter((p: any) => p.exportReady === true);
            }
            
            products = productsData as unknown as Product[];
        } else {
            products = serializeDocs<Product>(snapshot.docs);
        }

        // Client-side filters (for complex/non-indexed queries)
        if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) { 
            products = products.filter(product => {
                const price = product.pricingTiers[0]?.price || 0;
                const meetsMin = filters.minPrice === undefined || price >= filters.minPrice;
                const meetsMax = filters.maxPrice === undefined || price <= filters.maxPrice;
                return meetsMin && meetsMax;
            });
        }

        if (filters?.searchTerm) { 
            const term = filters.searchTerm.toLowerCase();
            products = products.filter(product =>
                product.title?.toLowerCase()?.includes(term) ||
                product.description?.toLowerCase()?.includes(term)
            );
        }

        if (filters?.lga) {
            products = products.filter(product => product.location.lga === filters.lga);
        }

        // Seller name and badge, live — see readSeller above for why this file
        // in particular needed it. Applied after every filter, so the reads are
        // only spent on rows actually being returned.
        const withTrust = await hydrateSellerTrust(products as any[], readSeller);

        return { error: null, success: true as const, data: { products: withTrust as Product[] } };
    } catch (error) { 
        logger.error("Get products error:", { filters, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}
export const getProductsAction = withSafeAction("getProductsAction", _getProductsAction);



/**
 * Get featured products (most orders)
 */
async function _getFeaturedProductsAction(): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        let snapshot;
        let indexError = false;
        try {
            snapshot = await db.collection(COLLECTIONS.PRODUCTS)
                .where("status", "==", "active")
                .orderBy("orders", "desc")
                .limit(8)
                .get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Get featured products failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                snapshot = await db.collection(COLLECTIONS.PRODUCTS)
                    .where("status", "==", "active")
                    .limit(50) // limit more since we'll sort in memory and slice
                    .get();
            } else {
                throw e;
            }
        }

        // DISEASE 5 FIX: serialize immediately to prevent Timestamps crashing sorting/rendering
        let products = serializeDocs<Product>(snapshot.docs);
        
        if (indexError) {
            products.sort((a: any, b: any) => {
                const aOrders = (a as any).orders || 0;
                const bOrders = (b as any).orders || 0;
                return bOrders - aOrders;
            });
            products = products.slice(0, 8);
        }
        
        const withTrust = await hydrateSellerTrust(products as any[], readSeller);

        return { error: null, success: true as const, data: { products: serializeValue(withTrust) } };
    } catch (error) {
        logger.error("Get featured products error:", error);
        return { success: false as const, error: "Failed to fetch featured products", data: null };
    }
}
export const getFeaturedProductsAction = withSafeAction("getFeaturedProductsAction", _getFeaturedProductsAction);

/**
 * Get products by category
 */
async function _getProductsByCategoryAction(category: string): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("category", "==", category)
            .limit(PRODUCT_QUERY_CAP)
            .get();

        const withTrust = await hydrateSellerTrust(
            serializeDocs<Product>(snapshot.docs) as any[],
            readSeller,
        );

        return { error: null, success: true as const, data: { products: withTrust as Product[] } };
    } catch (error) { 
        logger.error("Get products by category error:", { category, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to fetch products by category", data: null };
    }
}
export const getProductsByCategoryAction = withSafeAction("getProductsByCategoryAction", _getProductsByCategoryAction);

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================



/**
 * Confirm order receipt (releases escrow)
 */
async function _confirmOrderReceiptAction(orderId: string): Promise<ActionResponse<{ success: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) { 
            return { success: false as const, error: "Order not found", data: null };
        }

        const orderData = orderDoc.data();
        if (orderData?.buyerId !== userId) { 
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Claimed, not checked-then-written.
        //
        // The status check was an ordinary read followed by an update inside
        // runTransaction — which takes NO lock in this adapter (see the note at
        // the top of lib/types/marketplace-escrow.ts). Two clicks both passed the
        // check and both wrote, incrementing _version twice and confirming
        // receipt twice.
        // The shared set. This was `["in_transit", "processing", "shipped"]`, and
        // "in_transit" is an ESCROW status — no order ever holds it, so the list
        // read as though a fourth state were supported when it was a dead entry.
        const orderClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: orderId,
            fromAny: [...ORDER_CONFIRMABLE_FROM],
            to: "delivered",
            patch: {
                buyerConfirmed: true,
                buyerConfirmedAt: new Date().toISOString(),
            },
        });

        if (!orderClaim.claimed) {
            return {
                success: false as const,
                error: orderClaim.status
                    ? `This order is '${orderClaim.status}' and receipt cannot be confirmed from that state`
                    : "Order is not in a confirmable state",
                data: null,
            };
        }

        // Only the escrow that is still live for this order.
        //
        // This updated EVERY escrow row matching the orderId, including ones
        // already released or refunded — writing "delivered" over a settled
        // status and making a finished transaction look unfinished.
        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("orderId", "==", orderId).get();

        for (const doc of escrowQuery.docs) {
            if (!isActiveEscrowStatus(doc.data()?.status)) continue;

            // "delivered" is a real escrow status — see lib/escrow-status.ts —
            // and every release path accepts it. It did NOT accept it before:
            // the admin release claimed from "funded" alone, so confirming
            // receipt used to make the escrow unreleasable by an admin, and a
            // dispute raised afterwards did not freeze it.
            await claimStatusTransitionFromAny({
                collection: COLLECTIONS.ESCROW_TRANSACTIONS,
                id: doc.id,
                fromAny: ["funded", "in_transit"],
                to: "delivered",
                patch: { deliveredAt: new Date().toISOString() },
            });
        }

        return { error: null, success: true as const, data: { success: true } };
    } catch (error) { 
        logger.error("Confirm receipt error:", { userId: sessionResult?.session?.user?.id, orderId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to confirm receipt", data: null };
    }
}
export const confirmOrderReceiptAction = withSafeAction("confirmOrderReceiptAction", _confirmOrderReceiptAction);

/**
 * Cancel a pending order (reverts product inventory and updates status)
 */
async function _cancelOrderAction(orderId: string): Promise<ActionResponse<{ success: boolean }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false as const, error: "Order not found", data: null };
        }

        const orderData = orderDoc.data();
        if (orderData?.buyerId !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const items = orderData.items || [];
        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("orderId", "==", orderId).get();

        // WHAT WAS WRONG HERE
        // -------------------
        // Two defects stacked on one another, and the second is the nastier.
        //
        // 1. `status !== "pending_payment"` was a check-then-write with no
        //    lock, and what followed puts stock BACK. Two cancellations of one
        //    order both passed and both restocked.
        //
        // 2. The restock was an ABSOLUTE write — `currentQty + item.quantity`,
        //    computed in JavaScript from a value read moments earlier. That
        //    does not merely double on a concurrent cancel: it erases any
        //    OTHER write to availableQuantity in between. A buyer purchasing
        //    the same product while this ran had their decrement overwritten,
        //    so the stock the shop thinks it holds is higher than it is, and
        //    the next purchase oversells.
        //
        // The transition is claimed, and the restock is an increment applied in
        // SQL. Note this is a different bug from the identical-looking restock
        // in order-management.ts, which at least used FieldValue.increment.
        const cancelClaim = await claimStatusTransition({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: orderId,
            from: "pending_payment",
            to: "cancelled",
            patch: {
                paymentStatus: "cancelled",
                updatedAt: new Date().toISOString(),
            },
        });

        if (!cancelClaim.claimed) {
            return {
                success: false as const,
                error: cancelClaim.status === null
                    ? "Order not found"
                    : "Only pending orders can be cancelled",
                data: null,
            };
        }

        await (async () => {
            // 1. Revert product quantities — ONLY IF ANY WERE TAKEN.
            //
            // This restocked unconditionally, and the only status it can cancel
            // from is "pending_payment" — the state in which no stock has been
            // reserved at all. _initializeOrderPaymentAction writes the order
            // without touching availableQuantity; the reservation happens later
            // in _payment_verify, which moves the order off "pending_payment".
            //
            // So placing a Paystack order, not paying, and cancelling INCREASED
            // the seller's stock by the order quantity — repeatable, cumulative,
            // and it oversells afterwards, because decrementManyOrFail succeeds
            // against the inflated figure and the seller cannot ship.
            //
            // Written as the general rule rather than "never restock", so it
            // stays correct if the claimable set ever widens. See
            // hasReservedStock in lib/order-status.ts.
            if (hasReservedStock(orderData?.status)) {
                for (const item of items) {
                    if (item.productId && item.quantity) {
                        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                        await productRef.update({
                            availableQuantity: FieldValue.increment(item.quantity),
                            _version: FieldValue.increment(1),
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    }
                }
            }

            // 2. Order status is already written by the claim above.
            await orderRef.update({
                _version: FieldValue.increment(1)
            });

            // 3. Update escrow transactions status -> cancelled
            //
            // for...of, not forEach: these writes are awaited now, and an async
            // forEach callback would fire them without waiting.
            for (const doc of escrowQuery.docs) {
                await doc.ref.update({
                    status: "cancelled",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1)
                });
            }
        })();

        // 4. Trigger notification
        const primarySellerId = items[0]?.sellerId;
        if (primarySellerId) {
            notifyOrderCancelled({
                buyerId: userId,
                sellerId: primarySellerId,
                orderId,
                orderNumber: orderData.orderNumber || orderId,
                reason: "Cancelled by buyer",
                cancelledBy: "buyer"
            }).catch((e) => logger.error("[cancelOrderAction] Notification failed:", { userId, error: e }));
        }

        return { error: null, success: true as const, data: { success: true } };
    } catch (error) {
        logger.error("Cancel order error:", { userId: sessionResult?.session?.user?.id, orderId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to cancel order", data: null };
    }
}
export const cancelOrderAction = withSafeAction("cancelOrderAction", _cancelOrderAction);

async function _getMarketplaceStatsAction(): Promise<ActionResponse<{ productsCount: number; tradersCount: number }>> {
    try {
        const [productsSnap, sellersSnap] = await Promise.all([
            db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active").count().get(),
            db.collection(COLLECTIONS.USERS).where("sellerVerificationStatus", "==", "approved").count().get()
        ]);
        return {
            error: null,
            success: true as const,
            data: {
                productsCount: productsSnap.data().count,
                tradersCount: sellersSnap.data().count
            }
        };
    } catch (error) {
        logger.error("getMarketplaceStatsAction error:", error);
        return { success: false as const, error: "Failed to fetch marketplace statistics", data: null };
    }
}
export const getMarketplaceStatsAction = withSafeAction("getMarketplaceStatsAction", _getMarketplaceStatsAction);



