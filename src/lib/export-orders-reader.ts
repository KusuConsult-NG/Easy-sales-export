import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";

/**
 * A buyer's own export orders.
 *
 *   #585 AN EXPORT BUYER PAID, AND NEVER HEARD ANOTHER WORD.
 *
 *   export_orders is written by the checkout, updated by the payment
 *   verification, and read by exactly three things: that verification, the
 *   ADMIN list, and the reconciliation cron. Nothing anywhere showed an order
 *   to the person who paid for it.
 *
 *   What the buyer got instead:
 *
 *     THE CONFIRMATION SCREEN SAYS "View My Dashboard". /dashboard's Active
 *     Orders tile counts MARKETPLACE_ORDERS by buyerId and nothing else, so the
 *     order they had just paid for was not among them.
 *
 *     NO NOTIFICATION. verifyExportOrderPaymentAction calls notifyAdmins and
 *     stops. Every other module's payment path notifies the person who paid.
 *
 *     AND NO SCREEN. Not under /export/buyer, not in /export/(app) — which is
 *     gated on export-module onboarding a buyer has no reason to have — and not
 *     in the marketplace order list, which reads a different collection.
 *
 *   updateAdminExportOrderStatusAction even carries the comment "Buyers'
 *   dashboards filter on these strings", written while no buyer dashboard read
 *   this collection at all. An admin marking an order shipped changed a value
 *   nobody could see.
 *
 *   On a purchase that runs to tens of thousands of dollars, the whole record
 *   of it lived on screens the buyer cannot open.
 *
 * ── WHAT LEAVES THE SERVER ──────────────────────────────────────────────────
 *
 *   An allow-list, for the reason #578 and #584 give: an export order document
 *   carries buyerId, the seller id of every line, the payment reference and the
 *   refund bookkeeping. The buyer needs to recognise their order, not to
 *   inherit the platform's internal ids.
 *
 *   `paymentReference` IS included: it is the buyer's own Paystack reference,
 *   printed on their bank statement, and it is the first thing support will ask
 *   them for.
 */

const BUYER_ORDER_FIELDS = [
    "orderId",
    "status",
    "paymentStatus",
    "totalUSD",
    "totalNGN",
    "exchangeRate",
    "paymentReference",
    "refundReason",
    "documents",
    "createdAt",
    "updatedAt",
] as const;

/** The line fields a buyer is shown — the goods, not the supply chain. */
const BUYER_ITEM_FIELDS = ["name", "grade", "quantityMT", "pricePerMT", "totalUSD"] as const;

export interface BuyerExportOrder {
    id: string;
    orderId?: string;
    status?: string;
    paymentStatus?: string;
    totalUSD?: number;
    totalNGN?: number;
    exchangeRate?: number;
    paymentReference?: string;
    refundReason?: string;
    documents?: unknown[];
    //   serializeValue turns every Timestamp into an ISO string before this
    //   leaves the server, so the screen never sees a Firestore value.
    createdAt?: string;
    updatedAt?: string;
    items: Record<string, unknown>[];
    shippingTerm?: string;
    portOfDestination?: string;
}

export async function readMyExportOrders(userId: string): Promise<BuyerExportOrder[]> {
    const snapshot = await db.collection(COLLECTIONS.EXPORT_ORDERS)
        .where("buyerId", "==", userId)
        .get();

    const orders = snapshot.docs.map((doc: any) => {
        const data = doc.data() ?? {};

        const order: Record<string, unknown> = { id: doc.id };
        for (const field of BUYER_ORDER_FIELDS) {
            if (data[field] !== undefined) order[field] = data[field];
        }

        order.items = (Array.isArray(data.items) ? data.items : []).map((item: any) => {
            const line: Record<string, unknown> = {};
            for (const field of BUYER_ITEM_FIELDS) {
                if (item?.[field] !== undefined) line[field] = item[field];
            }
            return line;
        });

        //   The two delivery terms the buyer chose, lifted out of buyerDetails
        //   so the rest of it — their own name, email and phone, which they do
        //   not need sent back to them — stays on the server.
        order.shippingTerm = data.buyerDetails?.shippingTerm;
        order.portOfDestination = data.buyerDetails?.portOfDestination;

        return serializeValue(order) as BuyerExportOrder;
    });

    /**
     *   SORTED HERE, NOT IN THE QUERY.
     *
     *   An orderBy("createdAt") needs a composite index alongside the buyerId
     *   filter, and getUserExportProductsAction already carries a whole
     *   fallback branch for that exact failure. A buyer has a handful of export
     *   orders, not thousands, so sorting them in memory costs nothing and
     *   removes the failure mode instead of catching it.
     */
    return orders.sort((a, b) =>
        new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime());
}
