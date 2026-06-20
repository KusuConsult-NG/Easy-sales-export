"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { paystackPayout } from "@/lib/paystack-transfer";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { getLogisticsProvider } from "@/lib/logistics";
import { runQueryWithRetry } from "@/lib/firestore-utils";

/**
 * Get all orders for a seller
 */
async function _getSellerOrdersAction(filters?: { status?: OrderStatus; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) { return { success: false as const, error: "Not authorized as seller", data: null };
        }

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) { query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("sellerIds", "array-contains", userId)
                .where("status", "==", filters.status)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await query.get();
        const orders = serializeDocs<Order>(snapshot.docs);

        return { error: null, success: true as const, data: { orders } };
    } catch (error) { logger.error("Get seller orders error:", { 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch orders", data: null };
    }
}
export const getSellerOrdersAction = withFlexibleSafeAction("getSellerOrdersAction", _getSellerOrdersAction);

/**
 * Update order status (seller only)
 */
async function _updateOrderStatusAction(
    orderId: string,
    newStatus: OrderStatus,
    trackingNumber?: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        let finalTrackingNumber = trackingNumber;
        if (newStatus === "shipped" && !finalTrackingNumber) {
            const orderDoc = await orderRef.get();
            if (orderDoc.exists) {
                const orderData = orderDoc.data() as Order;
                const provider = getLogisticsProvider();
                const shipment = await provider.createShipment({
                    orderId,
                    sellerId: orderData.sellerId || (Array.isArray(orderData.sellerIds) ? orderData.sellerIds[0] : undefined),
                    buyerId: orderData.buyerId,
                    destination: orderData.deliveryAddress?.city || "Destination",
                });
                finalTrackingNumber = shipment.trackingNumber;
            }
        }

        // Query associated escrow transactions if the status becomes delivered
        let escrowDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (newStatus === "delivered") {
            const escrowQuery = await runQueryWithRetry(() => db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get());
            escrowDocs = escrowQuery.docs;
        }

        await db.runTransaction(async (transaction) => { const currentOrderDoc = await transaction.get(orderRef);
            if (!currentOrderDoc.exists) throw new Error("Order not found");
            const currentOrder = currentOrderDoc.data() as Order;

            const isUserAdmin = hasRole(session.user.roles || [], "admin") || hasRole(session.user.roles || [], "super_admin");
            const isAuthorized = isUserAdmin || currentOrder.sellerId === userId || (Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.includes(userId));
            if (!isAuthorized) {
                throw new Error("Not authorized to update this order");
            }

            const allowedStatuses: OrderStatus[] = ["processing", "shipped", "delivered", "cancelled"];
            if (!allowedStatuses.includes(newStatus)) {
                throw new Error(`Sellers cannot set status to '${newStatus}'`);
            }

            const updateData: any = { status: newStatus,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (!currentOrder.sellerId && Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.length > 0) {
                updateData.sellerId = currentOrder.sellerIds[0];
            }

            if (finalTrackingNumber) updateData.trackingNumber = finalTrackingNumber;
            if (newStatus === "shipped") { const estimatedDate = new Date();
                estimatedDate.setDate(estimatedDate.getDate() + 7);
                updateData.estimatedDeliveryDate = estimatedDate;
            }
            if (newStatus === "delivered") {
                updateData.deliveredAt = FieldValue.serverTimestamp();
                // Synchronize escrow transaction status to "delivered" so the auto-release cron picks it up
                for (const escrowDoc of escrowDocs) {
                    transaction.update(escrowDoc.ref, {
                        status: "delivered",
                        updatedAt: FieldValue.serverTimestamp()
                    });
                }
            }

            if (newStatus === "cancelled" && currentOrder.status !== "cancelled") { const items = currentOrder.items || [];
                for (const item of items) {
                    const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                    transaction.update(productRef, {
                        availableQuantity: FieldValue.increment(item.quantity),
                        orders: FieldValue.increment(-1),
                        _version: FieldValue.increment(1) });
                }
            }

            transaction.update(orderRef, updateData);
        });

        return { error: null, success: true as const, data: { message: "Order status updated successfully" } };
    } catch (error) { logger.error("Update order status error:", { 
            orderId, 
            newStatus, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update order status"};
    }
}
export const updateOrderStatusAction = withFlexibleSafeAction("updateOrderStatusAction", _updateOrderStatusAction);

/**
 * Get all orders for a buyer
 */
async function _getBuyerOrdersAction(filters?: { status?: OrderStatus; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const userId = session.user.id;

        // Build query
        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = serializeDocs<Order>(snapshot.docs);

        return { error: null, success: true as const, data: { orders } };
    } catch (error) { logger.error("Get buyer orders error:", { 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch orders"};
    }
}
export const getBuyerOrdersAction = withFlexibleSafeAction("getBuyerOrdersAction", _getBuyerOrdersAction);

/**
 * Confirm delivery (buyer only)
 */
async function _confirmDeliveryAction(orderId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const userId = session.user.id;
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        const result = await db.runTransaction(async (transaction) => { const currentOrderDoc = await transaction.get(orderRef);
            if (!currentOrderDoc.exists) throw new Error("Order not found");
            const currentOrder = currentOrderDoc.data() as Order;

            if (currentOrder.buyerId !== userId) throw new Error("Unauthorized");
            if (currentOrder.status !== "delivered") throw new Error("Order must be delivered first");

            transaction.update(orderRef, {
                buyerConfirmed: true,
                buyerConfirmedAt: FieldValue.serverTimestamp(),
                status: "completed",
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });

            const sellerId = currentOrder.sellerId || (Array.isArray(currentOrder.sellerIds) ? currentOrder.sellerIds[0] : undefined);
            if (sellerId) {
                const escrowId = `ESC-${orderId}-${sellerId.substring(0, 5)}`;
                const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
                const escrowDoc = await transaction.get(escrowRef);
                if (escrowDoc.exists) {
                    transaction.update(escrowRef, {
                        status: "released",
                        releasedAt: FieldValue.serverTimestamp(),
                        releasedBy: userId,
                        updatedAt: FieldValue.serverTimestamp(),
                        _version: FieldValue.increment(1)
                    });
                }
            }

            if (!sellerId) throw new Error("Seller ID not found on order");

            const sellerRef = db.collection(COLLECTIONS.USERS).doc(sellerId);
            const sellerDoc = await transaction.get(sellerRef);
            const sellerData = sellerDoc.data();

            let sellerAmount = 0;
            let isWaveMember = false;
            const roles = (sellerData?.roles || []) as string[];
            if (roles.includes("wave_participant") || roles.includes("wave")) {
                isWaveMember = true;
            }

            if (sellerData?.bankAccountNumber && sellerData?.bankCode) {
                const platformCommissionRate = 0.025;
                sellerAmount = Math.floor(currentOrder.totalAmount * (1 - platformCommissionRate));
            }

            // PHASE 2: WAVE LEDGER SYNC (IF APPLICABLE)
            if (isWaveMember) {
                const waveCommissionRate = 0.05; // 5% as per wave.ts
                const earningsAmount = Math.floor(currentOrder.totalAmount * waveCommissionRate);
                
                // Increment persistent balance on user doc
                transaction.update(sellerRef, {
                    'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(earningsAmount),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Create Wallet Transaction for the credit record
                const txnId = `WAVE-CR-${orderId}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
                const txnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(txnId);
                transaction.set(txnRef, {
                    walletId: sellerId,
                    userId: sellerId,
                    type: "credit",
                    module: "wave",
                    amount: earningsAmount,
                    description: `WAVE Earnings Credit - Order ${orderId}`,
                    status: "completed",
                    reference: orderId,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: 0
                });
            }

            return { sellerAmount, sellerData, currentOrder };
        });

        if (result.sellerAmount > 0) { try {
                const bankDetails = result.sellerData;
                if (!bankDetails?.bankAccountNumber || !bankDetails?.bankCode) {
                    throw new Error("Seller bank details are missing.");
                }
                const res = await paystackPayout(
                    {
                        accountNumber: bankDetails.bankAccountNumber,
                        bankCode: bankDetails.bankCode,
                        accountName: bankDetails.bankAccountName || (bankDetails as any).name || bankDetails.fullName || "" 
                    },
                    result.sellerAmount,
                    `Escrow release for order ${orderId}`
                );

                await orderRef.update({ escrowReleased: res.success,
                    escrowReleasedAt: res.success ? FieldValue.serverTimestamp() : null,
                    paystackTransferCode: res.transferCode || null,
                    sellerAmountPaid: result.sellerAmount,
                    escrowReleaseError: res.success ? null : res.error,
                    escrowPendingManualRelease: !res.success,
                    _version: FieldValue.increment(1) });
            } catch (err) { logger.error("Payout side effect failed:", { userId, error: err });
                await orderRef.update({ escrowPendingManualRelease: true, _version: FieldValue.increment(1) });
            }
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Confirm delivery error:", { 
            orderId, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to confirm delivery", data: null };
    }
}
export const confirmDeliveryAction = withFlexibleSafeAction("confirmDeliveryAction", _confirmDeliveryAction);

/**
 * Get a single order by ID — seller view
 */
async function _getOrderDetailsAction(orderId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();

        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const data = orderDoc.data()!;
        const isAdmin = hasRole(session.user.roles || [], "admin") || hasRole(session.user.roles || [], "super_admin");

        const isAuthorized = data.sellerId === session.user.id || (Array.isArray(data.sellerIds) && data.sellerIds.includes(session.user.id));
        if (!isAuthorized && !isAdmin) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .get();

        const order = serializeDoc<Order>(orderDoc.id, orderDoc.data()) as any;
        if (!order.sellerId && Array.isArray(order.sellerIds) && order.sellerIds.length > 0) {
            order.sellerId = order.sellerIds[0];
        }

        if (!escrowQuery.empty) {
            order.escrowTransactionId = escrowQuery.docs[0].id;
            order.escrowReleased = escrowQuery.docs.every(doc => doc.data().status === "released");
        } else {
            order.escrowTransactionId = null;
            order.escrowReleased = false;
        }

        return { error: null, success: true as const, data: { order } };
    } catch (error) { logger.error("Get order details error:", { 
            orderId, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch order details", data: null };
    }
}
export const getOrderDetailsAction = withFlexibleSafeAction("getOrderDetailsAction", _getOrderDetailsAction);
export const getOrderByIdForSellerAction = getOrderDetailsAction;

/**
 * Get tracking updates for a shipment
 */
async function _getTrackingUpdatesAction(trackingNumber: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };

        if (!trackingNumber) {
            return { success: false as const, error: "Tracking number is required", data: null };
        }

        const provider = getLogisticsProvider();
        const updates = await provider.trackShipment(trackingNumber);

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const serializedUpdates = serializeValue(updates);

        return { error: null, success: true as const, data: { updates: serializedUpdates, providerName: provider.name } };
    } catch (error) {
        logger.error("Get tracking updates error:", { trackingNumber, error });
        return { success: false as const, error: "Failed to fetch tracking updates", data: null };
    }
}
export const getTrackingUpdatesAction = withFlexibleSafeAction("getTrackingUpdatesAction", _getTrackingUpdatesAction);
