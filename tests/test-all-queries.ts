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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const queries = [
        // From admin-analytics:
        { name: "Active Users", ref: db.collection("users").where("lastLoginAt", ">=", thirtyDaysAgo).count() },
        { name: "Pending Escrows", ref: db.collection("escrow_transactions").where("status", "==", "pending").count() },
        { name: "Active Land", ref: db.collection("land_listings").where("status", "==", "active").count() },
        { name: "Pending Loans", ref: db.collection("loan_applications").where("status", "==", "pending").count() },
        { name: "Pending Sellers", ref: db.collection("seller_verifications").where("status", "==", "pending").count() },
        { name: "Wallet Withdrawals", ref: db.collection("wallet_transactions").where("type", "==", "withdrawal").where("status", "==", "pending").count() },
        { name: "Month Rev", ref: db.collection("transactions").where("status", "==", "completed").where("date", ">=", thisMonthStart).aggregate({ total: AggregateField.sum("amount") }) },
        { name: "Wave By Status", ref: db.collection("wave_applications").where("status", "in", ["pending", "submitted", "under_review", "approved", "rejected"]).count() },
        { name: "Farm Nation In Status", ref: db.collection("users").where("serviceRegistrations.farmNation.status", "in", ["pending", "approved"]).count() },
        { name: "Coop Member by Status", ref: db.collection("cooperative_members").where("paymentStatus", "==", "completed").where("membershipStatus", "!=", "rejected").count() },
        { name: "Coop Finance Payout", ref: db.collection("withdrawal_requests").where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }) },
        { name: "Wave Finance Payout", ref: db.collection("wave_withdrawals").where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }) },
        { name: "Failed Payments", ref: db.collection("failedPayments").where("status", "==", "failed").count() },
    ];

    for (const q of queries) {
        try {
            await q.ref.get();
        } catch (e: any) {
            console.log(`[QUERY_FAILED] ${q.name}: ${e.message}`);
        }
    }
    console.log("Done testing queries.");
}

run().catch(console.error);
