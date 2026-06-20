import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, '\n');
                process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.error("Failed to load .env.local:", e);
}

import { db } from "../src/lib/firebase-admin";
import { getLogisticsProvider } from "../src/lib/logistics";
import { FieldValue } from "firebase-admin/firestore";

async function main() {
    const orderId = "ORD-1781615526391-dYIeSzf3";
    const sellerId = "7ZJRaZnTL9dWk4jsP0p9aKeTC0i1"; // Authorized seller for this order
    
    try {
        console.log(`1. Resetting order ${orderId} status to 'processing' and clearing trackingNumber...`);
        const orderRef = db.collection("marketplaceOrders").doc(orderId);
        await orderRef.update({
            status: "processing",
            trackingNumber: FieldValue.delete(),
            estimatedDeliveryDate: FieldValue.delete()
        });
        console.log("Order status reset successfully.");

        console.log("2. Simulating _updateOrderStatusAction to transition status to 'shipped'...");
        
        let finalTrackingNumber = undefined;
        // Logic from _updateOrderStatusAction
        const orderDoc = await orderRef.get();
        if (orderDoc.exists) {
            const orderData = orderDoc.data() as any;
            const provider = getLogisticsProvider();
            console.log("Calling provider.createShipment...");
            const shipment = await provider.createShipment({
                orderId,
                sellerId: orderData.sellerId || (Array.isArray(orderData.sellerIds) ? orderData.sellerIds[0] : undefined),
                buyerId: orderData.buyerId,
                destination: orderData.deliveryAddress?.city || "Destination",
            });
            finalTrackingNumber = shipment.trackingNumber;
            console.log(`Shipment created with tracking number: ${finalTrackingNumber}`);
        } else {
            throw new Error("Order doc not found before shipment creation");
        }

        console.log("3. Running database transaction...");
        await db.runTransaction(async (transaction) => {
            const currentOrderDoc = await transaction.get(orderRef);
            if (!currentOrderDoc.exists) throw new Error("Order not found");
            const currentOrder = currentOrderDoc.data() as any;

            const isAuthorized = currentOrder.sellerId === sellerId || (Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.includes(sellerId));
            if (!isAuthorized) {
                throw new Error("Not authorized to update this order");
            }

            const allowedStatuses = ["processing", "shipped", "delivered", "cancelled"];
            if (!allowedStatuses.includes("shipped")) {
                throw new Error(`Sellers cannot set status to 'shipped'`);
            }

            const updateData: any = {
                status: "shipped",
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            };

            if (finalTrackingNumber) updateData.trackingNumber = finalTrackingNumber;
            
            const estimatedDate = new Date();
            estimatedDate.setDate(estimatedDate.getDate() + 7);
            updateData.estimatedDeliveryDate = estimatedDate;

            console.log("Transaction updates data:", updateData);
            transaction.update(orderRef, updateData);
        });

        console.log("4. Order successfully updated to 'shipped'!");
        const updatedDoc = await orderRef.get();
        console.log("Updated order status:", updatedDoc.data()?.status);
        console.log("Updated trackingNumber:", updatedDoc.data()?.trackingNumber);
    } catch (e: any) {
        console.error("ERROR ENCOUNTERED:", e.message || e);
        if (e.stack) {
            console.error(e.stack);
        }
    }
}

main();
