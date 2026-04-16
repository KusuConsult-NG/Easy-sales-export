import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";
import { AggregateField } from "firebase-admin/firestore";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

async function run() {
    const db = getFirestore();
    
    console.log("Testing Global-Aggregation Query...");
    try {
        const snap = await db.collection("transactions")
                .where("status", "==", "completed")
                .aggregate({ total: AggregateField.sum("amount") })
                .get();
        console.log("Global Aggregation Success:", snap.data().total);
    } catch (e: any) {
        console.error("Global Aggregation Failed:", e.message);
    }

    console.log("Testing Cooperative Revenue Query...");
    try {
        const snap = await db.collection("cooperative_members")
            .where("paymentStatus", "==", "completed")
            .aggregate({ total: AggregateField.sum("registrationFee") })
            .get();
        console.log("Coop Revenue Success:", snap.data().total);
    } catch (e: any) {
        console.error("Coop Revenue Failed:", e.message);
    }
}

run().catch(console.error);
