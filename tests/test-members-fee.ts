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
    const paidMembersSnap = await db.collection("cooperative_members").where("paymentStatus", "==", "completed").limit(10).get();
    for (const doc of paidMembersSnap.docs) {
        const data = doc.data();
        console.log(`User: ${doc.id}, Tier: ${data.membershipTier}, Fee: ${data.registrationFee}`);
    }
}
run().catch(console.error);
