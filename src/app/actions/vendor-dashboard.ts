"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";

/**
 * VENDOR DASHBOARD ANALYTICS ACTIONS
 */

export async function getVendorSalesStatsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("vendorId", "==", vendorId)
            .where("paymentStatus", "==", "paid")
            .get();

        const orders = serializeDocs(ordersSnapshot.docs);

        const stats = {
            today: { orders: 0, revenue: 0 },
            thisWeek: { orders: 0, revenue: 0 },
            thisMonth: { orders: 0, revenue: 0 },
            allTime: { orders: orders.length, revenue: 0 },
        };

        orders.forEach((order: any) => {
            const createdAt = order.createdAt;
            const amount = order.totalAmount || 0;
            stats.allTime.revenue += amount;

            if (createdAt >= startOfToday) {
                stats.today.orders++;
                stats.today.revenue += amount;
            }
            if (createdAt >= startOfWeek) {
                stats.thisWeek.orders++;
                stats.thisWeek.revenue += amount;
            }
            if (createdAt >= startOfMonth) {
                stats.thisMonth.orders++;
                stats.thisMonth.revenue += amount;
            }
        });

        return { success: true, stats };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getVendorRevenueTrendsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const vendorId = session.user.id;
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);

        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("vendorId", "==", vendorId)
            .where("paymentStatus", "==", "paid")
            .where("createdAt", ">=", thirtyDaysAgo)
            .get();

        const dailyData: Record<string, { revenue: number; orders: number }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            const dateKey = createdAt.toISOString().split('T')[0];

            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { revenue: 0, orders: 0 };
            }

            dailyData[dateKey].revenue += data.totalAmount || 0;
            dailyData[dateKey].orders++;
        });

        const trends: Array<{ date: string; revenue: number; orders: number }> = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            trends.push({
                date: dateKey,
                revenue: dailyData[dateKey]?.revenue || 0,
                orders: dailyData[dateKey]?.orders || 0,
            });
        }

        return { success: true, trends };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getTopSellingProductsAction(limit: number = 5) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const vendorId = session.user.id;
        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("vendorId", "==", vendorId)
            .where("paymentStatus", "==", "paid")
            .get();

        const productStats: Record<string, { name: string; sold: number; revenue: number }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const items = data.items || [];

            items.forEach((item: any) => {
                if (!productStats[item.productId]) {
                    productStats[item.productId] = {
                        name: item.productName || "Unknown Product",
                        sold: 0,
                        revenue: 0,
                    };
                }

                productStats[item.productId].sold += item.quantity || 0;
                productStats[item.productId].revenue += (item.price || 0) * (item.quantity || 0);
            });
        });

        const products = Object.entries(productStats)
            .map(([productId, stats]) => ({
                productId,
                productName: stats.name,
                totalSold: stats.sold,
                totalRevenue: stats.revenue,
            }))
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, limit);

        return { success: true, products };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getVendorInventoryStatsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const vendorId = session.user.id;
        const productsSnapshot = await db.collection(COLLECTIONS.VENDOR_PRODUCTS)
            .where("vendorId", "==", vendorId)
            .get();

        const stats = {
            totalProducts: productsSnapshot.size,
            activeProducts: 0,
            outOfStock: 0,
            lowStock: 0,
            lowStockProducts: [] as Array<{ id: string; name: string; stock: number; reorderLevel: number }>,
        };

        productsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const stock = data.stock || 0;
            const reorderLevel = data.reorderLevel || 10;

            if (data.status === "active") stats.activeProducts++;

            if (stock === 0) {
                stats.outOfStock++;
            } else if (stock < reorderLevel) {
                stats.lowStock++;
                stats.lowStockProducts.push({
                    id: doc.id,
                    name: data.name || "Unnamed Product",
                    stock,
                    reorderLevel,
                });
            }
        });

        stats.lowStockProducts.sort((a, b) => a.stock - b.stock);
        return { success: true, stats };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getVendorRevenueInsightsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const vendorId = session.user.id;
        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("vendorId", "==", vendorId)
            .get();

        let totalRevenue = 0;
        let pendingPayouts = 0;
        let completedTransactions = 0;
        const categoryRevenue: Record<string, number> = {};

        ordersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const amount = data.totalAmount || 0;

            if (data.paymentStatus === "paid") {
                totalRevenue += amount;
                completedTransactions++;

                const items = data.items || [];
                items.forEach((item: any) => {
                    const category = item.category || "Uncategorized";
                    categoryRevenue[category] = (categoryRevenue[category] || 0) + (item.price * item.quantity);
                });
            } else if (data.paymentStatus === "pending") {
                pendingPayouts += amount;
            }
        });

        const averageOrderValue = completedTransactions > 0 ? totalRevenue / completedTransactions : 0;
        const revenueByCategory = Object.entries(categoryRevenue)
            .map(([category, revenue]) => ({ category, revenue }))
            .sort((a, b) => b.revenue - a.revenue);

        return { success: true, insights: {
                totalRevenue,
                pendingPayouts,
                completedTransactions,
                averageOrderValue,
                revenueByCategory, }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getVendorActivityFeedAction(limit: number = 20) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const vendorId = session.user.id;
        const activities: Array<any> = [];

        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("vendorId", "==", vendorId)
            .orderBy("createdAt", "desc")
            .limit(10)
            .get();

        ordersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            activities.push({
                id: doc.id,
                type: "order",
                title: `New Order #${data.orderNumber}`,
                description: `Order from ${data.customerName} - ₦${data.totalAmount?.toLocaleString()}`,
                timestamp: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
                metadata: { orderId: doc.id, status: data.status },
            });
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
                    metadata: { productId: doc.id, stock },
                });
            }
        });

        activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return { success: true, activities: activities.slice(0, limit) };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
