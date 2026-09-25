/**
 * Delivering a paid export order — one copy, for both doors.
 *
 *   #719 A BUYER WHO PAID AND CLOSED THE TAB GOT NOTHING, BECAUSE THE ONLY
 *   CODE THAT COULD DELIVER THE ORDER LIVED IN THE PAGE THEY LEFT.
 *
 *   #695 measured what the checkouts actually mint against what the dispatch
 *   table can route and found three types with no processor at all. It fixed
 *   the lying — the webhook stops claiming a reference it cannot fulfil, so the
 *   buyer is never told a failure succeeded — and said plainly what it did not
 *   fix:
 *
 *       "A buyer who pays and never returns to the callback — closes the tab,
 *        loses signal, switches apps — still has no fulfilment, because there
 *        is still no processor."
 *
 *   This is the processor for the first of the three. `export_buyer_order` is
 *   now routed like the other eight: the webhook fulfils it, the reconciler can
 *   heal it, and the buyer's return is one of two doors rather than the only
 *   one.
 *
 * ── WHY A SHARED MODULE AND NOT A SECOND COPY ───────────────────────────────
 *
 *   The house pattern, from #272 and lib/order-payment-amount.ts. That finding
 *   exists because marketplace orders HAD two fulfilment paths that validated
 *   the amount differently, so the same payment got different answers depending
 *   on which arrived first — and they race by design. Writing a webhook-side
 *   copy of the logic below would have recreated that exactly, on a flow that
 *   decrements real stock.
 *
 *   So the decision and the writes live here, once. The two doors differ only
 *   in what they already differ in: who they claim the reference as, and what
 *   they do with the answer.
 *
 *       the callback   claims as `client_verify`, renders the verdict
 *       the processor  claims as `webhook`, THROWS on refusal so the
 *                      dispatcher's contract holds — see payment-router
 *
 * ── WHAT IS DELIBERATELY UNCHANGED ──────────────────────────────────────────
 *
 *   THE ORDER OF THE WRITES. Stock first and all-or-nothing (#279/#582), then
 *   the order row, then the ledger. Every reason for that order is recorded at
 *   the step it belongs to and none of it is re-litigated here; this finding
 *   moves the code, it does not redesign it.
 *
 *   NO NEW AMOUNT RULE. processMarketplaceOrder checks the paid sum against the
 *   order total and this does not, because the export checkout computes the
 *   charge server-side and already cross-checks it against the quote before
 *   Paystack is called (`QUOTE_TOLERANCE_KOBO`). Adding a second rule here
 *   would be a behaviour change to a live money path bundled inside a
 *   structural one, and #695's own judgement applies: make the structure right
 *   first. It is recorded in docs/audit/outstanding-work.md instead of
 *   smuggled in.
 *
 *   THE NOTIFICATIONS STAY NON-FATAL. By the time they run the payment is
 *   claimed, the stock is down and the order is processing, so a notification
 *   that cannot be written is worth a log line and nothing more (#585).
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS, PAYMENT_STATUS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { EXPORT_STOCK_FIELD } from "@/lib/export-stock";
import { writeGuard, PaymentStatusWriteSchema } from "@/lib/write-guard";
import { decrementManyOrFail } from "@/lib/wallet-ledger";
import { logger } from "@/lib/logger";

/** The order row this fulfilment acts on, found by its payment reference. */
export interface ExportOrderRecord {
    /** The document id, which is what the order row is updated by. */
    docId: string;
    data: Record<string, any>;
}

export type ExportOrderFulfilment =
    | { ok: true; orderId: string }
    /**
     * The buyer paid and the catalog cannot cover it. NOT an error to retry:
     * the order is marked `cancelled_out_of_stock` / `paid_awaiting_refund` by
     * the time this is returned, and a person has to refund it.
     */
    | { ok: false; reason: "out-of-stock"; failedProductId?: string; message: string };

/** The message the buyer sees when the catalog could not cover a paid order. */
export const OUT_OF_STOCK_MESSAGE =
    "This order could not be fulfilled: one of the products is no longer available in the "
    + "quantity ordered. You have been charged and a refund is being arranged.";

/**
 * Find the export order a payment reference belongs to.
 *
 * Shared so the two doors cannot disagree about WHICH order a reference names
 * — the same reason the selection behind the missing-email preview and its
 * repair were folded into one function in #718.
 */
export async function findExportOrderByReference(reference: string): Promise<ExportOrderRecord | null> {
    const orderQuery = await db.collection(COLLECTIONS.EXPORT_ORDERS)
        .where("paymentReference", "==", reference)
        .limit(1)
        .get();

    if (orderQuery.empty) return null;

    const doc = orderQuery.docs[0];
    return { docId: doc.id, data: doc.data() ?? {} };
}

/**
 * Deliver one paid export order.
 *
 * THE CALLER MUST HAVE CLAIMED THE REFERENCE ALREADY. Everything below writes,
 * and claim_payment_once is what makes it happen once — calling this without a
 * won claim decrements the catalog twice for one order, which is the defect
 * #279 fixed. Both doors claim immediately before calling.
 */
export async function fulfilExportBuyerOrder(args: {
    reference: string;
    amountInNaira: number;
    userId: string;
    order: ExportOrderRecord;
}): Promise<ExportOrderFulfilment> {
    const { reference, amountInNaira, userId, order } = args;
    const orderData = order.data;
    const orderId = orderData.orderId ?? order.docId;

    /**
     *   #582 ONLY THE LISTINGS SOMEBODY IS ACTUALLY COUNTING.
     *
     *   This decremented `availableQuantity` — the MARKETPLACE's field name —
     *   on a collection that has never carried it, and a missing field is 0 to
     *   decrement_many_or_fail. So every paid export order was cancelled as out
     *   of stock and left awaiting a manual refund.
     *
     *   An unrecorded stock is not a stock of zero. A listing with a real
     *   quantity is still counted down, and a genuine shortfall is still
     *   refused all-or-nothing, which is #279's fix and untouched.
     */
    const trackedItems = (orderData.items || []).filter((item: any) => item?.stockTracked === true);

    // FieldValue.increment(-qty) is atomic but unbounded, so an order for more
    // than the catalog holds drove the quantity negative — and a per-item loop
    // would leave the earlier items decremented when a later one fell short.
    // decrement_many_or_fail (015) locks every row, checks them all, then
    // writes, in id order so concurrent orders cannot deadlock.
    const stock = trackedItems.length === 0
        ? { ok: true as const, failedId: undefined, reason: undefined }
        : await decrementManyOrFail(
            trackedItems.map((item: any) => ({
                collection: COLLECTIONS.EXPORT_CATALOG,
                id: item.productId,
                field: EXPORT_STOCK_FIELD,
                amount: item.quantityMT,
            }))
        );

    if (!stock.ok) {
        // The payment is already claimed, so this will not retry. The buyer has
        // been charged for stock that is not there, which somebody has to
        // refund — log loudly enough to be found.
        logger.error("[ExportOrderFulfilment] PAID BUT OUT OF STOCK — refund required", {
            reference,
            orderId,
            failedProductId: stock.failedId,
            reason: stock.reason,
        });

        //   #911 GUARDED, LIKE THE `completed` WRITE TWENTY LINES BELOW.
        //
        //   It could not be, until now. PaymentStatusWriteSchema is built from
        //   PAYMENT_STATUS, `paid_awaiting_refund` was not in that list, and
        //   writeGuard THROWS on a violation — so wrapping this write would have
        //   thrown at the exact moment a buyer has paid for stock that is not
        //   there, leaving the order unmarked, invisible to the
        //   reconcile-fulfilment cron's query and refused by
        //   refundExportOrderAction's `!== "paid_awaiting_refund"` gate.
        //
        //   The vocabulary holds the value now, so the platform's most
        //   consequential payment write gets the same validation as its least.
        await db.collection(COLLECTIONS.EXPORT_ORDERS).doc(order.docId).update(writeGuard(
            PaymentStatusWriteSchema.partial(),
            {
                status: "cancelled_out_of_stock",
                paymentStatus: PAYMENT_STATUS.PAID_AWAITING_REFUND,
                refundReason: `Insufficient catalog stock for product ${stock.failedId}`,
                refundAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
            },
            'export-order-fulfilment/fulfilExportBuyerOrder:out-of-stock'
        ));

        return {
            ok: false,
            reason: "out-of-stock",
            //   decrementManyOrFail reports "no id" as null; the verdict carries
            //   `undefined` for absent so a caller spreading it into a log does
            //   not print "failedProductId: null" for a shortfall it could not
            //   attribute to a row.
            failedProductId: stock.failedId ?? undefined,
            message: OUT_OF_STOCK_MESSAGE,
        };
    }

    await db.collection(COLLECTIONS.EXPORT_ORDERS).doc(order.docId).update(writeGuard(
        PaymentStatusWriteSchema.partial(),
        {
            status: "processing",
            paymentStatus: "completed",
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        'export-order-fulfilment/fulfilExportBuyerOrder'
    ));

    // (The processed_payments row is written by the caller's claim.)

    // Global Ledger Record — last, deliberately.
    await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
        id: reference,
        userId,
        type: "export_order",
        module: "export",
        amount: amountInNaira,
        currency: "NGN",
        status: "completed",
        date: FieldValue.serverTimestamp(),
        reference,
        description: `Export Order #${orderId}`,
    });

    /**
     *   #585 AND TELL THE BUYER, WHO IS THE ONE WHO PAID.
     *
     *   This notified the admins and stopped. Every other module's payment path
     *   notifies the person whose money moved; the export buyer got a
     *   confirmation screen, and after they closed it there was no record of
     *   the order on any screen they could open.
     *
     *   #719 makes that matter more, not less: the buyer this processor exists
     *   for is precisely the one who never saw the confirmation screen, so this
     *   notification is now the ONLY thing that tells them the order landed.
     */
    try {
        const { createNotification } = await import("@/infrastructure/notifications/service");
        await createNotification({
            userId,
            type: "payment",
            title: "Export order confirmed",
            message: `We have received your payment for order ${orderId}. Our export team will prepare `
                + `your consignment and the shipping documentation.`,
            link: "/export/buyer/orders",
            linkText: "View my orders",
        });
    } catch (e: any) {
        logger.warn("Failed to notify export buyer of their order", { error: e?.message || String(e) });
    }

    try {
        const { notifyAdmins } = await import("@/lib/admin-notifications");
        await notifyAdmins({
            type: "export",
            title: "New Export Order Received",
            message: `Export order ${orderId} has been fully paid. `
                + `Term: ${orderData.buyerDetails?.shippingTerm}. `
                + `Port: ${orderData.buyerDetails?.portOfDestination}.`,
            // /admin/export/orders/{id} is not a route — there is no [id]
            // segment under it, only the list page. Every "New Export Order
            // Received" notification an admin received linked to a 404.
            link: `/admin/export/orders`,
            linkText: "View Order",
        });
    } catch (e: any) {
        logger.warn("Failed to send export order admin notification", { error: e?.message || String(e) });
    }

    return { ok: true, orderId };
}
