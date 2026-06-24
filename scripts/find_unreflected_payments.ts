import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing processedPayments for unreflected or unhandled payments...");

    // Query for unhandled types
    const unhandledSnap = await db.collection("processedPayments")
        .where("status", "==", "unhandled_type")
        .get();

    console.log(`Found ${unhandledSnap.size} documents with status 'unhandled_type'`);
    unhandledSnap.docs.forEach((doc) => {
        console.log(`\nDocument ID (Reference): ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
    });

    // Let's also check if there are any failed payments or other statuses
    const otherSnap = await db.collection("processedPayments")
        .limit(100)
        .get();
        
    const statuses = new Set<string>();
    otherSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.status) {
            statuses.add(data.status);
        }
    });
    console.log("\nAll statuses found in processedPayments (up to 100 docs):", Array.from(statuses));
}

main().catch(console.error);
