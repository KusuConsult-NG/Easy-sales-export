import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore, AggregateField } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

async function run() {
    const db = getFirestore();
    const coopTx = await db.collection("cooperative_transactions").count().get();
    const coopCompleted = await db.collection("cooperative_transactions").where("status", "==", "completed").aggregate({total: AggregateField.sum("amount")}).get();
    console.log("Coop tx count:", coopTx.data().count);
    console.log("Coop completed sum:", coopCompleted.data().total);
}
run().catch(console.error);
