import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing payments and failedPayments collections...");

    // 1. Check failedPayments collection
    const failedSnap = await db.collection("failedPayments").get();
    console.log(`Found ${failedSnap.size} failed payments`);
    failedSnap.docs.forEach(doc => {
        console.log(`Failed Payment Reference: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
    });

    // 2. Query payments collection where status is successful/completed/paid
    console.log("\nQuerying payments collection...");
    const paymentsSnap = await db.collection("payments")
        .where("status", "in", ["paid", "completed", "successful", "success"])
        .get();
        
    console.log(`Found ${paymentsSnap.size} successful/paid payments in payments collection`);

    let unreflectedCount = 0;
    for (const doc of paymentsSnap.docs) {
        const data = doc.data();
        const reference = data.reference || doc.id;
        
        // Check processedPayments
        const processedDoc = await db.collection("processedPayments").doc(reference).get();
        if (!processedDoc.exists) {
            console.log(`\nUnreflected Payment Found in 'payments' but not in 'processedPayments'!`);
            console.log(`Reference/DocID: ${reference}`);
            console.log(JSON.stringify(data, null, 2));
            unreflectedCount++;
        }
    }
    
    console.log(`\nScan finished. Total unreflected payments: ${unreflectedCount}`);
}

main().catch(console.error);
