import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    // Let's query by paymentReference field
    const ref = "5h5e2cagmi";
    const processedDoc = await db.collection("processedPayments").doc(ref).get();
    if (processedDoc.exists) {
        console.log(`Reference ${ref} exists in processedPayments:`, processedDoc.data());
    } else {
        console.log(`Reference ${ref} DOES NOT exist in processedPayments.`);
    }

    const buyerId = "dYIeSzf3VBQUk21X8YaDqNAiLgr1";
    const orderQuery1 = await db.collection("marketplaceOrders").where("buyerId", "==", buyerId).get();
    console.log(`Query in marketplaceOrders by buyerId '${buyerId}' returned: ${orderQuery1.size} docs`);
    orderQuery1.docs.forEach(doc => {
        console.log(`Doc ID: ${doc.id}, data:`, doc.data());
    });

    const orderQuery2 = await db.collection("orders").where("buyerId", "==", buyerId).get();
    console.log(`Query in legacy orders by buyerId '${buyerId}' returned: ${orderQuery2.size} docs`);
    orderQuery2.docs.forEach(doc => {
        console.log(`Doc ID: ${doc.id}, data:`, doc.data());
    });
}

main().catch(console.error);
