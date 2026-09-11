"use server";

import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";
import { serializeDocs } from "@/lib/firestore-serialize";
import { recordAdminAction } from "@/lib/audit-log";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";
import { creditWalletOnce } from "@/lib/wallet-ledger";
import { isPositiveAmount } from "@/lib/amount";
import { firstNumber } from "@/lib/numbers";

const DEFAULT_CATALOG = [
    { id: "cashew-nuts", name: "Cashew Nuts", icon: "🥜", origin: "Ogbomoso, Oyo State", season: "Feb - May", category: "nuts", grades: ["W320", "W240", "W210"], certifications: ["NAFDAC", "SON"], pricePerMT: 2850, minOrderMT: 20 },
    { id: "sesame-seeds", name: "Sesame Seeds", icon: "🌰", origin: "Jigawa & Nassarawa", season: "Oct - Jan", category: "nuts", grades: ["White (99%)", "Brown (98%)"], certifications: ["NAFDAC", "SGS"], pricePerMT: 1750, minOrderMT: 25 },
    { id: "dried-hibiscus", name: "Dried Hibiscus (Zobo)", icon: "🌺", origin: "Kano & Jigawa", season: "Nov - Mar", category: "spices", grades: ["Dark Red", "Light Red"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2200, minOrderMT: 15 },
    { id: "cocoa-beans", name: "Cocoa Beans", icon: "🫘", origin: "Ondo & Cross River", season: "Sep - Feb", category: "nuts", grades: ["Grade A", "Grade B"], certifications: ["NAFDAC", "ICO"], pricePerMT: 3400, minOrderMT: 10 },
    { id: "shea-butter", name: "Shea Butter", icon: "🧴", origin: "Niger & Kwara", season: "Year-round", category: "oils", grades: ["Unrefined Grade A", "Refined"], certifications: ["NAFDAC", "Organic Certified"], pricePerMT: 1900, minOrderMT: 5 },
    { id: "ginger", name: "Ginger", icon: "🫚", origin: "Kaduna & Nasarawa", season: "Nov - Mar", category: "spices", grades: ["Split Dried", "Powder"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2600, minOrderMT: 15 },
    { id: "moringa-leaves", name: "Moringa Leaves (Dried)", icon: "🍃", origin: "Kebbi & Sokoto", season: "Year-round", category: "spices", grades: ["Grade A Powder", "Whole Dried"], certifications: ["Organic Certified", "EU Compliant"], pricePerMT: 3200, minOrderMT: 5 },
    { id: "charcoal", name: "Hardwood Charcoal", icon: "🪵", origin: "Benue & Nassarawa", season: "Year-round", category: "other", grades: ["Lump (80mm+)", "BBQ Grade"], certifications: ["SON", "FSC Compliant"], pricePerMT: 450, minOrderMT: 28 },
];

export async function getAdminExportCatalogAction(options: { limit?: number; 
    lastDocId?: string;  } = {}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        // The only endpoint in this file with no caller check.
        //
        // Its eight siblings all call isAdmin, its name says Admin, and its only
        // caller is /admin/export/catalog. It had no session check at all, so
        // any unauthenticated request could page through the catalogue.
        //
        // The rows are whole documents — createExportCatalogAction spreads
        // `...productData` in with no schema, so a catalogue entry holds
        // whatever the admin form sent, and serializeDocs returns all of it.
        // There is no public catalogue reader anywhere in the codebase for this
        // to have been standing in for: participants read their own products
        // through getUserExportProductsAction, which is session-scoped.
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        let query = db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .orderBy("sortOrder", "asc");

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const fetchLimit = options.limit || 50;
        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        if (docs.length > 0) {
            // DISEASE 5 FIX: serialize to convert Timestamps → ISO strings
            const products = serializeDocs(docs);
            const nextCursor = hasMore ? docs[docs.length - 1].id : undefined;

            return { error: null, success: true as const, data: products, lastDocId: nextCursor, hasMore: hasMore, meta: { hasMore, lastDocId: nextCursor } };
        }

        // Only return default catalog if not paginated and collection is empty
        if (!options.lastDocId) { return { error: null, success: true as const, data: DEFAULT_CATALOG, lastDocId: null, hasMore: false, meta: { hasMore: false, lastDocId: null, source: "default" } 
            };
        }

        return { error: null, success: true as const, data: [], hasMore: false, meta: { hasMore: false } };

    } catch (error: any) { logger.error("Get export catalog error:", error);
        return { success: false as const, error: "Failed to fetch catalog", data: null };
    }
}

export async function createExportCatalogAction(productData: any): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "export:approve_applications")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();

        if (productData.id && typeof productData.id === 'string' && !productData.id.includes(' ')) { // Update existing or default
            await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productData.id).set({
                ...productData,
                isActive: true,
                updatedAt: new Date(),
                updatedBy: session.user.id }, { merge: true });
            return { error: null, success: true as const, data: null };
        } else { // Create new
            const dataToSave = { ...productData };
            delete dataToSave.id;
            const ref = await db.collection(COLLECTIONS.EXPORT_CATALOG).add({ ...dataToSave,
                isActive: true,
                sortOrder: Date.now(),
                createdAt: new Date(),
                createdBy: session.user.id });
            await recordAdminAction({
            action: 'export_create',
            userId: session.user.id,
            targetId: ref.id,
            targetType: 'export_catalog',
        });
        return { error: null, success: true as const, data: { id: ref.id } };
        }
    } catch (error: any) { logger.error("Create/update export catalog error:", error);
        return { success: false as const, error: "Failed to save catalog item", data: null };
    }
}

// ============================================
// Export Request Stats (server-side COUNT)
// ============================================

export async function getExportRequestStatsAction(): Promise<{ success: true; error: null; data: {
        total: number;
        pending: number;
        inTransit: number;
        delivered: number;
        completed: number;
    } }
    | { success: false; error: string; data: null }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        const col = db.collection(COLLECTIONS.EXPORT_WINDOWS);

        const [totalSnap, pendingSnap, inTransitSnap, deliveredSnap, completedSnap] = await Promise.all([
            col.count().get(),
            col.where("status", "==", "pending").count().get(),
            col.where("status", "==", "in_transit").count().get(),
            col.where("status", "==", "delivered").count().get(),
            col.where("status", "==", "completed").count().get(),
        ]);

        return { error: null, success: true as const, data: { total: totalSnap.data().count || 0, pending: pendingSnap.data().count || 0, inTransit: inTransitSnap.data().count || 0, delivered: deliveredSnap.data().count || 0, completed: completedSnap.data().count || 0 } };
    } catch (error: any) { logger.error("Get export request stats error:", error);
        return { success: false as const, error: "Failed to fetch export stats", data: null };
    }
}

// ============================================
// Export Catalog Stats (server-side COUNT)
// ============================================

export async function getExportCatalogStatsAction(): Promise<{ success: true; error: null; data: {
        totalProducts: number;
    } }
    | { success: false; error: string; data: null }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        const snap = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .count()
            .get();

        return { error: null, success: true as const, data: { totalProducts: snap.data().count || 0 } };
    } catch (error: any) { logger.error("Get export catalog stats error:", error);
        return { success: false as const, error: "Failed to fetch catalog stats", data: null };
    }
}

export async function deleteExportCatalogAction(productId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "export:approve_applications")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        //   #612 — `update()` on a missing document is a silent no-op in the
        //   Supabase shim, so this reported success for work it did not do. The
        //   id comes from the caller and nothing established that it exists.
        const wrote = await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productId).updateExisting({ isActive: false, 
            deletedAt: new Date(),
            deletedBy: session.user.id
        });
        if (!wrote) {
            return { success: false as const, error: "That catalogue product no longer exists", data: null };
        }

        await recordAdminAction({
            action: 'export_catalog_delete',
            userId: session.user.id,
            targetId: productId,
            targetType: 'export_catalog',
        });
        return { error: null,  success: true as const , data: null };
    } catch (error: any) { logger.error("Delete export catalog error:", error);
        return { success: false as const, error: "Failed to delete item", data: null };
    }
}

export async function getAdminPendingExportProductsAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!session?.user || !isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("status", "==", "pending")
            .orderBy("createdAt", "desc")
            .get();

        // DISEASE 5 FIX: use serializeDocs to prevent Timestamp objects crashing the client
        const products = serializeDocs(snapshot.docs);

        return { success: true as const, data: products, error: null };
    } catch (error: any) { logger.error("Get pending export products error:", error);
        return { success: false as const, error: "Failed to fetch pending products", data: null };
    }
}

export async function reviewExportProductAction(productId: string, action: 'approve' | 'reject'): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error, data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "export:approve_applications")) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const db = getAdminDb();
        const updates = action === 'approve' 
            ? { status: 'live', isActive: true } 
            : { status: 'rejected', isActive: false };

        const productRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(productId);
        const productDoc = await productRef.get();
        const productData = productDoc.data();

        await productRef.update({ ...updates,
            updatedAt: new Date(),
            reviewedBy: session.user.id,
            reviewedAt: new Date()
        });

        // Send Email Notification if userId exists
        if (productData?.userId) { try {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(productData.userId).get();
                const userData = userDoc.data();
                if (userData?.email) {
                    const { sendExportProductApprovalEmail, sendExportProductRejectionEmail } = await import("@/lib/email-notifications");
                    const userName = userData.name || userData.firstName || "Export Participant";
                    const productName = productData.name || "Export Product";
                    if (action === 'approve') { await sendExportProductApprovalEmail(userData.email, userName, productName);
                    } else { await sendExportProductRejectionEmail(userData.email, userName, productName);
                    }
                }
            } catch (emailErr) { logger.error("Failed to send export product review email:", emailErr);
            }
        }

        await recordAdminAction({
            action: 'export_product_review',
            userId: session.user.id,
            targetId: productId,
            targetType: 'export_product',
            metadata: { decision: action },
        });
        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Review export product error:", error);
        return { success: false as const, error: "Failed to review product", data: null };
    }
}

/**
 * Fetch all export orders for admin dashboard
 */
export async function getAdminExportOrdersAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized access", data: null };
        }

        const db = getAdminDb();
        const ordersSnapshot = await db.collection(COLLECTIONS.EXPORT_ORDERS)
            .orderBy("createdAt", "desc")
            .get();

        const orders = ordersSnapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null };
        });

        return { success: true as const, data: orders, error: null };
    } catch (error: any) { logger.error("Failed to fetch admin export orders:", error);
        return { success: false as const, error: "Failed to fetch export orders", data: null };
    }
}

/**
 * Update the status of an export order
 */
export async function updateAdminExportOrderStatusAction(
    orderId: string, 
    status: string,
    documentData?: { name: string; url: string; type: string }
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!hasAdminPermission(session.user.roles, "export:approve_applications")) { return { success: false as const, error: "Unauthorized access", data: null };
        }

        // `status` arrived as a free string and was written straight to the
        // order.
        //
        // The vocabulary export-payment.ts actually writes is small —
        // pending_payment, processing, completed, cancelled_out_of_stock — and
        // nothing here checked against it, so a typo like "shiped" or an invented
        // value became the order's state permanently. Buyers' dashboards filter
        // on these strings, so an order in an unknown state simply stops
        // appearing anywhere.
        //
        // This is an admin endpoint, so the concern is a mistake rather than an
        // attack, and a whitelist is the cheapest way to make the mistake
        // impossible. It is not a transition check: which moves are legal is a
        // wider question than this function should answer alone.
        /*
         *   #616 "refunded" IS NOT ON THIS LIST, AND THAT IS THE FIX.
         *
         *   It was, and this action can only write a label. So an administrator
         *   could set an order to "refunded", the buyer was NOTIFIED — "Export
         *   order refunded" — no money moved, and `paymentStatus` stayed
         *   `paid_awaiting_refund`, which is the field that means the money is
         *   still owed.
         *
         *   Three things then disagreed at once: the order said refunded, the
         *   payment status said awaiting refund, and the buyer had been told
         *   they had their money back. Of those, telling the buyer is the one
         *   that cannot be taken back.
         *
         *   Refunding is a real operation — refundExportOrderToWalletAction
         *   credits the buyer through creditWalletOnce, the same mechanism the
         *   escrow refund uses — so the honest move is for the action that
         *   CANNOT do it to refuse, and to say where it is done instead.
         */
        const ALLOWED_ORDER_STATUSES = [
            "pending_payment", "processing", "shipped", "delivered",
            "completed", "cancelled", "cancelled_out_of_stock",
        ];
        if (status === "refunded") {
            return {
                success: false as const,
                error: "This action cannot refund an order — it only records a status. "
                    + "Use the refund action, which returns the money to the buyer's wallet.",
                data: null,
            };
        }
        if (!ALLOWED_ORDER_STATUSES.includes(status)) {
            return {
                success: false as const,
                error: `Unknown order status "${status}". Allowed: ${ALLOWED_ORDER_STATUSES.join(", ")}`,
                data: null,
            };
        }

        const db = getAdminDb();
        const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderId);
        // Import FieldValue from firebase-admin for arrayUnion
        const { FieldValue } = await import('@/lib/firestore-compat');

        const updateData: any = { status,
            updatedAt: FieldValue.serverTimestamp() };

        if (documentData) { updateData.documents = FieldValue.arrayUnion(documentData);
        }

        await orderRef.update(updateData);

        /**
         *   #585 AND THE BUYER IS TOLD, which is what this status is for.
         *
         *   The comment above says "Buyers' dashboards filter on these strings"
         *   — written while NO buyer-facing screen read this collection at all.
         *   An admin marking an order shipped, or attaching the bill of lading,
         *   changed a value the buyer could not see and was never told about.
         *
         *   Read after the update so the buyer id comes from the row rather
         *   than from a caller, and wrapped because a notification that cannot
         *   be written must not undo a status change that already happened.
         */
        try {
            const orderSnap = await orderRef.get();
            const buyerId = orderSnap.data()?.buyerId;
            if (buyerId) {
                const { createNotification } = await import("@/infrastructure/notifications/service");
                await createNotification({
                    userId: String(buyerId),
                    type: "info",
                    title: `Export order ${status.replace(/_/g, " ")}`,
                    message: documentData
                        ? `Order ${orderSnap.data()?.orderId ?? orderId} is now "${status.replace(/_/g, " ")}", and "${documentData.name}" has been added to it.`
                        : `Order ${orderSnap.data()?.orderId ?? orderId} is now "${status.replace(/_/g, " ")}".`,
                    link: "/export/buyer/orders",
                    linkText: "View my orders",
                });
            }
        } catch (e: any) {
            logger.warn("Failed to notify export buyer of a status change", { orderId, error: e?.message || String(e) });
        }

        await recordAdminAction({
            action: 'export_status_update',
            userId: session.user.id,
            targetId: orderId,
            targetType: 'export_order',
            metadata: { status },
        });
        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Failed to update export order status:", error);
        return { success: false as const, error: "Failed to update export order status", data: null };
    }
}

/**
 * Return the money for an export order that was charged and never fulfilled.
 *
 *   #616 THE DEBT WAS SURFACED AND HAD NO DOOR.
 *
 *        Both export stock-reservation paths mark an order
 *        `paymentStatus: "paid_awaiting_refund"`, `status:
 *        "cancelled_out_of_stock"` when the reservation fails after the payment
 *        is already claimed. cron/reconcile-fulfilment reports every one of them
 *        and says, correctly, that it will not move money itself: "moving money
 *        back out belongs behind a human."
 *
 *        Behind a human, and behind nothing else. There was no action that
 *        issued the refund. The only thing an administrator could do was set the
 *        order's status to "refunded" — which wrote a word, notified the buyer
 *        they had been refunded, moved nothing, and left `paid_awaiting_refund`
 *        in place. That door is closed now, and this is the one that opens.
 *
 *   WHAT IT DOES
 *
 *        Credits the buyer's wallet through `creditWalletOnce` — the same
 *        mechanism `_refundEscrowToBuyer` uses, with `status: "refund"` so
 *        platform_revenue_totals() does not count money going back to a buyer as
 *        income. The reference is derived from the order, so a second attempt
 *        credits nothing and reports the same result.
 *
 *   WHAT IT WILL NOT DO
 *
 *        NOTHING IS DELETED and no order is invented. It refuses an order that
 *        is not actually awaiting a refund, so this cannot be used to pay out
 *        against an order that was fulfilled — and it refuses one with no
 *        readable amount rather than guessing at zero.
 */
async function _refundExportOrderToWalletAction(orderId: string): Promise<ActionResponse<{ amount: number; alreadyRefunded: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Authentication required", data: null };
        }
        const { session } = sessionResult;

        /*
         *   `finance:refund` — #623. When this was written that permission was
         *   super_admin-only and gating nothing, so asking for it would have
         *   locked every ordinary administrator out of the only door that
         *   returns this money, and it asked `finance:resolve_disputes` to match
         *   _refundEscrowToBuyer. #623 fixed the declaration instead of working
         *   around it: `finance:refund` is granted to admin, and BOTH refund
         *   doors ask for it. Same people, and now the right name.
         *
         *   Not "is some kind of admin": an export admin who approves
         *   applications is not thereby authorised to return money.
         *
         *   #616 LEFT THIS OPEN AND #623 CLOSED IT, which is worth keeping
         *   because the reasoning was sound and the conclusion was a deferral:
         *
         *       "THE UNUSED PERMISSION IS WORTH SOMEBODY'S ATTENTION and is not
         *        mine to resolve: granting it to `admin`, or moving both refund
         *        paths onto it, changes who can move money. That is a decision
         *        about privilege, not a defect to fix while passing."
         *
         *   It does not change who can move money. admin could already refund
         *   through both doors under `finance:resolve_disputes`; granting them
         *   `finance:refund` and moving both doors onto it leaves the same two
         *   roles — admin and super_admin — passing the same two gates. What
         *   changes is that the declaration stops contradicting the code.
         */
        if (!hasAdminPermission(session.user.roles, "finance:refund")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        if (!orderId || typeof orderId !== "string") {
            return { success: false as const, error: "An order id is required", data: null };
        }

        const db = getAdminDb();
        const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderId);
        const snap = await orderRef.get();
        if (!snap.exists) {
            return { success: false as const, error: "Order not found", data: null };
        }

        const order = snap.data() ?? {};

        //   Only an order the platform has already recorded as owing money. This
        //   is what stops the action being a general "pay this buyer" button.
        if (order.paymentStatus !== "paid_awaiting_refund") {
            return {
                success: false as const,
                error: order.paymentStatus === "refunded"
                    ? "This order has already been refunded"
                    : "This order is not awaiting a refund",
                data: null,
            };
        }

        const buyerId = String(order.buyerId || order.userId || "");
        if (!buyerId) {
            return { success: false as const, error: "This order has no buyer to refund", data: null };
        }

        //   #606's rule: a floor written as `amount <= 0` lets NaN through, and a
        //   refund of NaN would be a credit of NaN. The amount must be a real,
        //   positive number or this refuses and says so.
        const amount = firstNumber(order.refundAmount, order.paidAmount, order.totalAmount);
        if (!isPositiveAmount(amount)) {
            return {
                success: false as const,
                error: "This order has no readable amount to refund",
                data: null,
            };
        }

        const { FieldValue } = await import("@/lib/firestore-compat");

        const credit = await creditWalletOnce({
            reference: `export-refund:${orderId}`,
            userId: buyerId,
            amount,
            paymentType: "export_refund",
            source: "export_orders",
            //   Not "completed": platform_revenue_totals() sums completed rows,
            //   and money going back to a buyer is not income.
            status: "refund",
            metadata: { orderId, reason: order.status || "cancelled_out_of_stock" },
        });

        //   The status moves only after the money has. A crash between them
        //   leaves the order still marked as owing, which the reconciler reports
        //   and this action is idempotent against — the safe direction.
        const wrote = await orderRef.updateExisting({
            status: "refunded",
            paymentStatus: "refunded",
            refundedAt: new Date().toISOString(),
            refundedBy: session.user.id,
            refundReference: `export-refund:${orderId}`,
            updatedAt: FieldValue.serverTimestamp(),
        });
        if (!wrote) {
            return { success: false as const, error: "That order no longer exists", data: null };
        }

        await recordAdminAction({
            action: "export_order_refunded",
            userId: session.user.id,
            targetId: orderId,
            targetType: "export_order",
            metadata: { amount, buyerId, alreadyCredited: !credit.claimed },
        });

        try {
            const { createNotification } = await import("@/infrastructure/notifications/service");
            await createNotification({
                userId: buyerId,
                type: "info",
                title: "Export order refunded",
                message: `₦${amount.toLocaleString()} has been returned to your wallet.`,
                //   /dashboard/wallet, not /wallet — dead-internal-links caught this,
                //   which is what it is for: a notification linking nowhere is a
                //   dead end at the moment somebody is looking for their money.
                link: "/dashboard/wallet",
                linkText: "View wallet",
            });
        } catch (notifyError) {
            //   The money moved. A notification that cannot be written must not
            //   undo that, or report it as a failure the admin would retry.
            logger.error("[export-refund] could not notify the buyer", { orderId, notifyError });
        }

        return {
            success: true as const,
            error: null,
            data: { amount, alreadyRefunded: !credit.claimed },
        };
    } catch (error) {
        logger.error("Refund export order error:", error);
        return {
            success: false as const,
            error: error instanceof Error ? error.message : "Failed to refund the order",
            data: null,
        };
    }
}

export const refundExportOrderToWalletAction = withFlexibleSafeAction(
    "refundExportOrderToWalletAction", _refundExportOrderToWalletAction);
