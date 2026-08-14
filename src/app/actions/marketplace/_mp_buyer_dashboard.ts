"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order } from "@/lib/types/marketplace";
import { serializeDocs } from "@/lib/firestore-serialize";
import { OrderSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";

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
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const orders = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            try {
                const parsed = OrderSchema.parse({ id: doc.id, ...data });
                return serializeValue(parsed);
            } catch (e) {
                return serializeValue({ id: doc.id, ...data });
            }
        });

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
            .get();

        // DISEASE 5 FIX: serializeValue converts Firestore Timestamps → ISO strings
        // so they don't crash React when passed to client components.
        const orders = serializeDocs<Order>(snapshot.docs);

        const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "cancelled" && o.status !== "completed").length;
        const completedOrders = orders.filter(o => o.status === "delivered" || o.status === "completed").length;
        const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);

        const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const savedSellers: number = buyerDoc.data()?.savedSellersCount ?? 0;

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
