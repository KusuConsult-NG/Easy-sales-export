import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore, AggregateField } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

async function run() {
    const db = getFirestore();
    
    // Simulate what getCooperativeStatsAction does:
    const membersSnap = await db.collection("cooperative_members").limit(5000).get();
    const allMembers = membersSnap.docs.map(doc => doc.data());
    const paidMembersList = allMembers.filter((m: any) => m.paymentStatus === "completed");
    
    // Simulate what admin-analytics moduleUsage does:
    const moduleUsage = [
        { module: "Cooperative", count: (await db.collection("cooperative_members").where("paymentStatus", "==", "completed").count().get()).data().count }
    ];

    console.log("Total members:", allMembers.length);
    console.log("Paid members:", paidMembersList.length);
    console.log("Module Usage Coop:", moduleUsage[0].count);
    
    const [txnTotalSnap, completedRevSnap] = await Promise.all([
        db.collection("transactions").count().get(),
        db.collection("transactions").where("status", "==", "completed").aggregate({ total: AggregateField.sum("amount") }).get()
    ]);
    console.log("Global transactions total count:", txnTotalSnap.data().count);
    console.log("Global transactions completed amount:", completedRevSnap.data().total);
}
run().catch(console.error);
