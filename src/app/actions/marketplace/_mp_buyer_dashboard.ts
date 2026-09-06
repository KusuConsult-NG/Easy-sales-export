"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order } from "@/lib/types/marketplace";
import { serializeDocs, serializeOrders } from "@/lib/firestore-serialize";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { isActiveOrderStatus, isPaidByBuyer, sumOrders } from "@/lib/order-status";
import { countSavedItems } from "@/lib/saved-items-store";

/**
 * The most orders a single stats query will read.
 *
 * The query had no limit at all. Four numbers do not justify loading a buyer's
 * entire order history, and the figures below are dominated by recent activity.
 * A buyer past this many orders sees stats over their most recent ones, which is
 * a better failure than a query that grows forever.
 */
const BUYER_STATS_ORDER_CAP = 500;

/**
 * Get buyer's orders
 */
async function _getBuyerOrdersAction(options: { limit?: number;
    lastId?: string;
    status?: string; } = {}): Promise<ActionResponse<{ orders: Order[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const { limit = 20, lastId, status } = options;

        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            .orderBy("createdAt", "desc");

        if (status && status !== "all") { 
            query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("buyerId", "==", session.user.id)
                .where("status", "==", status)
                .orderBy("createdAt", "desc");
        }

        if (lastId) { 
            const lastDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();

        // #443. This was OrderSchema.parse in a try with the RAW DOCUMENT in
        // the catch — so the one row the schema could not heal was the one row
        // that reached the browser unvalidated, and `{order.items.length}` on
        // the dashboard took the page down. serializeOrder heals instead, and
        // logs the row rather than passing it through in silence.
        const orders = serializeOrders(snapshot.docs);

        let newLastId = undefined;
        let hasMore = false;

        if (snapshot.docs.length === limit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { 
            error: null, 
            success: true as const, 
            data: { orders, lastId: newLastId, hasMore } 
        };
    } catch (error: any) { 
        logger.error("Get buyer orders error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch orders", data: null };
    }
}

export const getBuyerOrdersAction = withSafeAction("getBuyerOrdersAction", _getBuyerOrdersAction);


/**
 * Get buyer dashboard stats
 */
async function _getBuyerStatsAction(): Promise<ActionResponse<{ stats: { activeOrders: number; completedOrders: number; totalSpent: number; savedSellers: number } }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            // Capped. This fetched every order the buyer has ever placed in order
            // to produce four numbers, and grew without limit.
            .limit(BUYER_STATS_ORDER_CAP)
            .get();

        // DISEASE 5 FIX: serializeValue converts Firestore Timestamps → ISO strings
        // so they don't crash React when passed to client components.
        const orders = serializeDocs<Order>(snapshot.docs);

        const activeOrders = orders.filter(o => isActiveOrderStatus(o.status)).length;
        const completedOrders = orders.filter(o => o.status === "delivered" || o.status === "completed").length;

        // Only orders the buyer has actually PAID for.
        //
        // This was `orders.reduce((sum, o) => sum + o.totalAmount, 0)` over every
        // order with no status filter, so "Total Spent" included baskets still at
        // `pending_payment` — the status an order is created in, before the buyer
        // is charged anything — and orders they had cancelled.
        //
        // The uncoerced `o.totalAmount` was the other half: one order missing the
        // field makes the whole reduce NaN, and formatCurrency(NaN) renders "₦0".
        // The figure did not look broken; it looked like nothing had been spent.
        const totalSpent = sumOrders(orders, isPaidByBuyer);

        // #105. This was:
        //
        //     const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(...).get();
        //     const savedSellers = buyerDoc.data()?.savedSellersCount ?? 0;
        //
        // `savedSellersCount` was read HERE and written NOWHERE — there was no
        // save-a-seller action, no collection and no control anywhere in the
        // app that could have produced the number, so the tile was
        // structurally 0 for every buyer. The same shape as #100, where Active
        // Orders read a field nothing wrote.
        //
        // Sellers can be saved now, and the figure is counted from the rows
        // rather than from a denormalised copy that could drift from them.
        const savedSellers = await countSavedItems(session.user.id, "marketplace_seller");

        const stats = { activeOrders, completedOrders, totalSpent, savedSellers };
        return { error: null, success: true as const, data: { stats } };
    } catch (error: any) { 
        logger.error("Get buyer stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch stats", data: null };
    }
}

export const getBuyerStatsAction = withSafeAction("getBuyerStatsAction", _getBuyerStatsAction);
