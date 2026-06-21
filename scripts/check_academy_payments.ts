import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Academy Payments...");

    // 1. Fetch completed academy_registration payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    console.log(`Total completed processedPayments in DB: ${paymentsSnap.size}`);

    const acadPayments: any[] = [];
    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isAcad = type === "academy_registration" || 
                       type === "academy" || 
                       String(data.purpose).includes("academy") ||
                       String(data.metadata?.purpose).includes("academy") ||
                       String(data.paystackMetadata?.purpose).includes("academy");

        if (isAcad) {
            acadPayments.push({
                docId: doc.id,
                reference: data.reference || doc.id,
                userId: data.userId || data.metadata?.userId || data.paystackMetadata?.userId,
                email: data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email,
                amount: data.amount,
                type
            });
        }
    });

    console.log(`Found ${acadPayments.length} completed academy-related payments.`);
    console.log("\nAll academy completed payments:");
    console.log(JSON.stringify(acadPayments, null, 2));
}

main();
