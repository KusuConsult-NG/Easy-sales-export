import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env.production.local") });

import { db, adminAuth } from "../src/lib/firebase-admin";

async function checkDb() {
    console.log("Checking E2E buyers in Firebase Auth...");
    try {
        const buyerAuth = await adminAuth.getUserByEmail("e2e.buyer@easysalesexport.com");
        console.log(`Auth User: ${buyerAuth.email}, UID: ${buyerAuth.uid}`);
        
        const userDoc = await db.collection("users").doc(buyerAuth.uid).get();
        if (userDoc.exists) {
            console.log("Firestore User Doc found:", userDoc.data());
        } else {
            console.log("Firestore User Doc NOT found!");
        }

        const ordersSnap = await db.collection("marketplaceOrders").get();
        console.log(`Total marketplace orders: ${ordersSnap.size}`);
        ordersSnap.forEach(doc => {
            console.log(`Order ID: ${doc.id}, Data:`, JSON.stringify(doc.data(), null, 2));
        });

        const disputesSnap = await db.collection("disputes").get();
        console.log(`Total disputes: ${disputesSnap.size}`);
        disputesSnap.forEach(doc => {
            console.log(`Dispute ID: ${doc.id}, Data:`, JSON.stringify(doc.data(), null, 2));
        });

    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

checkDb().then(() => process.exit(0));
