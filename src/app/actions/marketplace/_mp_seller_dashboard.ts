"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product, Order } from "@/lib/types/marketplace";
import { ProductSchema, OrderSchema, SellerAnalyticsSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { toMillis } from "@/lib/firestore-serialize";
import { countsAsSellerRevenue, orderAmount } from "@/lib/order-status";

/**
 * The most rows the analytics summary will read from each collection.
 *
 * Both queries were unbounded. A seller with a long history loaded every order
 * and every product to produce a handful of totals, and the monthly figures the
 * page leads with depend only on recent rows anyway.
 */
const SELLER_ANALYTICS_CAP = 2000;

/**
 * Get seller's products
 */
async function _getSellerProductsAction(options: { 
    limit?: number;
    lastId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc"; 
} = {}): Promise<ActionResponse<{ products: Product[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { 
            limit = 50,
            lastId,
            status,
            search,
            sortBy = "createdAt",
            sortDir = "desc"
        } = options;

        let query = db.collection(COLLECTIONS.PRODUCTS).where("sellerId", "==", userId);

        if (status && status !== "all" && status !== "low_stock") { 
            query = query.where("status", "==", status);
        }

        if (status === "low_stock") { 
            query = query.where("availableQuantity", "<", 50).where("availableQuantity", ">", 0);
        }

        // Apply startAfter if provided
        if (lastId) { 
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
            if (lastDoc.exists) query = query.startAfter(lastDoc);
        }

        query = query.limit(limit);

        let snapshot;
        let indexError = false;
        try { 
            // orderBy DOES NOT throw here. It throws on get() if missing index.
            // We apply orderBy, and if get() fails, we catch it.
            const orderedQuery = query.orderBy(sortBy, sortDir);
            snapshot = await orderedQuery.get();
        } catch (e: any) { 
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || String(e.code) === "failed_precondition" || errMsg.includes("precondition")) {
                logger.warn("Sorting failed, likely missing index. Falling back to unordered query.", { userId, error: e.message }); 
                indexError = true;
                
                // Rebuild query without orderBy
                let fallbackQuery = db.collection(COLLECTIONS.PRODUCTS).where("sellerId", "==", userId);
                if (status && status !== "all" && status !== "low_stock") { 
                    fallbackQuery = fallbackQuery.where("status", "==", status);
                }
                if (status === "low_stock") { 
                    fallbackQuery = fallbackQuery.where("availableQuantity", "<", 50).where("availableQuantity", ">", 0);
                }
                if (lastId) {
                    const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
                    if (lastDoc.exists) fallbackQuery = fallbackQuery.startAfter(lastDoc);
                }
                fallbackQuery = fallbackQuery.limit(limit);
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }
        const { serializeValue } = await import("@/lib/firestore-serialize");
        
        let products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            try {
                const parsed = ProductSchema.parse({ id: doc.id, ...data });
                return serializeValue(parsed);
            } catch {
                // Graceful fallback: return raw serialized data rather than crashing/losing the product
                return serializeValue({ id: doc.id, ...data });
            }
        });

        if (search) { 
            const searchLower = search.toLowerCase();
            products = products.filter((p: any) =>
                p.title?.toLowerCase()?.includes(searchLower) ||
                p.category?.toLowerCase()?.includes(searchLower)
            );
        }

        if (indexError) {
            // Sort in memory since the database query couldn't do it
            products.sort((a: any, b: any) => {
                let aVal = a[sortBy] || 0;
                let bVal = b[sortBy] || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                
                if (sortDir === "desc") {
                    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
                } else {
                    return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                }
            });
        }

        let newLastId = undefined;
        let hasMore = false;
        if (snapshot.docs.length === limit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { error: null, success: true as const, data: { products, lastId: newLastId, hasMore } };
    } catch (error) { 
        logger.error("Get seller products error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}

export const getSellerProductsAction = withSafeAction("getSellerProductsAction", _getSellerProductsAction);


/**
 * Get seller's orders
 */
async function _getSellerOrdersAction(options: { limit?: number;
    lastId?: string;
    status?: string;
    search?: string; } = {}): Promise<ActionResponse<{ orders: Order[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const { limit = 20, lastId, status, search } = options;

        const fetchLimit = search ? 5000 : limit;

        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

        if (status && status !== "all") { 
            query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("sellerIds", "array-contains", userId)
                .where("status", "==", status)
                .orderBy("createdAt", "desc");
        }

        if (lastId && !search) { 
            const lastDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(fetchLimit);

        let snapshot;
        let indexError = false;
        try {
            snapshot = await query.get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Get orders failed due to missing index. Falling back to unordered query.", { userId, error: e.message });
                indexError = true;
                
                let fallbackQuery = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                    .where("sellerIds", "array-contains", userId);
                if (status && status !== "all") {
                    fallbackQuery = fallbackQuery.where("status", "==", status);
                }
                if (lastId && !search) {
                    const lastDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(lastId).get();
                    if (lastDoc.exists) fallbackQuery = fallbackQuery.startAfter(lastDoc);
                }
                fallbackQuery = fallbackQuery.limit(fetchLimit);
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        let orders = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            try {
                const parsed = OrderSchema.parse({ id: doc.id, ...data });
                return serializeValue(parsed);
            } catch (e) {
                return serializeValue({ id: doc.id, ...data });
            }
        });

        // Server-assisted search
        if (search) { 
            const q = search.toLowerCase().trim();
            orders = orders.filter((o: any) => {
                const itemTitles = o.items?.map((item: any) => item.title).filter(Boolean) || [];
                const searchString = [
                    o.id,
                    o.buyerName,
                    o.buyerEmail,
                    ...itemTitles
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            }).slice(0, limit);
        }

        if (indexError && !search) {
            orders.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        let newLastId = undefined;
        let hasMore = false;

        if (!search && snapshot.docs.length === fetchLimit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { 
            error: null, 
            success: true as const, 
            data: { orders, lastId: newLastId, hasMore } 
        };
    } catch (error) { 
        logger.error("Get seller orders error:", {
            userId: sessionResult?.session?.user?.id,
            options,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}

export const getSellerOrdersAction = withSafeAction("getSellerOrdersAction", _getSellerOrdersAction);


/**
 * Get seller analytics
 */
async function _getSellerAnalyticsAction(): Promise<ActionResponse<{ analytics: unknown }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Capped. Both queries fetched every order and every product the seller
        // has ever had, unbounded, to produce a handful of summary numbers.
        const ordersRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .limit(SELLER_ANALYTICS_CAP);
        const productsRef = db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId)
            .limit(SELLER_ANALYTICS_CAP);

        // Fetch all matching orders and products in parallel to avoid index errors on status inequalities
        const [ordersSnapshot, productsSnapshot] = await Promise.all([
            ordersRef.get(),
            productsRef.get()
        ]);

        // The shared coercion. This was a fifth hand-rolled copy of it — correct,
        // like the one in _ex_investments.ts, and duplicated all the same. The
        // copies that were NOT correct are what de0a1a87 fixed.
        const getOrderDate = (createdAt: any): Date | null => {
            const ms = toMillis(createdAt);
            return ms > 0 ? new Date(ms) : null;
        };

        let totalSales = 0;
        let totalOrdersCount = 0;
        let pendingOrders = 0;
        let monthlyRevenue = 0;
        let prevMonthRevenue = 0;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const startOfPrevMonth = new Date(startOfMonth);
        startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);
        const endOfPrevMonth = new Date(startOfMonth);

        ordersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const status = data.status || "";
            const totalAmount = orderAmount(data);
            const orderDate = getOrderDate(data.createdAt);

            // Revenue counts only orders that were actually PAID for.
            //
            // This excluded `cancelled` and `disputed` — correctly — and let
            // `pending_payment` through. That is the status an order is created
            // in, before the buyer is charged anything, so an abandoned checkout
            // was reported as revenue, including in the monthly figure a seller
            // judges their business by.
            //
            // `disputed` stays excluded: that money is in escrow, not the
            // seller's. The buyer dashboard counts it as spent, because they did
            // pay it — the two questions differ on exactly that status, which is
            // why lib/order-status.ts names both sets.
            if (countsAsSellerRevenue(status)) {
                totalSales += totalAmount;
                totalOrdersCount += 1;

                if (orderDate) {
                    if (orderDate >= startOfMonth) {
                        monthlyRevenue += totalAmount;
                    } else if (orderDate >= startOfPrevMonth && orderDate < endOfPrevMonth) {
                        prevMonthRevenue += totalAmount;
                    }
                }
            }

            if (status === "pending_payment" || status === "processing") {
                pendingOrders += 1;
            }
        });

        let activeListings = 0;
        let totalProductViews = 0;
        let totalProductRating = 0;
        let ratedProductsCount = 0;

        productsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === "active") {
                activeListings += 1;
            }
            totalProductViews += (data.views || 0);
            if (data.rating !== undefined && data.rating !== null) {
                totalProductRating += data.rating;
                ratedProductsCount += 1;
            }
        });

        const averageRating = ratedProductsCount > 0 ? (totalProductRating / ratedProductsCount) : 0;

        const conversionRate = totalProductViews > 0
            ? parseFloat(((totalOrdersCount / totalProductViews) * 100).toFixed(1))
            : 0;

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const analytics = SellerAnalyticsSchema.parse({ totalSales,
            activeListings,
            pendingOrders,
            monthlyRevenue,
            conversionRate,
            averageRating,
            prevMonthRevenue,
            prevTotalSales: totalSales - monthlyRevenue,
            prevActiveListings: 0 });

        return { error: null,  success: true as const, data: { analytics: serializeValue(analytics) } };
    } catch (error: any) { 
        logger.error("Get seller analytics error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch analytics", data: null };
    }
}

export const getSellerAnalyticsAction = withSafeAction("getSellerAnalyticsAction", _getSellerAnalyticsAction);
