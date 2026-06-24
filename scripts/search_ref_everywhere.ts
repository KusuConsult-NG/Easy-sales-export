import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    const ref = "5h5e2cagmi";
    const userId = "dYIeSzf3VBQUk21X8YaDqNAiLgr1";

    console.log(`Searching for reference '${ref}' and userId '${userId}' across all collections...`);

    const collections = [
        "users", "transactions", "processedPayments", "failedPayments",
        "marketplaceOrders", "orders", "payments", "cooperative_members",
        "cooperative_transactions", "wallets", "wallet_transactions"
    ];

    for (const collName of collections) {
        try {
            const collRef = db.collection(collName);
            
            // Search by doc ID
            const docById = await collRef.doc(ref).get();
            if (docById.exists) {
                console.log(`[Found doc by ID '${ref}'] in collection '${collName}':`, docById.data());
            }

            const docByUser = await collRef.doc(userId).get();
            if (docByUser.exists) {
                console.log(`[Found doc by ID '${userId}'] in collection '${collName}':`, docByUser.data());
            }

            // Search by fields
            const snapRef = await collRef.where("paymentReference", "==", ref).get();
            if (snapRef.size > 0) {
                console.log(`[Found by field paymentReference] in collection '${collName}' (${snapRef.size} docs):`);
                snapRef.docs.forEach(d => console.log(` - DocID: ${d.id}:`, d.data()));
            }

            const snapRef2 = await collRef.where("reference", "==", ref).get();
            if (snapRef2.size > 0) {
                console.log(`[Found by field reference] in collection '${collName}' (${snapRef2.size} docs):`);
                snapRef2.docs.forEach(d => console.log(` - DocID: ${d.id}:`, d.data()));
            }

            const snapUser = await collRef.where("userId", "==", userId).get();
            if (snapUser.size > 0) {
                console.log(`[Found by field userId] in collection '${collName}' (${snapUser.size} docs):`);
                snapUser.docs.forEach(d => console.log(` - DocID: ${d.id}:`, d.data()));
            }

            const snapBuyer = await collRef.where("buyerId", "==", userId).get();
            if (snapBuyer.size > 0) {
                console.log(`[Found by field buyerId] in collection '${collName}' (${snapBuyer.size} docs):`);
                snapBuyer.docs.forEach(d => console.log(` - DocID: ${d.id}:`, d.data()));
            }
        } catch (err: any) {
            console.error(`Error searching collection ${collName}:`, err.message);
        }
    }
}

main().catch(console.error);
