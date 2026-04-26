import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore, AggregateField } from "firebase-admin/firestore";
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
    console.log("Verifying Database Indexes...\n");

    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const checks = [
        {
            name: "Global Platform Metrics (Transactions Status & Amount)",
            run: () => db.collection("transactions").where("status", "==", "completed").aggregate({ total: AggregateField.sum("amount") }).get()
        },
        {
            name: "Monthly Analytics (Transactions Date & Amount)",
            run: () => db.collection("transactions").where("status", "==", "completed").where("date", ">=", thisMonthStart).aggregate({ total: AggregateField.sum("amount") }).get()
        },
        {
            name: "Cooperative Members (Payment Status & Registration Fee)",
            run: () => db.collection("cooperative_members").where("paymentStatus", "==", "completed").aggregate({ total: AggregateField.sum("registrationFee") }).get()
        },
        {
            name: "Cooperative Payout Calculator (Withdrawal Requests)",
            run: () => db.collection("withdrawal_requests").where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get()
        },
        {
            name: "WAVE Payout Calculator (Wave Withdrawals)",
            run: () => db.collection("wave_withdrawals").where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get()
        }
    ];

    let allSuccessful = true;

    for (const check of checks) {
        try {
            const snap = await check.run();
            const val = snap.data().total;
            console.log(`[✅ READY] ${check.name} -> Value Resolved: ₦${val.toLocaleString()}`);
        } catch (e: any) {
            allSuccessful = false;
            if (e.message.includes("requires an index")) {
                console.log(`[⏳ BUILDING] ${check.name} -> Index is still being processed by Google Cloud...`);
            } else {
                console.log(`[❌ ERROR] ${check.name} -> ${e.message}`);
            }
        }
    }

    console.log("\n");
    if (allSuccessful) {
        console.log("🟢 SUCCESS: All 5 indexes have successfully built! The Admin Dashboard is now fully online.");
    } else {
        console.log("🟡 PENDING: Some indexes are still physically building on the Firebase servers. Please allow 1-2 more minutes.");
    }
}

run().catch(console.error);
