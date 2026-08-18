"use server";

import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Timestamp } from "@/lib/firestore-compat";
import { serializeDocs, serializeValue, toMillis } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { logger } from "@/lib/logger";

/**
 * VENDOR DASHBOARD ANALYTICS ACTIONS
 */

/**
 * Every order belonging to this vendor.
 *
 * The five queries in this file read MARKETPLACE_ORDERS `.where("vendorId",
 * "==", vendorId)`. **No order has a vendorId field.** orders.ts writes
 * `sellerId`; marketplace/_payment.ts writes `sellerIds` and sets `sellerId` to
 * `sellerIds[0]`. vendor.ts, the vendor-facing order LIST, queries
 * `sellerIds array-contains` and works; vendor-settings.ts queries
 * `sellerId ==` and works. Only this file invented a third name.
 *
 * So every sales figure on the vendor dashboard read zero, for every vendor,
 * always — the same shape as the forensics reconciliation in #118, which
 * compared a stored balance against a field nothing wrote.
 *
 * Neither seller field is sufficient alone:
 *
 *   sellerId ==            misses a non-first seller on a multi-seller order,
 *                          because _payment.ts records only sellerIds[0] there
 *   sellerIds contains     misses every order from orders.ts, which does not
 *                          write that array at all
 *
 * Both are queried and the results merged by document id. The alternative —
 * picking one and accepting the gap — would replace "no sales" with "some
 * sales", which is harder to notice and worse to trust.
 */
async function fetchVendorOrderDocs(
    vendorId: string,
    refine?: (q: any) => any
): Promise<any[]> {
    const build = (base: any) => (refine ? refine(base) : base);

    const [bySellerId, bySellerIds] = await Promise.all([
        build(
            db.collection(COLLECTIONS.MARKETPLACE_ORDERS).where("sellerId", "==", vendorId)
        ).get(),
        build(
            db.collection(COLLECTIONS.MARKETPLACE_ORDERS).where("sellerIds", "array-contains", vendorId)
        ).get(),
    ]);

    const seen = new Set<string>();
    const merged: any[] = [];
    for (const doc of [...bySellerId.docs, ...bySellerIds.docs]) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        merged.push(doc);
    }
    return merged;
}

async function _getVendorSalesStatsAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const orderDocs = await fetchVendorOrderDocs(vendorId, (q) =>
            q.where("paymentStatus", "==", "paid"));

        const orders = serializeDocs(orderDocs);

        const stats = { today: { orders: 0, revenue: 0 },
            thisWeek: { orders: 0, revenue: 0 },
            thisMonth: { orders: 0, revenue: 0 },
            allTime: { orders: orders.length, revenue: 0 } };

        // TODAY, THIS WEEK AND THIS MONTH WERE ALWAYS ZERO.
        //
        // serializeDocs turns a Timestamp into an ISO STRING, and the three
        // comparisons below were `createdAt >= startOfToday` — a string against
        // a Date. JavaScript resolves that by stringifying the Date through
        // toString(), giving "Tue Aug 18 2026 00:00:00 GMT+0000...", and then
        // comparing lexicographically:
        //
        //     "2026-08-18T10:00:00.000Z" >= "Tue Aug 18 2026 ..."   →  false
        //
        // "2" sorts before "T", so it is false for every order on every day —
        // not merely wrong at boundaries. So a vendor with sales an hour ago saw
        // Today ₦0, This Week ₦0, This Month ₦0, while All Time was correct
        // because it sums unconditionally.
        //
        // The sibling in this file, _getVendorRevenueTrendsAction, reads
        // doc.data() and coerces with `createdAt?.toDate ? ... : new Date(...)`
        // — so the file already had the right answer one function away.
        //
        // toMillis is the shared coercion this codebase uses for exactly this:
        // it takes a Date, a number, an ISO string, a Timestamp or a {seconds}
        // shape, so it cannot be defeated by whichever of those the adapter
        // hands back.
        const todayMs = startOfToday.getTime();
        const weekMs = startOfWeek.getTime();
        const monthMs = startOfMonth.getTime();

        orders.forEach((order: any) => { const createdAtMs = toMillis(order.createdAt);
            const amount = order.totalAmount || 0;
            stats.allTime.revenue += amount;

            if (createdAtMs >= todayMs) {
                stats.today.orders++;
                stats.today.revenue += amount;
            }
            if (createdAtMs >= weekMs) { stats.thisWeek.orders++;
                stats.thisWeek.revenue += amount;
            }
            if (createdAtMs >= monthMs) { stats.thisMonth.orders++;
                stats.thisMonth.revenue += amount;
            }
        });

        return { success: true as const, error: null, data: { stats } };
    } catch (error: any) { logger.error("getVendorSalesStatsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorSalesStatsAction = withFlexibleSafeAction("getVendorSalesStatsAction", _getVendorSalesStatsAction);

async function _getVendorRevenueTrendsAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        const vendorId = session.user.id;
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);

        const orderDocs = await fetchVendorOrderDocs(vendorId, (q) =>
            q.where("paymentStatus", "==", "paid").where("createdAt", ">=", thirtyDaysAgo));

        const dailyData: Record<string, { revenue: number; orders: number }> = {};

        orderDocs.forEach(doc => { const data = doc.data();
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            const dateKey = createdAt.toISOString().split('T')[0];

            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { revenue: 0, orders: 0 };
            }

            dailyData[dateKey].revenue += data.totalAmount || 0;
            dailyData[dateKey].orders++;
        });

        const trends: Array<{ date: string; revenue: number; orders: number }> = [];
        for (let i = 29; i >= 0; i--) { const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            trends.push({
                date: dateKey,
                revenue: dailyData[dateKey]?.revenue || 0,
                orders: dailyData[dateKey]?.orders || 0 });
        }

        return { error: null, success: true as const, data: { trends } };
    } catch (error: any) { logger.error("getVendorRevenueTrendsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorRevenueTrendsAction = withFlexibleSafeAction("getVendorRevenueTrendsAction", _getVendorRevenueTrendsAction);

async function _getTopSellingProductsAction(limit: number = 5) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        const vendorId = session.user.id;
        const orderDocs = await fetchVendorOrderDocs(vendorId, (q) =>
            q.where("paymentStatus", "==", "paid"));

        const productStats: Record<string, { name: string; sold: number; revenue: number }> = {};

        orderDocs.forEach(doc => { const data = doc.data();
            const items = data.items || [];

            items.forEach((item: any) => {
                if (!productStats[item.productId]) {
                    productStats[item.productId] = {
                        name: item.productName || "Unknown Product",
                        sold: 0,
                        revenue: 0 };
                }

                productStats[item.productId].sold += item.quantity || 0;
                productStats[item.productId].revenue += (item.price || 0) * (item.quantity || 0);
            });
        });

        const products = Object.entries(productStats)
            .map(([productId, stats]) => ({ productId,
                productName: stats.name,
                totalSold: stats.sold,
                totalRevenue: stats.revenue }))
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, limit);

        return { success: true as const, error: null, data: { products } };
    } catch (error: any) { logger.error("getTopSellingProductsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getTopSellingProductsAction = withFlexibleSafeAction("getTopSellingProductsAction", _getTopSellingProductsAction);

async function _getVendorInventoryStatsAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        const vendorId = session.user.id;
        const productsSnapshot = await db.collection(COLLECTIONS.VENDOR_PRODUCTS)
            .where("vendorId", "==", vendorId)
            .get();

        const stats = { totalProducts: productsSnapshot.size,
            activeProducts: 0,
            outOfStock: 0,
            lowStock: 0,
            lowStockProducts: [] as Array<{ id: string; name: string; stock: number; reorderLevel: number }> };

        productsSnapshot.docs.forEach(doc => { const data = doc.data();
            const stock = data.stock || 0;
            const reorderLevel = data.reorderLevel || 10;

            if (data.status === "active") stats.activeProducts++;

            if (stock === 0) {
                stats.outOfStock++;
            } else if (stock < reorderLevel) { stats.lowStock++;
                stats.lowStockProducts.push({
                    id: doc.id,
                    name: data.name || "Unnamed Product",
                    stock,
                    reorderLevel });
            }
        });

        stats.lowStockProducts.sort((a, b) => a.stock - b.stock);
        return { error: null, success: true as const, data: { stats } };
    } catch (error: any) { logger.error("getVendorInventoryStatsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorInventoryStatsAction = withFlexibleSafeAction("getVendorInventoryStatsAction", _getVendorInventoryStatsAction);

async function _getVendorRevenueInsightsAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        const vendorId = session.user.id;
        const orderDocs = await fetchVendorOrderDocs(vendorId);

        let totalRevenue = 0;
        let pendingPayouts = 0;
        let completedTransactions = 0;
        const categoryRevenue: Record<string, number> = {};

        orderDocs.forEach(doc => { const data = doc.data();
            const amount = data.totalAmount || 0;

            if (data.paymentStatus === "paid") {
                totalRevenue += amount;
                completedTransactions++;

                const items = data.items || [];
                items.forEach((item: any) => {
                    const category = item.category || "Uncategorized";
                    categoryRevenue[category] = (categoryRevenue[category] || 0) + (item.price * item.quantity);
                });
            } else if (data.paymentStatus === "pending") { pendingPayouts += amount;
            }
        });

        const averageOrderValue = completedTransactions > 0 ? totalRevenue / completedTransactions : 0;
        const revenueByCategory = Object.entries(categoryRevenue)
            .map(([category, revenue]) => ({ category, revenue }))
            .sort((a, b) => b.revenue - a.revenue);

        return { 
            error: null, 
            success: true as const, 
            data: { insights: { totalRevenue, pendingPayouts, completedTransactions, averageOrderValue, revenueByCategory } } 
        };
    } catch (error: any) { logger.error("getVendorRevenueInsightsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorRevenueInsightsAction = withFlexibleSafeAction("getVendorRevenueInsightsAction", _getVendorRevenueInsightsAction);

async function _getVendorActivityFeedAction(limit: number = 20) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        const vendorId = session.user.id;
        const activities: Array<any> = [];

        // Sorted and limited in memory: the two queries are merged, so a
        // per-query limit would cut the wrong ten.
        const allOrderDocs = await fetchVendorOrderDocs(vendorId);
        const orderDocs = allOrderDocs
            .sort((a: any, b: any) => {
                const at = a.data()?.createdAt?.toDate?.()?.getTime?.() ?? 0;
                const bt = b.data()?.createdAt?.toDate?.()?.getTime?.() ?? 0;
                return bt - at;
            })
            .slice(0, 10);

        orderDocs.forEach(doc => {
            const data = doc.data();
            activities.push({
                id: doc.id,
                type: "order",
                title: `New Order #${data.orderNumber}`,
                description: `Order from ${data.customerName} - ₦${data.totalAmount?.toLocaleString()}`,
                timestamp: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
                metadata: { orderId: doc.id, status: data.status } });
        });

        const productsSnapshot = await db.collection(COLLECTIONS.VENDOR_PRODUCTS)
            .where("vendorId", "==", vendorId)
            .get();

        productsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const stock = data.stock || 0;
            const reorderLevel = data.reorderLevel || 10;

            if (stock < reorderLevel && stock > 0) {
                activities.push({
                    id: `stock-${doc.id}`,
                    type: "stock",
                    title: "Low Stock Alert",
                    description: `${data.name} is running low (${stock} ${data.unit || 'units'} remaining)`,
                    timestamp: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
                    metadata: { productId: doc.id, stock } });
            }
        });

        activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return { error: null, success: true as const, data: { activities } };
    } catch (error: any) { logger.error("getVendorActivityFeedAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorActivityFeedAction = withFlexibleSafeAction("getVendorActivityFeedAction", _getVendorActivityFeedAction);

