import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

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
    
    // Count real paid member docs
    const paidMembersSnap = await db.collection("cooperative_members").where("paymentStatus", "==", "completed").count().get();
    console.log("Real Paid Members in Collection:", paidMembersSnap.data().count);
    
    // Count transaction distinct users
    const txs = await db.collection("cooperative_transactions").where("status", "==", "completed").get();
    const contributions = txs.docs.map(doc => doc.data()).filter((t: any) => t.type === "contribution" || t.type === "membership_registration");
    const uniqueMem = new Set(contributions.map((c: any) => c.userId));
    
    console.log("Unique members with transactions:", uniqueMem.size);
}
run().catch(console.error);
