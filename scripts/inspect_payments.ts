import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing completed processedPayments fields...");
    
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .limit(10)
        .get();
    
    paymentsSnap.docs.forEach((doc, idx) => {
        console.log(`\n--- Document ${idx + 1} (${doc.id}) ---`);
        console.log(JSON.stringify(doc.data(), null, 2));
    });
}

main();
